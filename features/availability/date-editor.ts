import { formatDraftMinute } from "./schedule-draft";
import type { DraftRange } from "./schedule-draft";

export const dateRangeDrafts = (
  ranges: { start: number; end: number }[] = [],
): DraftRange[] =>
  ranges.map(({ start, end }) => ({
    start: formatDraftMinute(start),
    end: formatDraftMinute(end),
  }));

export const displayBlockInstant = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
