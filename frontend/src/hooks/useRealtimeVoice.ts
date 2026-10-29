import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IRTCEngine } from '@volcengine/rtc';
import { voiceApi, type VoiceTicket } from '@/api/voice';
import { decodeVoiceSubtitles, VoiceTurnAccumulator } from '@/lib/rtcProtocol';
import { useSessionStore } from '@/stores/sessionStore';

type RtcModule = typeof import('@volcengine/rtc');
interface ActiveConnection { sessionId: number; ticket: VoiceTicket; engine: IRTCEngine; rtc: RtcModule; }
interface Options {
  sessionId: number | null;
  enabled: boolean;
  onAnswer: (text: string) => void;
}

export function useRealtimeVoice({ sessionId, enabled, onAnswer }: Options) {
  const availability = useQuery({ queryKey: ['voice', 'config'], queryFn: voiceApi.availability, staleTime: 30_000 });
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const active = useRef<ActiveConnection | null>(null);
  const disposed = useRef(new WeakSet<IRTCEngine>());
  const generation = useRef(0);
  const operation = useRef(false);
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const awaitingRound = useRef<number | null>(null);
  const lastSpoken = useRef<number | null>(null);
  const currentRoundId = useSessionStore((store) => store.currentRoundId);
  const streaming = useSessionStore((store) => store.isStreaming);

  const disposeEngine = useCallback(async (engine: IRTCEngine, rtc: RtcModule) => {
    if (disposed.current.has(engine)) return;
    disposed.current.add(engine);
    await engine.stopAudioCapture().catch(() => undefined);
    await engine.leaveRoom().catch(() => undefined);
    rtc.default.destroyEngine(engine);
  }, []);

  const disconnect = useCallback(async () => {
    generation.current++;
    operation.current = false;
    const connection = active.current;
    active.current = null;
    setPhase('idle');
    setPlaybackBlocked(false);
    awaitingRound.current = null;
    lastSpoken.current = null;
    if (!connection) return;
    // 先停采集，确保离开页面或断线时立即释放麦克风。
    const stop = voiceApi.stop(connection.sessionId, connection.ticket.connectionId).catch(() => undefined);
    await disposeEngine(connection.engine, connection.rtc);
    await stop;
  }, [disposeEngine]);

  const fail = useCallback((message: string) => {
    setError(message);
    void disconnect();
  }, [disconnect]);

  const submitTranscript = useCallback((text: string) => {
    const state = useSessionStore.getState();
    if (!text.trim() || !state.currentRoundId || state.isStreaming || state.isAwaitingResponse || !state.isConnected
      || state.status !== 'IN_PROGRESS' || awaitingRound.current === state.currentRoundId) return;
    awaitingRound.current = state.currentRoundId;
    onAnswerRef.current(text.trim());
    setTranscript('');
  }, []);

  const connect = useCallback(async () => {
    if (!enabled || !sessionId || operation.current || active.current) return;
    operation.current = true;
    const attempt = ++generation.current;
    setPhase('connecting');
    setError(null);
    setTranscript('');
    let ticket: VoiceTicket | null = null;
    let engine: IRTCEngine | null = null;
    let rtc: RtcModule | null = null;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    const cancelled = () => generation.current !== attempt;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('请在 localhost 或 HTTPS 页面中使用麦克风');
      ticket = await voiceApi.connect(sessionId);
      if (cancelled()) return;
      rtc = await import('@volcengine/rtc');
      if (cancelled()) return;
      engine = rtc.default.createEngine(ticket.appId);
      active.current = { sessionId, ticket, engine, rtc };
      const accumulator = new VoiceTurnAccumulator();
      let agentReady = false;
      let resolveAgent: (() => void) | undefined;
      engine.on(rtc.default.events.onUserJoined, ({ userInfo }) => {
        if (cancelled()) return;
        if (userInfo.userId === ticket?.botUserId) { agentReady = true; resolveAgent?.(); }
      });
      engine.on(rtc.default.events.onRoomBinaryMessageReceived, ({ userId, message }) => {
        if (cancelled() || userId !== ticket?.botUserId) return;
        for (const item of decodeVoiceSubtitles(message)) {
          if (item.userId !== ticket.userId) continue;
          const turn = accumulator.accept(item);
          if (!turn) continue;
          setTranscript(turn.text);
          if (turn.complete) submitTranscript(turn.text);
        }
      });
      engine.on(rtc.default.events.onAutoplayFailed, () => { if (!cancelled()) setPlaybackBlocked(true); });
      engine.on(rtc.default.events.onError, () => { if (!cancelled()) fail('语音连接已断开，请重新连接'); });
      engine.on(rtc.default.events.onTokenWillExpire, () => { if (!cancelled()) fail('本次语音连接即将到期，请重新连接'); });
      await engine.startAudioCapture();
      if (cancelled()) return;
      await engine.joinRoom(ticket.token, ticket.roomId, { userId: ticket.userId }, {
        isAutoPublish: true, isAutoSubscribeAudio: true, isAutoSubscribeVideo: false,
      });
      if (cancelled()) return;
      await voiceApi.start(sessionId, ticket.connectionId);
      if (cancelled()) return;
      // StartVoiceChat 的 200 仅表示已下发任务；收到 Bot 入房事件后才显示已连接。
      if (!agentReady) {
        await new Promise<void>((resolve, reject) => {
          resolveAgent = resolve;
          readyTimeout = setTimeout(() => reject(new Error('语音智能体尚未就绪，请检查服务开通和应用权限后重试')), 20_000);
        });
      }
      if (cancelled()) return;
      setPhase('connected');
    } catch (cause) {
      if (!cancelled()) {
        const permissionDenied = cause instanceof DOMException && cause.name === 'NotAllowedError';
        setError(permissionDenied ? '麦克风权限未开启，请允许访问后重试' : cause instanceof Error ? cause.message : '语音连接失败');
        await disconnect();
      }
    } finally {
      clearTimeout(readyTimeout);
      if (cancelled()) {
        // 包括在 connect 请求或动态加载 SDK 期间离开页面的情况。
        if (engine && rtc && active.current?.engine !== engine) {
          await disposeEngine(engine, rtc);
        }
        if (ticket) void voiceApi.stop(sessionId, ticket.connectionId).catch(() => undefined);
      }
      if (generation.current === attempt) operation.current = false;
    }
  }, [disconnect, disposeEngine, enabled, fail, sessionId, submitTranscript]);

  useEffect(() => {
    if (!enabled) void disconnect();
  }, [enabled, disconnect]);

  useEffect(() => () => { void disconnect(); }, [sessionId, disconnect]);

  useEffect(() => {
    const close = () => { void disconnect(); };
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  }, [disconnect]);

  useEffect(() => {
    if (phase !== 'connected') return;
    const timer = setInterval(() => {
      const connection = active.current;
      if (connection) void voiceApi.heartbeat(connection.sessionId, connection.ticket.connectionId)
        .catch(() => { if (active.current === connection) fail('语音连接已失效，请重新连接'); });
    }, 15_000);
    return () => clearInterval(timer);
  }, [phase, fail]);

  useEffect(() => {
    if (currentRoundId !== awaitingRound.current) awaitingRound.current = null;
    const connection = active.current;
    if (phase !== 'connected' || streaming || !currentRoundId || !connection || lastSpoken.current === currentRoundId) return;
    const state = useSessionStore.getState();
    if (state.messages.some((message) => message.role === 'answer' && message.roundId === currentRoundId)) return;
    lastSpoken.current = currentRoundId;
    void voiceApi.speak(connection.sessionId, connection.ticket.connectionId, currentRoundId)
      .catch((cause: unknown) => {
        if (active.current === connection) setError(cause instanceof Error ? cause.message : '题目播报失败，请断开后重连');
      });
  }, [currentRoundId, streaming, phase]);

  return {
    availability, phase, error, transcript, playbackBlocked,
    active: phase !== 'idle',
    connect, disconnect,
    sendTranscript: () => submitTranscript(transcript),
    interrupt: async () => {
      const connection = active.current;
      if (connection) await voiceApi.interrupt(connection.sessionId, connection.ticket.connectionId)
        .catch((cause: unknown) => {
          if (active.current === connection) setError(cause instanceof Error ? cause.message : '打断失败，请重试');
        });
    },
    resumePlayback: async () => {
      try { await active.current?.engine.play(); setPlaybackBlocked(false); }
      catch { setError('无法播放语音，请检查浏览器声音权限'); }
    },
  };
}
