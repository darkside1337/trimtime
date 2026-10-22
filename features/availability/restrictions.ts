import type { DaySchedule, DateScheduleView } from "./types";

export function resolveDateSchedule(
  recurring: DaySchedule,
  state: DateScheduleView | null,
): DaySchedule {
  if (state?.closed) return { working: [], breaks: [] };
  return state?.override ?? recurring;
}
