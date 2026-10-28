import { useCallback, useState } from "react";
import { dayScheduleSchema } from "../schemas";
import {
  saveBarberDateScheduleAction,
  saveShopDateScheduleAction,
} from "../actions";
import type { DateAvailabilityView, DateScheduleView } from "../types";
import { parseDraftMinute } from "../schedule-draft";
import type { DateOverrideDraft } from "../components/date-override-fields";
import { dateRangeDrafts } from "../date-editor";
import type { ScheduleTarget } from "../types";

export function useDateOverrideDraft() {
  const [draft, setDraft] = useState<DateOverrideDraft>({
    working: [],
    breaks: [],
    closed: false,
    override: true,
  });
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function changeDraft(next: DateOverrideDraft) {
    setDraft(next);
    setDirty(true);
    setFieldErrors({});
  }

  function discardChanges() {
    setDirty(false);
  }

  const loadDraft = useCallback((state: DateScheduleView | undefined) => {
    const day = state?.override;
    setDraft({
      working: dateRangeDrafts(day?.working),
      breaks: dateRangeDrafts(day?.breaks),
      closed: state?.closed ?? false,
      override: day !== null && day !== undefined,
    });
    setDirty(false);
    setFieldErrors({});
  }, []);

  async function save({
    date,
    target,
    data,
  }: {
    date: string;
    target: ScheduleTarget;
    data: DateAvailabilityView | null;
  }) {
    if (!date || !data) return { type: "not-ready" as const };
    if (
      draft.override &&
      [...draft.working, ...draft.breaks].some(
        ({ start, end }) =>
          parseDraftMinute(start, false) === null ||
          parseDraftMinute(end, true) === null,
      )
    ) {
      return { type: "invalid" as const };
    }
    const parsedDay = dayScheduleSchema.safeParse({
      working: draft.working.map(({ start, end }) => ({
        start: parseDraftMinute(start, false)!,
        end: parseDraftMinute(end, true)!,
      })),
      breaks: draft.breaks.map(({ start, end }) => ({
        start: parseDraftMinute(start, false)!,
        end: parseDraftMinute(end, true)!,
      })),
    });
    if (draft.override && !parsedDay.success) {
      const errors = Object.fromEntries(
        parsedDay.error.issues.map((issue) => {
          const group = issue.path[0] === "breaks" ? "break" : "hours";
          const index = typeof issue.path[1] === "number" ? issue.path[1] : 0;
          const endpoint = issue.path[2] === "end" ? "end" : "start";
          return [`dated-${group}-${endpoint}-${index}`, issue.message];
        }),
      );
      setFieldErrors(errors);
      document.getElementById(Object.keys(errors)[0] ?? "")?.focus();
      return { type: "invalid" as const };
    }
    setFieldErrors({});
    const state =
      target.kind === "shop"
        ? data.shop
        : data.barbers.find((barber) => barber.id === target.barberId)
            ?.schedule;
    if (!state) return { type: "not-ready" as const };
    const input = {
      date,
      timeZone: data.timeZone,
      override: draft.override
        ? parsedDay.success
          ? parsedDay.data
          : { working: [], breaks: [] }
        : null,
      closed: draft.closed,
      revision: state.revision,
    };
    try {
      const result =
        target.kind === "shop"
          ? await saveShopDateScheduleAction(input)
          : await saveBarberDateScheduleAction({
              ...input,
              barberId: target.barberId,
            });
      if (!result.success)
        return { type: "error" as const, error: result.error };
      setDirty(false);
      return { type: "saved" as const };
    } catch {
      return { type: "uncertain" as const };
    }
  }

  return {
    draft,
    dirty,
    fieldErrors,
    changeDraft,
    discardChanges,
    loadDraft,
    save,
  };
}
