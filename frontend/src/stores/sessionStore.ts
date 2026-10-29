import { create } from 'zustand';
import type { SessionStatus, ChatMessage, ProctorEvent } from '@/types/interview';

/** 面试会话状态管理 */
interface SessionStore {
  sessionId: number | null;
  status: SessionStatus;
  currentRoundId: number | null;
  currentQuestion: string;
  isStreaming: boolean;
  isAwaitingResponse: boolean;
  messages: ChatMessage[];
  proctorEvents: ProctorEvent[];
  isConnected: boolean;
  retryCount: number;
  error: string | null;

  // Actions
  setSession: (sessionId: number, status: SessionStatus) => void;
  setStatus: (status: SessionStatus) => void;
  setAwaitingResponse: (waiting: boolean) => void;
  addSystem: (status: SessionStatus, finishedBy?: string | null, finishReason?: string | null) => void;
  startQuestion: (roundId: number | undefined, seq: number | undefined, followUpType?: string, parentSeq?: number, followUpIndex?: number) => void;
  appendChunk: (text: string) => void;
  finalizeQuestion: (roundId?: number, fullText?: string) => void;
  addAnswer: (text: string, roundId?: number) => void;
  addQuestion: (roundId: number | undefined, seq: number | undefined, text: string, followUpType?: string, parentSeq?: number, followUpIndex?: number) => void;
  setAudio: (roundId: number, audioUrl: string, durationMs?: number) => void;
  hasRound: (roundId: number) => boolean;
  addProctorEvent: (event: ProctorEvent) => void;
  setConnected: (connected: boolean) => void;
  incrementRetry: () => void;
  resetRetry: () => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null as number | null,
  status: 'CREATED' as SessionStatus,
  currentRoundId: null as number | null,
  currentQuestion: '',
  isStreaming: false,
  isAwaitingResponse: false,
  messages: [] as ChatMessage[],
  proctorEvents: [] as ProctorEvent[],
  isConnected: false,
  retryCount: 0,
  error: null as string | null,
};

let messageSeq = 0;
const nextId = () => `msg-${++messageSeq}`;

/** 防作弊事件最大保留条数（前端实时面板仅展示最近事件） */
const MAX_PROCTOR_EVENTS = 50;

