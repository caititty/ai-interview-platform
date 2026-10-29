import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import type { InterviewPlan } from '@/types/interview';

interface RoundTimelineProps {
  planJson: string | null;
  currentRoundId: number | null;
}

/** 轮次进度追踪：已完成轮次对勾 / 进行中高亮 / 未开始灰色，轮次切换时自动更新。 */
export function RoundTimeline({ planJson, currentRoundId }: RoundTimelineProps) {
  const { t } = useTranslation();
  let questions: { questionId: string; topic: string }[] = [];

  if (planJson) {
    try {
      const plan = JSON.parse(planJson) as InterviewPlan;
      questions = plan.questions ?? [];
    } catch {
      // 解析失败时使用空数组
    }
  }

  if (questions.length === 0) {
    return (
      <GlassCard className="p-5">
        <h3 className="mb-3 text-sm font-medium text-text-muted">{t('interviews.roundProgress')}</h3>
        <p className="text-sm text-text-muted">{t('interviews.noRoundData')}</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <h3 className="mb-4 text-sm font-medium text-text-muted">{t('interviews.roundProgress')}</h3>
      <div className="space-y-0">
        {questions.map((q, i) => {
          const roundId = i + 1;
          const isAnswered =
            currentRoundId != null && roundId < currentRoundId;
          const isInProgress =
            currentRoundId != null && roundId === currentRoundId;

          return (
            <div key={q.questionId} className="relative pl-6 pb-4 last:pb-0">
              {/* 连线 */}
              {i < questions.length - 1 && (
                <div className="absolute left-[3px] top-3 h-full w-px bg-surface-hover" />
              )}
              {/* 节点：对勾(已完成) / 高亮(进行中) / 空心(未开始) */}
              <div
                className={cn(
                  'absolute left-0 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border transition-all',
                  isAnswered && 'border-success bg-success',
                  isInProgress &&
                    'border-silver-200 bg-silver-200 shadow-[0_0_10px_var(--shadow-glow)] animate-pulse-slow',
                  !isAnswered &&
                    !isInProgress &&
                    'border-border-strong bg-transparent',
                )}
              >
                {isAnswered && <Check className="h-2.5 w-2.5 text-space-900" strokeWidth={3.5} />}
              </div>
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-1.5 py-1 transition-all',
                  isInProgress && 'bg-surface-hover',
                )}
              >
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    isInProgress ? 'text-silver-200' : 'text-text-muted',
                  )}
                >
                  Q{roundId}
                </span>
                <span
                  className={cn(
                    'text-sm',
                    isAnswered
                      ? 'text-text-primary'
                      : isInProgress
                        ? 'font-medium text-silver-100'
                        : 'text-text-muted',
                  )}
                >
                  {q.topic}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}