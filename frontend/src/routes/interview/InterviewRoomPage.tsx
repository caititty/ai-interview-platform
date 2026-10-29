import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-dot';
import { PageHeader, ErrorState } from '@/components/common/PageHeader';
import { MessageTimeline } from '@/components/chat/MessageTimeline';
import { AnswerInput } from '@/components/chat/AnswerInput';
import { DisconnectOverlay } from '@/components/chat/DisconnectOverlay';
import { ActionButtons } from '@/components/interview/ActionButtons';
import { RoundTimeline } from '@/components/interview/RoundTimeline';
import { ProctorMonitorPanel } from '@/components/interview/ProctorMonitorPanel';
import { useInterview, useInterviewRounds, useResumeInterview } from '@/api/interview';
import { useInterviewSession } from '@/hooks/useInterviewSession';
import { useRealtimeVoice } from '@/hooks/useRealtimeVoice';
import { RealtimeVoicePanel } from '@/components/interview/RealtimeVoicePanel';
import { useSessionStore } from '@/stores/sessionStore';
import type { SessionStatus } from '@/types/interview';

export function InterviewRoomPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const interviewId = id ? Number(id) : undefined;

  const { data: interview, isLoading, isError, error } = useInterview(interviewId);
  const { data: rounds } = useInterviewRounds(interviewId);
  const resumeMutation = useResumeInterview();

  const session = useInterviewSession({ sessionId: interviewId ?? null });
  const isObserver = interview?.accessMode === 'CANDIDATE_ONLY';
  const voiceEnabled = !isObserver && session.status === 'IN_PROGRESS' && session.isConnected;
  const voice = useRealtimeVoice({ sessionId: interviewId ?? null, enabled: voiceEnabled, onAnswer: session.submitAnswer });
  const setSession = useSessionStore((s) => s.setSession);
  const setStatus = useSessionStore((s) => s.setStatus);
  const resetStore = useSessionStore((s) => s.reset);
  const addQuestion = useSessionStore((s) => s.addQuestion);
  const addAnswer = useSessionStore((s) => s.addAnswer);
  const addSystem = useSessionStore((s) => s.addSystem);
  const proctorEvents = useSessionStore((s) => s.proctorEvents);
  const queryClient = useQueryClient();
  const { connect, disconnect } = session;

  // WebSocket 连接（只依赖 interviewId，不受 rounds 加载影响）
  useEffect(() => {
    if (!interviewId) return;

    resetStore();
    // React StrictMode 会立即清理并重建 effect，延后握手可避免短连接触发服务端自动暂停。
    const connectionTimer = setTimeout(connect, 0);

    return () => {
      clearTimeout(connectionTimer);
      disconnect();
    };
  }, [interviewId, connect, disconnect, resetStore]);

  // 历史消息恢复（依赖 rounds，addQuestion 内部有 roundId 去重）
  useEffect(() => {
    if (!rounds || rounds.length === 0) return;

    rounds.forEach((r) => {
      addQuestion(r.id, r.seq ?? undefined, r.question, r.followUpType ?? undefined, r.parentSeq ?? undefined, r.followUpIndex ?? undefined);
      if (r.answer) {
        addAnswer(r.answer, r.id);
      }
    });
  }, [rounds, addQuestion, addAnswer]);

  // 同步 REST 状态到 store
  useEffect(() => {
    if (interview) {
      setSession(interview.id, interview.status);
    }
  }, [interview, setSession]);

  // 结束回执（重连兜底）：终态/评估中时用 REST 数据补齐 end 回执，去重由 store.addSystem 保证
  useEffect(() => {
    if (!interview) return;
    const st = session.status as SessionStatus;
    if (['EVALUATING', 'COMPLETED', 'CANCELLED', 'FAILED'].includes(st)) {
      addSystem(st, interview.finishedBy ?? undefined, interview.finishReason ?? undefined);
    }
  }, [session.status, interview, addSystem]);

  // WebSocket 错误提示
  useEffect(() => {
    if (session.error) {
      toast.error(session.error);
    }
  }, [session.error]);

  const handleResume = () => {
    if (!interviewId) return;
    resumeMutation.mutate(interviewId, {
      onSuccess: () => {
        toast.success(t('interviews.resumed'));
        setStatus('IN_PROGRESS');
        queryClient.invalidateQueries({ queryKey: ['interviews', interviewId] });
      },
      onError: (err: Error) => toast.error(err.message || t('interviews.resumeFailed')),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('interviews.roomTitle')} />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !interview) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('interviews.roomTitle')} />
        <ErrorState
          message={error?.message || t('interviews.notFound')}
          onRetry={() => navigate('/interviews')}
        />
      </div>
    );
  }

  // CANDIDATE_ONLY 模式：管理端以观察者进入（WS 旁路，实时看轮次进度与防作弊）
  const status = session.status;
  const isTerminal = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(status);

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4 lg:flex-row">
      {/* 左侧：顶部栏 + 消息时间线 + 回答输入（观察模式下无控制/答题） */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-4">
        <GlassCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/interviews/${interview.id}`)}
              className="text-xs text-silver-300 hover:text-silver-100 transition-colors"
            >
              {t('interviews.backToConsoleShort')}
            </button>
            <span className="text-sm font-medium text-text-primary">
              {t('interviews.roomIdLabel', { id: interview.id })}
            </span>
            <StatusBadge status={status} />
            {isObserver && (
              <span className="flex items-center gap-1 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">
                <Eye className="h-3 w-3" />
                {t('interviews.observerMode')}
              </span>
            )}
          </div>
          {!isObserver && (
            <ActionButtons
              status={status}
              onCancel={() => session.cancelInterview()}
              onPause={() => session.pauseInterview()}
              onFinish={() => session.finishInterview()}
              onResume={handleResume}
              onBack={() => navigate(`/interviews/${interview.id}`)}
            />
          )}
        </GlassCard>

        {/* 消息时间线 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageTimeline messages={session.messages} muteAudio={voice.active} awaitingResponse={session.isAwaitingResponse} />
        </div>

        {/* 回答输入区（观察模式隐藏） */}
        {!isObserver && (
          <RealtimeVoicePanel voice={voice} enabled={voiceEnabled} canSend={voiceEnabled && !session.isStreaming && !session.isAwaitingResponse} />
        )}
        {!isObserver && (
          <AnswerInput
            onSend={session.submitAnswer}
            disabled={!session.isConnected || !session.currentRoundId || session.isStreaming || session.isAwaitingResponse || status !== 'IN_PROGRESS'}
            speechDisabled={voice.active}
          />
        )}

        {/* 断线遮罩 */}
        {!session.isConnected && !isTerminal && (
          <DisconnectOverlay
            retryCount={session.retryCount}
            maxRetries={3}
            onReconnect={session.reconnect}
          />
        )}
      </div>

      {/* 右侧：轮次进度追踪 + 防作弊实时监控 */}
      <aside className="w-full shrink-0 space-y-4 overflow-y-auto lg:w-80">
        <RoundTimeline
          planJson={interview.planJson}
          currentRoundId={session.currentRoundId}
        />
        <ProctorMonitorPanel events={proctorEvents} />
      </aside>
    </div>
  );
}
