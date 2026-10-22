import { Temporal } from "temporal-polyfill";

export function getBlockBoundaryChoices(input: {
  date: string;
  minute: number;
  timeZone: string;
}): { instant: string; offset: string }[] {
  const date = Temporal.PlainDate.from(input.date).add({
    days: input.minute === 1440 ? 1 : 0,
  });
  const minute = input.minute === 1440 ? 0 : input.minute;
  if (
    !Number.isInteger(input.minute) ||
    input.minute < 0 ||
    input.minute > 1440
  )
    return [];
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  const choices = new Map<string, { instant: string; offset: string }>();
  for (const disambiguation of ["earlier", "later"] as const) {
    const zoned = Temporal.ZonedDateTime.from(
      {
        timeZone: input.timeZone,
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute: minuteOfHour,
      },
      { disambiguation },
    );
    if (
      zoned.hour === hour &&
      zoned.minute === minuteOfHour &&
      Temporal.PlainDate.compare(zoned.toPlainDate(), date) === 0
    ) {
      const instant = zoned.toInstant().toString();
      choices.set(instant, { instant, offset: zoned.offset });
    }
  }
  return [...choices.values()];
}
