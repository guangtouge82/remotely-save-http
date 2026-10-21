export type SyncProgress = Readonly<{
  percent: number;
  state: "running" | "success" | "error";
}>;

const STEP_PERCENT: Readonly<Record<number, number>> = {
  1: 2,
  2: 5,
  3: 8,
  4: 11,
  5: 14,
  6: 17,
  7: 20,
};

export const startSyncProgress = (): SyncProgress => ({ percent: 0, state: "running" });

export const advanceSyncProgress = (
  progress: SyncProgress,
  step: number
): SyncProgress => ({
  ...progress,
  percent: Math.max(progress.percent, STEP_PERCENT[step] ?? 0),
});

export const progressForCompletedFiles = (
  progress: SyncProgress,
  completed: number,
  total: number
): SyncProgress => {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeCompleted = Number.isFinite(completed)
    ? Math.max(0, Math.min(completed, safeTotal))
    : 0;
  const percent = safeTotal > 0
    ? 20 + Math.floor((75 * safeCompleted) / safeTotal)
    : 20;
  return { ...progress, percent: Math.max(progress.percent, percent) };
};

export const completeSyncProgress = (
  progress: SyncProgress,
  succeeded: boolean
): SyncProgress => ({
  percent: succeeded ? 100 : progress.percent,
  state: succeeded ? "success" : "error",
});
