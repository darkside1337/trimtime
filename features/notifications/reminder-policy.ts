const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export function getReminderDueAt(input: {
  startAt: Date;
  now: Date;
}): Date | null {
  const startAtMs = input.startAt.getTime();
  const nowMs = input.now.getTime();
  if (!Number.isFinite(startAtMs) || !Number.isFinite(nowMs)) return null;
  if (startAtMs - nowMs <= REMINDER_LEAD_MS) return null;

  return new Date(startAtMs - REMINDER_LEAD_MS);
}
