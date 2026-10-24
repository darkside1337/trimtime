import type { WeeklySchedule } from "./types";

export function hasUsableRecurringHours({
  durationMinutes,
  shopWeek,
  barberWeek,
}: {
  durationMinutes: string;
  shopWeek: WeeklySchedule;
  barberWeek: WeeklySchedule;
}): boolean {
  if (!/^\d+$/.test(durationMinutes) || durationMinutes.length > 4)
    return false;
  const duration = Number(durationMinutes);
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440) {
    return false;
  }

  return shopWeek.some((shopDay, day) => {
    const barberDay = barberWeek[day];
    if (!barberDay) return false;
    const intersections = shopDay.working
      .flatMap((shopRange) =>
        barberDay.working.flatMap((barberRange) => {
          const start = Math.max(shopRange.start, barberRange.start);
          const end = Math.min(shopRange.end, barberRange.end);
          return start < end ? [{ start, end }] : [];
        }),
      )
      .sort((a, b) => a.start - b.start);
    const windows = intersections.reduce<{ start: number; end: number }[]>(
      (ranges, range) => {
        const previous = ranges.at(-1);
        if (previous && range.start <= previous.end)
          previous.end = Math.max(previous.end, range.end);
        else ranges.push({ ...range });
        return ranges;
      },
      [],
    );
    for (const { start, end } of windows) {
      for (
        let candidate = Math.ceil(start / 15) * 15;
        candidate + duration <= end;
        candidate += 15
      ) {
        const candidateEnd = candidate + duration;
        if (
          !shopDay.breaks.some(
            (range) => range.start < candidateEnd && range.end > candidate,
          ) &&
          !barberDay.breaks.some(
            (range) => range.start < candidateEnd && range.end > candidate,
          )
        )
          return true;
      }
    }
    return false;
  });
}
