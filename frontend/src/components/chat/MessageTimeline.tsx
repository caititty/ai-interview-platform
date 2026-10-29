import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { QuestionBubble } from './QuestionBubble';
import { AnswerBubble } from './AnswerBubble';
import { EndBubble } from './EndBubble';
import { Loader2 } from 'lucide-react';
import type { ChatMessage } from '@/types/interview';

interface MessageTimelineProps {
  messages: ChatMessage[];
  muteAudio?: boolean;
  awaitingResponse?: boolean;
}

/** 消息时间线：渲染 ChatMessage 列表，自动滚动到底部 */
export function MessageTimeline({ messages, muteAudio = false, awaitingResponse = false }: MessageTimelineProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // 消息变化时自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awaitingResponse]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-sm text-text-muted">{t('interviews.waitingToStart')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto">
      {messages.map((msg) => {
        if (msg.role === 'system') {
          return <EndBubble key={msg.id} message={msg} />;
        }
        return msg.role === 'question' ? (
          <QuestionBubble key={msg.id} message={msg} muteAudio={muteAudio} />
        ) : (
          <AnswerBubble key={msg.id} message={msg} />
        );
      })}
      {awaitingResponse && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-border-default bg-surface-hover p-4 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('interviews.preparingNextQuestion')}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
