import type { DaySchedule, OccupiedInterval, Slot } from "./types";
import { Temporal } from "temporal-polyfill";

function contains(ranges: DaySchedule["working"], minute: number) {
  return ranges.some(({ start, end }) => start <= minute && minute < end);
}

function fits(
  start: Temporal.Instant,
  durationMinutes: number,
  date: Temporal.PlainDate,
  timeZone: string,
  shopDay: DaySchedule,
  barberDay: DaySchedule,
) {
  const end = start.add({ minutes: durationMinutes });
  const localEnd = end.toZonedDateTimeISO(timeZone);
  const endDate = Temporal.PlainDate.compare(localEnd.toPlainDate(), date);
  if (
    endDate !== 0 &&
    (endDate !== 1 || localEnd.hour !== 0 || localEnd.minute !== 0)
  )
    return false;

  for (let elapsed = 0; elapsed < durationMinutes; elapsed++) {
    const local = start.add({ minutes: elapsed }).toZonedDateTimeISO(timeZone);
    if (Temporal.PlainDate.compare(local.toPlainDate(), date) !== 0)
      return false;
    const minute = local.hour * 60 + local.minute;
    if (
      !contains(shopDay.working, minute) ||
      !contains(barberDay.working, minute) ||
      shopDay.breaks.some(
        ({ start, end }) => start <= minute && minute < end,
      ) ||
      barberDay.breaks.some(({ start, end }) => start <= minute && minute < end)
    )
      return false;
  }
  return true;
}

export function fitsScheduleInterval({
  start,
  durationMinutes,
  date,
  timeZone,
  shopDay,
  barberDay,
}: {
  start: Temporal.Instant;
  durationMinutes: number;
  date: Temporal.PlainDate;
  timeZone: string;
  shopDay: DaySchedule;
  barberDay: DaySchedule;
}) {
  return fits(start, durationMinutes, date, timeZone, shopDay, barberDay);
}

export function calculateSlots({
  date,
  timeZone,
  now,
  durationMinutes,
  shopDay,
  barberDay,
  occupied = [],
}: {
  date: string;
  timeZone: string;
  now: string;
  durationMinutes: number;
  shopDay: DaySchedule;
  barberDay: DaySchedule;
  occupied?: readonly OccupiedInterval[];
}): Slot[] {
  const localDate = Temporal.PlainDate.from(date);
  const nowInstant = Temporal.Instant.from(now);
  const nowLocalDate = nowInstant.toZonedDateTimeISO(timeZone).toPlainDate();
  if (
    Temporal.PlainDate.compare(localDate, nowLocalDate) < 0 ||
    Temporal.PlainDate.compare(localDate, nowLocalDate.add({ days: 30 })) > 0
  )
    return [];

  const earliestStart = nowInstant.add({ hours: 1 });
  const slots = new Map<string, Slot>();
  for (let minute = 0; minute < 1440; minute += 15) {
    const hour = Math.floor(minute / 60);
    const minuteOfHour = minute % 60;
    const label = `${String(hour).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")}`;
    for (const disambiguation of ["earlier", "later"] as const) {
      const zoned = Temporal.ZonedDateTime.from(
        {
          timeZone,
          year: localDate.year,
          month: localDate.month,
          day: localDate.day,
          hour,
          minute: minuteOfHour,
        },
        { disambiguation },
      );
      const roundTrip = zoned.toPlainDateTime();
      if (
        roundTrip.hour !== hour ||
        roundTrip.minute !== minuteOfHour ||
        roundTrip.second !== 0
      )
        continue;
      const start = zoned.toInstant();
      if (Temporal.Instant.compare(start, earliestStart) < 0) continue;
      if (
        !fits(start, durationMinutes, localDate, timeZone, shopDay, barberDay)
      )
        continue;
      const end = start.add({ minutes: durationMinutes });
      if (
        occupied.some(
          (interval) =>
            Temporal.Instant.compare(start, interval.end) < 0 &&
            Temporal.Instant.compare(end, interval.start) > 0,
        )
      )
        continue;
      slots.set(start.toString(), {
        start: start.toString(),
        end: end.toString(),
        localStart: label,
        offset: zoned.offset,
      });
    }
  }
  return [...slots.values()].sort((left, right) =>
    left.start.localeCompare(right.start),
  );
}
