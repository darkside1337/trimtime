import type { ActionFieldErrors } from "@/lib/action-result";
import type { DaySchedule, MinuteRange, WeeklySchedule } from "./types";

export const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const emptyWeek: WeeklySchedule = days.map(() => ({
  working: [],
  breaks: [],
}));

export type DraftRange = { start: string; end: string };
type DraftDay = { working: DraftRange[]; breaks: DraftRange[] };
export type DraftWeek = DraftDay[];

export function parseDraftMinute(
  value: string,
  allowMidnight: boolean,
): number | null {
  if (allowMidnight && value === "24:00") return 1440;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const mins = Number(match[2]);
  return hour < 24 && mins < 60 ? hour * 60 + mins : null;
}

const formatMinute = (minute: number) =>
  minute === 1440
    ? "24:00"
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export { formatMinute as formatDraftMinute };

export const weeklyOpenMinutes = (week: WeeklySchedule) =>
  week.reduce(
    (total, day) =>
      total +
      day.working.reduce(
        (minutes, range) => minutes + range.end - range.start,
        0,
      ) -
      day.breaks.reduce(
        (minutes, range) => minutes + range.end - range.start,
        0,
      ),
    0,
  );

export function toDraft(week: WeeklySchedule): DraftWeek {
  return week.map((day) => ({
    working: day.working.map(({ start, end }) => ({
      start: formatMinute(start),
      end: formatMinute(end),
    })),
    breaks: day.breaks.map(({ start, end }) => ({
      start: formatMinute(start),
      end: formatMinute(end),
    })),
  }));
}

export function toWeek(draft: DraftWeek): WeeklySchedule | null {
  const week: WeeklySchedule = [];
  for (const day of draft) {
    const parse = (ranges: DraftRange[]): MinuteRange[] | null => {
      const result: MinuteRange[] = [];
      for (const range of ranges) {
        const start = parseDraftMinute(range.start, false);
        const end = parseDraftMinute(range.end, true);
        if (start === null || end === null) return null;
        result.push({ start, end });
      }
      return result;
    };
    const working = parse(day.working);
    const breaks = parse(day.breaks);
    if (!working || !breaks) return null;
    week.push({ working, breaks } satisfies DaySchedule);
  }
  return week;
}

export function draftErrors(draft: DraftWeek): ActionFieldErrors {
  const errors: ActionFieldErrors = {};
  draft.forEach((day, dayIndex) => {
    for (const field of ["working", "breaks"] as const)
      day[field].forEach((range, rangeIndex) => {
        for (const edge of ["start", "end"] as const)
          if (parseDraftMinute(range[edge], edge === "end") === null)
            errors[`week.${dayIndex}.${field}.${rangeIndex}.${edge}`] = [
              "Enter a valid 24-hour time.",
            ];
      });
  });
  return errors;
}

export function draftFieldId(path: string) {
  const [, day, field, range, edge] = path.split(".");
  if (field === "breaks") return `break-${day}-${range}`;
  return `${field === "working" ? "work" : "break"}-${day}-${range}-${edge}`;
}

export function draftDayMinutes(day: DraftDay) {
  const rangeMinutes = (ranges: DraftRange[]) =>
    ranges.reduce(
      (total, range) =>
        total +
        ((parseDraftMinute(range.end, true) ?? 0) -
          (parseDraftMinute(range.start, false) ?? 0)),
      0,
    );
  return Math.max(0, rangeMinutes(day.working) - rangeMinutes(day.breaks));
}

export function formatHours(minutes: number) {
  return minutes % 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes / 60}h`;
}
