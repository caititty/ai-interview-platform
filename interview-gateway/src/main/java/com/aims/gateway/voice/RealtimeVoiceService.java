package com.aims.gateway.voice;

import com.aims.core.common.ErrorCode;
import com.aims.core.common.exception.BizException;
import com.aims.core.session.SessionStatus;
import com.aims.infra.persistence.entity.InterviewRoundEntity;
import com.aims.infra.persistence.service.InterviewRoundService;
import com.aims.infra.persistence.service.InterviewSessionService;
import jakarta.annotation.PreDestroy;
import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** 管理一对一 RTC 连接、短期 Token 和云端任务；不改变现有面试问答/评分链路。 */
@Service
public class RealtimeVoiceService {
    private static final Logger log = LoggerFactory.getLogger(RealtimeVoiceService.class);
    private static final long LEASE_MILLIS = 60_000;
    private final RealtimeVoiceProperties config;
    private final RtcVoiceApi api;
    private final InterviewSessionService interviews;
    private final InterviewRoundService rounds;
    private final Clock clock;
    private final Map<Long, Connection> connections = new ConcurrentHashMap<>();

    @Autowired
    public RealtimeVoiceService(
            RealtimeVoiceProperties config,
            RtcVoiceApi api,
            InterviewSessionService interviews,
            InterviewRoundService rounds) {
        this(config, api, interviews, rounds, Clock.systemUTC());
    }

    RealtimeVoiceService(
            RealtimeVoiceProperties config,
            RtcVoiceApi api,
            InterviewSessionService interviews,
            InterviewRoundService rounds,
            Clock clock) {
        this.config = config;
        this.api = api;
        this.interviews = interviews;
        this.rounds = rounds;
        this.clock = clock;
    }

    public record Availability(boolean enabled, boolean configured, List<String> missing) {}

    public record Ticket(
            String connectionId,
            String appId,
            String roomId,
            String userId,
            String botUserId,
            String token,
            long expiresAt) {}

    public Availability availability() {
        return new Availability(config.enabled(), config.missing().isEmpty(), config.missing());
    }

    public synchronized Ticket open(Long sessionId, String owner) {
        if (!config.enabled() || !config.missing().isEmpty()) {
            throw new BizException(
                    ErrorCode.INFRA_UNAVAILABLE,
                    "实时语音尚未配置完成：" + String.join("、", config.missing()));
        }
        requireInProgress(sessionId);
        if (connections.containsKey(sessionId)) {
            throw new BizException(ErrorCode.SESSION_LOCKED, "该面试已有语音连接，请先断开原连接或等待一分钟后重试");
        }
        String suffix = UUID.randomUUID().toString().replace("-", "");
        String room = "aims_" + sessionId + "_" + suffix.substring(0, 12);
        String user = "candidate_" + suffix.substring(0, 12);
        String prefix = config.botPrefix().replaceAll("[^a-zA-Z0-9_.@-]", "_");
        prefix = prefix.substring(0, Math.min(prefix.length(), 50));
        String bot = prefix + "_" + suffix.substring(12, 24);
        long now = clock.instant().getEpochSecond();
        long expiresAt = now + config.tokenTtlSeconds();
        Ticket ticket =
                new Ticket(
                        suffix,
                        config.appId(),
                        room,
                        user,
                        bot,
                        RtcTokenGenerator.generate(
                                config.appId(), config.appKey(), room, user, now, expiresAt),
                        expiresAt);
        connections.put(
                sessionId,
                new Connection(owner, ticket, "task_" + suffix, clock.millis() + LEASE_MILLIS));
        return ticket;
    }

    public void start(Long sessionId, String owner, String connectionId) {
        Connection connection = requireConnection(sessionId, owner, connectionId);
        synchronized (connection) {
            requireLive(sessionId, connection);
            if (connection.started) return;
            Map<String, Object> request = identity(connection);
            request.put(
                    "Config",
                    Map.of(
                            "ASRConfig",
                                    Map.of(
                                            "Provider",
                                            "volcano",
                                            "ProviderParams",
                                            Map.of(
                                                    "Mode",
                                                    "bigmodel",
                                                    "StreamMode",
                                                    2,
                                                    "Credential",
                                                    Map.of(
                                                            "ApiResourceId",
                                                            config.asrResourceId())),
                                            "VADConfig",
                                            Map.of("SilenceTime", 1200)),
                            "LLMConfig", Map.of("AutoActive", false),
                            "TTSConfig",
                                    Map.of(
                                            "Provider",
                                            "volcano_bidirection",
                                            "ProviderParams",
                                            Map.of(
                                                    "ResourceId", config.ttsResourceId(),
                                                    "audio",
                                                            Map.of(
                                                                    "voice_type",
                                                                    config.speaker(),
                                                                    "speech_rate",
                                                                    0))),
                            "InterruptMode", 0,
                            "SubtitleConfig",
                                    Map.of("SubtitleMode", 1, "DisableRTSSubtitle", false)));
            request.put(
                    "AgentConfig",
                    Map.of(
                            "TargetUserId",
                            List.of(connection.ticket.userId()),
                            "UserId",
                            connection.ticket.botUserId(),
                            "EnableConversationStateCallback",
                            true,
                            "IdleTimeout",
                            60));
            // 超时也可能已创建任务，因此请求前就记录，以保证后续会尝试 StopVoiceChat。
            connection.startAttempted = true;
            try {
                api.call("StartVoiceChat", request);
            } catch (RtcVoiceApi.Rejected e) {
                // 明确拒绝与网络超时不同：任务未获受理，不必阻止用户修正配置后重试。
                connection.startAttempted = false;
                throw e;
            }
            connection.started = true;
            connection.leaseUntil = clock.millis() + LEASE_MILLIS;
        }
    }

