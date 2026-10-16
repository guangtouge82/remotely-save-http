export const SCHEDULED_MERGE_INTERVALS_MINUTES = [1, 5, 10, 30] as const;

export function normalizeScheduledMergeInterval(value: unknown): number {
  return value === -1 ||
    SCHEDULED_MERGE_INTERVALS_MINUTES.some((minutes) => minutes === value)
    ? value as number
    : 5;
}
