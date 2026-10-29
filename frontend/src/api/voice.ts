import { http } from './client';

export interface VoiceAvailability {
  enabled: boolean;
  configured: boolean;
  missing: string[];
}

export interface VoiceTicket {
  connectionId: string;
  appId: string;
  roomId: string;
  userId: string;
  botUserId: string;
  token: string;
  expiresAt: number;
}

const path = (sessionId: number) => `/api/v1/interviews/${sessionId}/voice`;

export const voiceApi = {
  availability: () => http.get<VoiceAvailability>('/api/v1/voice/config'),
  connect: (sessionId: number) => http.post<VoiceTicket>(`${path(sessionId)}/connect`),
  start: (sessionId: number, connectionId: string) => http.post(`${path(sessionId)}/start`, { connectionId }),
  heartbeat: (sessionId: number, connectionId: string) => http.post(`${path(sessionId)}/heartbeat`, { connectionId }),
  speak: (sessionId: number, connectionId: string, roundId: number) => http.post(`${path(sessionId)}/speak`, { connectionId, roundId }),
  interrupt: (sessionId: number, connectionId: string) => http.post(`${path(sessionId)}/interrupt`, { connectionId }),
  stop: (sessionId: number, connectionId: string) => http.post(`${path(sessionId)}/stop`, { connectionId }, { keepalive: true }),
};
