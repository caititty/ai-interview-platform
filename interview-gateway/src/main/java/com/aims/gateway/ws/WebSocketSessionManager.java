package com.aims.gateway.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.CopyOnWriteArraySet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * WebSocket 会话管理器：维护 sessionId → 活跃 {@link WebSocketSession} 集合。
 *
 * <p>多连接模型：同一面试会话允许候选端（GUEST）与管理端观察者（OBSERVER）并存，管理端主控（非观察者）与 GUEST 仍互斥。{@link #getSession}
 * 返回"主连接"（非 OBSERVER 优先）供 Engine 流式推送；{@link #broadcast} 向会话全部连接广播（可排除指定身份，如 GUEST 回环）。
 *
 * <p>线程安全：基于 {@link ConcurrentHashMap} + {@link CopyOnWriteArraySet}，均无锁。
 *
 * @since 1.1.0 Phase 5
 */
@Component
public class WebSocketSessionManager {

    /** 观察者身份标记（管理端在 CANDIDATE_ONLY 模式下旁路观察）。 */
    public static final String ROLE_OBSERVER = "OBSERVER";

    /** 候选端身份标记（与 InterviewWebSocketConfig 握手 attributes 对齐）。 */
    public static final String ROLE_GUEST = "GUEST";

    private static final Logger log = LoggerFactory.getLogger(WebSocketSessionManager.class);

    private final ObjectMapper objectMapper;

    private final ConcurrentMap<Long, CopyOnWriteArraySet<WebSocketSession>> sessions =
            new ConcurrentHashMap<>();

    public WebSocketSessionManager(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 注册会话。同一 sessionId 允许多连接并存（候选端 + 管理端观察者）。
     *
     * @param sessionId 面试 sessionId
     * @param session WebSocket 会话
     */
    public void register(Long sessionId, WebSocketSession session) {
        sessions.computeIfAbsent(sessionId, k -> new CopyOnWriteArraySet<>()).add(session);
    }

    /**
     * 注销会话。
     *
     * <p>仅从对应 sessionId 的连接集合移除当前 session；集合为空时清理键。 防止旧连接（如 StrictMode
     * 双连接、断线重连时的前一连接）的关闭回调把其他活跃连接误删。
     *
     * @param sessionId 面试 sessionId
     * @param session 正在关闭的 WebSocket 会话
     */
    public void unregister(Long sessionId, WebSocketSession session) {
        CopyOnWriteArraySet<WebSocketSession> set = sessions.get(sessionId);
        if (set == null) {
            return;
        }
        set.remove(session);
        if (set.isEmpty()) {
            sessions.remove(sessionId, set);
        }
    }

    /**
     * 查找主连接：非观察者优先（管理端主控 / 候选端），用于 Engine 流式推送。
     *
     * @param sessionId 面试 sessionId
     * @return 主 WebSocket 会话；不存在或全部已关闭返回 null
     */
    public WebSocketSession getSession(Long sessionId) {
        CopyOnWriteArraySet<WebSocketSession> set = sessions.get(sessionId);
        if (set == null || set.isEmpty()) {
            return null;
        }
        for (WebSocketSession session : set) {
            if (session.isOpen() && !isRole(session, ROLE_OBSERVER)) {
                return session;
            }
        }
        return set.stream().filter(WebSocketSession::isOpen).findFirst().orElse(null);
    }

    /**
     * 判断 sessionId 是否有活跃连接（含观察者）。
     *
     * @param sessionId 面试 sessionId
     * @return true 表示有活跃连接
     */
    public boolean hasActiveSession(Long sessionId) {
        return getSession(sessionId) != null;
    }

    /**
     * 向会话的全部活跃连接广播消息。
     *
     * @param sessionId 面试 sessionId
     * @param message 出站消息
     * @param excludeRoles 需要排除的身份（如 GUEST 回环），可省略
     */
    public void broadcast(Long sessionId, WsOutbound message, String... excludeRoles) {
        CopyOnWriteArraySet<WebSocketSession> set = sessions.get(sessionId);
        if (set == null || set.isEmpty()) {
            return;
        }
        String json;
        try {
            json = objectMapper.writeValueAsString(message);
        } catch (IOException e) {
            log.warn("广播消息序列化失败 sessionId={}", sessionId, e);
            return;
        }
        List<String> excluded = List.of(excludeRoles);
        for (WebSocketSession session : set) {
            if (!session.isOpen()) {
                continue;
            }
            if (isRole(session, excluded)) {
                continue;
            }
            try {
                synchronized (session) {
                    session.sendMessage(new TextMessage(json));
                }
            } catch (IOException e) {
                log.warn("广播消息发送失败 sessionId={}", sessionId, e);
            }
        }
    }

    private boolean isRole(WebSocketSession session, String role) {
        Object value = session.getAttributes().get("role");
        return value != null && role.equals(value.toString());
    }

    private boolean isRole(WebSocketSession session, List<String> roles) {
        Object value = session.getAttributes().get("role");
        if (value == null) {
            return false;
        }
        return roles.contains(value.toString());
    }

    /**
     * FE.16 A2：关闭本实例所有活跃 WS 连接（实例优雅停机时调用）。
     *
     * <p>主动断开让客户端立即重连（走 P2 断线恢复），而非等待 TCP 超时（数秒~数十秒）。 连接关闭后由 {@code afterConnectionClosed}
     * 回调释放连接锁并转 PAUSED，无需在此额外处理。
     *
     * @param status 关闭状态（如 SERVICE_RESTARTED）
     */
    public void closeAll(CloseStatus status) {
        int count = sessions.values().stream().mapToInt(Set::size).sum();
        log.info("关闭本实例全部 WebSocket 连接 count={}", count);
        sessions.values()
                .forEach(
                        set ->
                                set.forEach(
                                        session -> {
                                            if (session.isOpen()) {
                                                try {
                                                    session.close(status);
                                                } catch (IOException e) {
                                                    log.warn("优雅停机关闭会话失败", e);
                                                }
                                            }
                                        }));
        sessions.clear();
    }
}