/** 未落库的流式问题没有 roundId；只有已知的标识才可用于去重。 */
function matchesQuestion(message: ChatMessage, roundId?: number, seq?: number, parentSeq?: number, followUpIndex?: number) {
  if (message.role !== 'question') return false;
  if (roundId != null && message.roundId != null) return message.roundId === roundId;
  if (parentSeq != null && followUpIndex != null) {
    return message.parentSeq === parentSeq && message.followUpIndex === followUpIndex;
  }
  return seq != null && message.parentSeq == null && message.seq === seq;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialState,

  setSession: (sessionId, status) =>
    set({ sessionId, status }),

  setStatus: (status) => set(status === 'IN_PROGRESS' ? { status } : { status, isAwaitingResponse: false }),

  setAwaitingResponse: (isAwaitingResponse) => set({ isAwaitingResponse }),

  /** 注入一条结束回执系统消息（按路径身份 + 状态去重，避免重复/重连恢复后仍仅一条）。 */
  addSystem: (status, finishedBy, finishReason) =>
    set((state) => {
      const already = state.messages.some(
        (m) =>
          m.role === 'system' &&
          m.status === status &&
          m.finishedBy === (finishedBy ?? null) &&
          m.finishReason === (finishReason ?? null),
      );
      if (already) return state;
      return {
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'system',
            text: '',
            status,
            finishedBy: finishedBy ?? null,
            finishReason: finishReason ?? null,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }),

  startQuestion: (roundId, seq, followUpType, parentSeq, followUpIndex) =>
    set((state) => {
      const existingIndex = state.messages.findIndex((message) => matchesQuestion(message, roundId, seq, parentSeq, followUpIndex));
      if (existingIndex !== -1) {
        // 历史先于 WS 回放到达时，复用气泡接收流，并恢复当前轮次，避免去重后丢掉后续 chunk。
        const existing = state.messages[existingIndex];
        const messages = [...state.messages];
        messages[existingIndex] = { ...existing, text: existing.streaming ? existing.text : '', streaming: true };
        return {
          messages,
          currentRoundId: roundId ?? existing.roundId ?? null,
          currentQuestion: existing.streaming ? existing.text : '',
          isStreaming: true,
          isAwaitingResponse: false,
        };
      }
      return {
        currentRoundId: roundId ?? null,
        currentQuestion: '',
        isStreaming: true,
        isAwaitingResponse: false,
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'question',
            text: '',
            roundId,
            seq,
            followUpType,
            parentSeq,
            followUpIndex,
            timestamp: new Date().toISOString(),
            streaming: true,
          },
        ],
      };
    }),

  appendChunk: (text) =>
    set((state) => {
      const messages = [...state.messages];
      const index = messages.reduce((found, message, i) => message.role === 'question' && message.streaming ? i : found, -1);
      if (index !== -1) {
        messages[index] = {
          ...messages[index],
          text: messages[index].text + text,
        };
      }
      return {
        messages,
        currentQuestion:
          state.currentQuestion + text,
      };
    }),

  finalizeQuestion: (roundId?: number, fullText?: string) =>
    set((state) => {
      const messages = [...state.messages];
      const index = messages.reduce((found, message, i) => message.role === 'question'
        && (message.streaming || (roundId != null && message.roundId === roundId)) ? i : found, -1);
      if (index !== -1) {
        const message = messages[index];
        messages[index] = { ...message, roundId: roundId ?? message.roundId, text: fullText ?? message.text, streaming: false };
      } else if (fullText) {
        // END 包含服务端完整文本；即使 START 或片段未显示，也能补回最终问题。
        messages.push({ id: nextId(), role: 'question', roundId, text: fullText, streaming: false, timestamp: new Date().toISOString() });
      }
      return {
        messages,
        isStreaming: false,
        isAwaitingResponse: false,
        currentQuestion: fullText ?? state.currentQuestion,
        // 问题结束并绑定 roundId 后，回答应关联该轮次；否则本地回答 roundId=undefined，
        // 与历史恢复 addAnswer(r.id) 去重键不一致 → 同一回答重复显示
        currentRoundId: roundId ?? state.currentRoundId,
      };
    }),

  addAnswer: (text, roundId) =>
    set((state) => {
      if (roundId != null && state.messages.some((m) => m.role === 'answer' && m.roundId === roundId)) {
        return state;
      }
      return {
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'answer' as const,
            text,
            roundId,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }),

  addQuestion: (roundId, seq, text, followUpType, parentSeq, followUpIndex) =>
    set((state) => {
      const existingIndex = state.messages.findIndex((message) => matchesQuestion(message, roundId, seq, parentSeq, followUpIndex));
      if (existingIndex !== -1) {
        const messages = [...state.messages];
        const existing = messages[existingIndex];
        messages[existingIndex] = { ...existing, roundId, seq, followUpType, parentSeq, followUpIndex, text: existing.streaming ? existing.text : text };
        return { messages };
      }
      return {
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'question',
            text,
            roundId,
            seq,
            followUpType,
            parentSeq,
            followUpIndex,
            timestamp: new Date().toISOString(),
            streaming: false,
          },
        ],
      };
    }),

  setAudio: (roundId, audioUrl, durationMs) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.roundId === roundId ? { ...m, audioUrl, durationMs } : m,
      ),
    })),

  hasRound: (roundId) =>
    get().messages.some((m) => m.role === 'question' && m.roundId === roundId),

  addProctorEvent: (event) =>
    set((state) => ({
      proctorEvents: [...state.proctorEvents, event].slice(-MAX_PROCTOR_EVENTS),
    })),

  setConnected: (connected) =>
    set(connected ? { isConnected: true, retryCount: 0 } : { isConnected: false, isAwaitingResponse: false }),

  incrementRetry: () =>
    set((state) => ({ retryCount: state.retryCount + 1 })),

  resetRetry: () => set({ retryCount: 0 }),

  setError: (error) => set({ error }),

  reset: () => set({ ...initialState, messages: [] }),
}));
