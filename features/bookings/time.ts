import { Temporal } from "temporal-polyfill";

export function resolveOwnerStartChoices(
  date: string,
  time: string,
  timeZone: string,
): { startAt: string; offset: string }[] {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    return [];
  }

  try {
    const local = `${date}T${time}`;
    const choices = (["earlier", "later"] as const).flatMap(
      (disambiguation) => {
        const zoned = Temporal.ZonedDateTime.from(`${local}[${timeZone}]`, {
          disambiguation,
        });
        if (
          zoned.toPlainDate().toString() !== date ||
          zoned.toPlainTime().toString({ smallestUnit: "minute" }) !== time
        ) {
          return [];
        }

        return [
          { startAt: zoned.toInstant().toString(), offset: zoned.offset },
        ];
      },
    );

    return [
      ...new Map(choices.map((choice) => [choice.startAt, choice])).values(),
    ];
  } catch {
    return [];
  }
}
