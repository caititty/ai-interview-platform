import { Loader2, Mic, PhoneOff, Square, Volume2 } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { SilverButton } from '@/components/ui/silver-button';
import type { useRealtimeVoice } from '@/hooks/useRealtimeVoice';

interface Props {
  voice: ReturnType<typeof useRealtimeVoice>;
  enabled: boolean;
  canSend: boolean;
}

export function RealtimeVoicePanel({ voice, enabled, canSend }: Props) {
  const ready = voice.availability.data?.enabled && voice.availability.data.configured;
  return (
    <GlassCard className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          {voice.phase === 'connecting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          <span>实时语音对话</span>
          {voice.phase === 'connected' && <span className="text-xs text-emerald-400">已连接 · 开口可打断播报</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {voice.active ? <>
            {voice.phase === 'connected' && <SilverButton variant="ghost" onClick={() => void voice.interrupt()}><Square className="mr-1 h-3 w-3" />打断播报</SilverButton>}
            <SilverButton variant="ghost" onClick={() => void voice.disconnect()}><PhoneOff className="mr-1 h-3 w-3" />断开语音</SilverButton>
          </> : <SilverButton disabled={!enabled || !ready || voice.availability.isLoading} onClick={() => void voice.connect()}>
            <Mic className="mr-1 h-3 w-3" />开始语音
          </SilverButton>}
          {voice.playbackBlocked && <SilverButton variant="ghost" onClick={() => void voice.resumePlayback()}><Volume2 className="mr-1 h-3 w-3" />允许播放声音</SilverButton>}
        </div>
      </div>
      {!ready && !voice.availability.isLoading && <p className="text-xs text-text-muted">实时语音尚未配置完成，文字面试可正常使用。</p>}
      {ready && !enabled && <p className="text-xs text-text-muted">开始或恢复面试后即可连接麦克风。</p>}
      {ready && enabled && voice.phase === 'idle' && <p className="text-xs text-text-muted">允许麦克风后直接说话，停顿后会自动提交回答。</p>}
      {voice.transcript && <div className="flex items-center justify-between gap-3 rounded-md bg-surface-hover p-2 text-sm text-text-primary">
        <span className="min-w-0 break-words">{voice.transcript}</span>
        <SilverButton variant="ghost" disabled={!canSend} onClick={voice.sendTranscript}>发送识别文本</SilverButton>
      </div>}
      {voice.error && <p role="alert" className="text-xs text-amber-300">{voice.error}</p>}
      {voice.availability.isError && <p role="alert" className="text-xs text-amber-300">语音服务状态加载失败，请稍后重试。</p>}
    </GlassCard>
  );
}