    public void heartbeat(Long sessionId, String owner, String connectionId) {
        Connection connection = requireConnection(sessionId, owner, connectionId);
        synchronized (connection) {
            requireLive(sessionId, connection);
            connection.leaseUntil = clock.millis() + LEASE_MILLIS;
        }
    }

    public void speak(Long sessionId, String owner, String connectionId, Long roundId) {
        Connection connection = requireConnection(sessionId, owner, connectionId);
        synchronized (connection) {
            requireLive(sessionId, connection);
            if (!connection.started)
                throw new BizException(ErrorCode.SESSION_STATUS_CONFLICT, "语音智能体尚未连接");
            if (Objects.equals(connection.lastSpokenRound, roundId)) return;
            InterviewRoundEntity round =
                    rounds.listBySession(sessionId).stream()
                            .filter(r -> Objects.equals(r.getId(), roundId))
                            .findFirst()
                            .orElseThrow(
                                    () ->
                                            new BizException(
                                                    ErrorCode.RESOURCE_NOT_FOUND, "面试轮次不存在"));
            if (round.getAnswer() != null && !round.getAnswer().isBlank()) {
                throw new BizException(ErrorCode.SESSION_ROUND_CONFLICT, "该轮次已经回答");
            }
            Map<String, Object> request = identity(connection);
            request.put("Command", "ExternalTextToSpeech");
            request.put("Message", round.getQuestion());
            request.put("InterruptMode", 1);
            api.call("UpdateVoiceChat", request);
            connection.lastSpokenRound = roundId;
        }
    }

    public void interrupt(Long sessionId, String owner, String connectionId) {
        Connection connection = requireConnection(sessionId, owner, connectionId);
        synchronized (connection) {
            requireLive(sessionId, connection);
            if (!connection.started) return;
            Map<String, Object> request = identity(connection);
            request.put("Command", "interrupt");
            api.call("UpdateVoiceChat", request);
        }
    }

    public void stop(Long sessionId, String owner, String connectionId) {
        Connection connection = connections.get(sessionId);
        if (connection == null) return;
        requireConnection(sessionId, owner, connectionId);
        stopConnection(sessionId, connection);
    }

    private void stopConnection(Long sessionId, Connection connection) {
        synchronized (connection) {
            connection.closing = true;
            connection.leaseUntil = 0;
            if (connection.startAttempted) api.call("StopVoiceChat", identity(connection));
            connections.remove(sessionId, connection);
        }
    }

    @Scheduled(fixedDelay = 15_000)
    public void cleanup() {
        connections.forEach(
                (sessionId, connection) -> {
                    try {
                        if (connection.closing
                                || connection.leaseUntil < clock.millis()
                                || connection.ticket.expiresAt() <= clock.instant().getEpochSecond()
                                || !SessionStatus.IN_PROGRESS
                                        .name()
                                        .equals(interviews.getById(sessionId).getStatus())) {
                            stopConnection(sessionId, connection);
                        }
                    } catch (Exception e) {
                        log.warn(
                                "RTC 清理等待重试 sessionId={} errorType={}",
                                sessionId,
                                e.getClass().getSimpleName());
                        // 客户端已退房时云端 IdleTimeout 兜底，过期连接不会无限保留在内存。
                        if (clock.instant().getEpochSecond()
                                > connection.ticket.expiresAt() + 120) {
                            connections.remove(sessionId, connection);
                        }
                    }
                });
    }

    @PreDestroy
    public void shutdown() {
        connections.forEach(
                (sessionId, connection) -> {
                    try {
                        stopConnection(sessionId, connection);
                    } catch (Exception e) {
                        log.warn("RTC 关闭任务失败 sessionId={}", sessionId);
                    }
                });
    }

    private Connection requireConnection(Long sessionId, String owner, String connectionId) {
        Connection connection = connections.get(sessionId);
        if (connection == null
                || !Objects.equals(connection.owner, owner)
                || !Objects.equals(connection.ticket.connectionId(), connectionId)) {
            throw new BizException(ErrorCode.ACCESS_DENIED, "语音连接无效或不属于当前用户");
        }
        return connection;
    }

    private void requireLive(Long sessionId, Connection connection) {
        requireInProgress(sessionId);
        if (connection.closing
                || connection.leaseUntil < clock.millis()
                || connection.ticket.expiresAt() <= clock.instant().getEpochSecond()) {
            throw new BizException(ErrorCode.SESSION_STATUS_CONFLICT, "语音连接已过期，请重新连接");
        }
    }

    private void requireInProgress(Long sessionId) {
        if (!SessionStatus.IN_PROGRESS.name().equals(interviews.getById(sessionId).getStatus())) {
            throw new BizException(ErrorCode.SESSION_STATUS_CONFLICT, "请先开始或恢复面试，再连接语音");
        }
    }

    private Map<String, Object> identity(Connection connection) {
        Map<String, Object> request = new HashMap<>();
        request.put("AppId", config.appId());
        request.put("RoomId", connection.ticket.roomId());
        request.put("TaskId", connection.taskId);
        return request;
    }

    private static final class Connection {
        final String owner;
        final Ticket ticket;
        final String taskId;
        volatile long leaseUntil;
        volatile boolean closing;
        boolean startAttempted;
        boolean started;
        Long lastSpokenRound;

        Connection(String owner, Ticket ticket, String taskId, long leaseUntil) {
            this.owner = owner;
            this.ticket = ticket;
            this.taskId = taskId;
            this.leaseUntil = leaseUntil;
        }
    }
}
