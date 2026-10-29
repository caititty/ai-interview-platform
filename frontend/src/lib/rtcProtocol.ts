/** 火山 RTC 字幕：4 字节 magic + 4 字节大端长度 + UTF-8 JSON。 */
export interface VoiceSubtitle {
  userId: string;
  text: string;
  definite: boolean;
  paragraph: boolean;
  sequence: number;
  roundId?: number;
}

export function decodeVoiceSubtitles(buffer: ArrayBuffer): VoiceSubtitle[] {
  if (buffer.byteLength < 8 || buffer.byteLength > 1024 * 1024) return [];
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'subv') return [];
  if (new DataView(buffer).getUint32(4, false) !== buffer.byteLength - 8) return [];
  try {
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8)));
    if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) return [];
    return payload.data.filter((item: unknown): item is VoiceSubtitle => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.userId === 'string' && typeof value.text === 'string'
        && typeof value.definite === 'boolean' && typeof value.paragraph === 'boolean'
        && typeof value.sequence === 'number' && Number.isFinite(value.sequence)
        && (value.roundId === undefined || (typeof value.roundId === 'number' && Number.isFinite(value.roundId)));
    });
  } catch {
    return [];
  }
}

/** 客户端 ASR 字幕是整句的累积修订，按 sequence 覆盖；与 AI 分句字幕的拼接方式不同。 */
export class VoiceTurnAccumulator {
  private latest = new Map<string, number>();
  private completed = new Set<string>();

  accept(item: VoiceSubtitle): { text: string; complete: boolean } | null {
    const round = item.roundId === undefined ? 'unscoped' : `round:${item.roundId}`;
    const completedKey = item.roundId === undefined ? `sequence:${item.sequence}` : round;
    if (this.completed.has(completedKey) || item.sequence < (this.latest.get(round) ?? -Infinity)) return null;
    this.latest.set(round, item.sequence);
    while (this.latest.size > 256) this.latest.delete(this.latest.keys().next().value!);
    const text = item.text.trim().slice(0, 10000);
    const complete = item.definite && item.paragraph;
    if (complete) {
      this.completed.add(completedKey);
      while (this.completed.size > 256) this.completed.delete(this.completed.values().next().value!);
    }
    return { text, complete };
  }
}
