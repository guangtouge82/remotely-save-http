export const SCHEDULED_MERGE_INTERVALS_SECONDS = [5, 15, 60, 300] as const;

export function normalizeScheduledMergeIntervalSeconds(value: unknown): number {
  return value === -1 ||
    SCHEDULED_MERGE_INTERVALS_SECONDS.some((seconds) => seconds === value)
    ? value as number
    : 5;
}
