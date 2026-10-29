import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { EyeOff, MonitorOff, UserX, RefreshCw, ShieldAlert } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import type { ProctorEvent } from '@/types/interview';

/** 事件类型 → i18n key */
function eventTypeKey(type: string): string {
  switch (type) {
    case 'TAB_SWITCH':
      return 'proctor.eventTabSwitch';
    case 'WINDOW_BLUR':
      return 'proctor.eventWindowBlur';
    case 'CAMERA_DENIED':
      return 'proctor.eventCameraDenied';
    case 'CAMERA_OFF':
      return 'proctor.eventCameraOff';
    case 'CAMERA_ON':
      return 'proctor.eventCameraOn';
    case 'GAZE_AWAY':
      return 'proctor.eventGazeAway';
    case 'FACE_LOST':
      return 'proctor.eventFaceLost';
    default:
      return 'proctor.eventUnknown';
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** 实时数值项：按事件类型聚合计数与总时长 */
function StatCell({
  icon,
  label,
  count,
  hint,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 ${
        highlight && count > 0
          ? 'border-amber-400/40 bg-amber-400/10'
          : 'border-border-subtle bg-surface-overlay'
      }`}
    >
      <span className="flex items-center gap-1.5 text-xs text-text-muted">
        {icon}
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-text-primary">{count}</span>
      {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
    </div>
  );
}

/**
 * 防作弊实时监控面板（面试间右侧，WebSocket 逐条推送聚合）。
 *
 * <p>数据源：候选端上报的 PROCTOR_EVENT 广播（管理端观察者连接实时接收），无需手动刷新。
 */
export function ProctorMonitorPanel({
  events,
  isLoading = false,
}: {
  events?: ProctorEvent[];
  isLoading?: boolean;
}) {
  const { t } = useTranslation();
  const list = events ?? [];

  const stats = useMemo(() => {
    const count = (type: string) =>
      list.filter((e) => e.eventType === type).length;
    const totalMs = (type: string) =>
      list
        .filter((e) => e.eventType === type)
        .reduce((s, e) => s + Number(e.durationMs ?? 0), 0);
    return {
      tabSwitch: count('TAB_SWITCH'),
      blur: count('WINDOW_BLUR'),
      blurMs: totalMs('WINDOW_BLUR'),
      gazeAway: count('GAZE_AWAY'),
      faceLost: count('FACE_LOST'),
    };
  }, [list]);

  const blurHint = stats.blurMs > 0 ? formatDuration(Math.round(stats.blurMs)) : undefined;

  // 最近事件倒序（最新在前）
  const sorted = useMemo(
    () => [...list].sort((a, b) => b.id - a.id).slice(0, 10),
    [list],
  );

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-text-muted">
          <ShieldAlert className="h-4 w-4" />
          {t('proctor.liveTitle')}
        </h3>
        {isLoading && (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-text-muted" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCell
          icon={<MonitorOff className="h-3.5 w-3.5" />}
          label={t('proctor.eventTabSwitch')}
          count={stats.tabSwitch}
          highlight
        />
        <StatCell
          icon={<EyeOff className="h-3.5 w-3.5" />}
          label={t('proctor.eventWindowBlur')}
          count={stats.blur}
          hint={blurHint ? `${t('proctor.totalOffFocusLabel')} ${blurHint}` : undefined}
        />
        <StatCell
          icon={<EyeOff className="h-3.5 w-3.5" />}
          label={t('proctor.eventGazeAway')}
          count={stats.gazeAway}
          highlight
        />
        <StatCell
          icon={<UserX className="h-3.5 w-3.5" />}
          label={t('proctor.eventFaceLost')}
          count={stats.faceLost}
          highlight
        />
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs text-text-muted">{t('proctor.liveActivity')}</p>
        {list.length === 0 ? (
          <p className="text-sm text-text-muted">{t('proctor.empty')}</p>
        ) : (
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {sorted.map((e) => (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-overlay px-3 py-2 text-sm"
              >
                <span className="text-text-primary">{t(eventTypeKey(e.eventType))}</span>
                <span className="flex items-center gap-3 text-xs text-text-muted">
                  {formatDuration(e.durationMs) && <span>{formatDuration(e.durationMs)}</span>}
                  <span>{formatTime(e.occurredAt)}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}