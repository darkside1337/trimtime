"use client";

import { useEffect, useRef, useState } from "react";
import {
  draftErrors,
  draftFieldId,
  emptyWeek,
  toDraft,
  toWeek,
  type DraftRange,
  type DraftWeek,
} from "../schedule-draft";
import {
  reloadOwnSchedulesAction,
  saveBarberScheduleAction,
  saveShopScheduleAction,
} from "../actions";
import type { AvailabilityData } from "../queries";
import type { ActionFieldErrors } from "@/lib/action-result";
import type { ScheduleTarget } from "../types";

export function useRecurringSchedule(
  initial: AvailabilityData,
  invalidatePreview: () => void,
) {
  const [data, setData] = useState(initial);
  const [target, setTarget] = useState<ScheduleTarget>({ kind: "shop" });
  const [draft, setDraft] = useState(() => toDraft(initial.shop.week));
  const [original, setOriginal] = useState(() => toDraft(initial.shop.week));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [canReload, setCanReload] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ActionFieldErrors>({});
  const [breakDay, setBreakDay] = useState<number | null>(null);
  const [breakRangeIndex, setBreakRangeIndex] = useState<number | null>(null);
  const [breakRange, setBreakRange] = useState<DraftRange>({
    start: "12:00",
    end: "13:00",
  });
  const breakOpener = useRef<HTMLButtonElement | null>(null);
  const breakStartInput = useRef<HTMLInputElement | null>(null);
  const selectionVersion = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const schedule =
    target.kind === "shop"
      ? data.shop
      : data.barbers.find((item) => item.id === target.barberId)?.schedule;

  useEffect(() => {
    const first = Object.keys(fieldErrors).find((path) =>
      path.startsWith("week."),
    );
    if (first) document.getElementById(draftFieldId(first))?.focus();
  }, [fieldErrors]);

  function applyTarget(next: ScheduleTarget) {
    const nextSchedule =
      next.kind === "shop"
        ? data.shop
        : (data.barbers.find((item) => item.id === next.barberId)?.schedule ?? {
            week: emptyWeek,
            revision: 0,
          });
    setTarget(next);
    selectionVersion.current++;
    setDraft(toDraft(nextSchedule.week));
    setOriginal(toDraft(nextSchedule.week));
    setMessage("");
    setCanReload(false);
    setFieldErrors({});
    invalidatePreview();
  }

  function change(value: DraftWeek) {
    setDraft(value);
    setFieldErrors({});
    invalidatePreview();
  }
  function copyMonday() {
    const monday = draft[0];
    if (!monday) return;
    setDraft((week) =>
      week.map((day, index) =>
        index >= 1 && index <= 4
          ? {
              working: monday.working.map((r) => ({ ...r })),
              breaks: monday.breaks.map((r) => ({ ...r })),
            }
          : day,
      ),
    );
    setFieldErrors({});
    setMessage("Monday copied into the weekday draft. Save to apply.");
    invalidatePreview();
  }
  function copyShop() {
    setDraft(toDraft(data.shop.week));
    setFieldErrors({});
    invalidatePreview();
    setMessage("Shop hours copied into this barber draft. Save to apply.");
  }
  function addBreak(day: number, opener: HTMLButtonElement) {
    breakOpener.current = opener;
    setBreakDay(day);
    setBreakRangeIndex(null);
    setBreakRange({ start: "12:00", end: "13:00" });
  }
  function editBreak(day: number, range: number, opener: HTMLButtonElement) {
    breakOpener.current = opener;
    setBreakDay(day);
    setBreakRangeIndex(range);
    setBreakRange(draft[day]!.breaks[range]!);
  }
  function saveBreak() {
    if (breakDay !== null)
      setDraft((week) =>
        week.map((item, index) =>
          index !== breakDay
            ? item
            : {
                ...item,
                breaks:
                  breakRangeIndex === null
                    ? [...item.breaks, breakRange]
                    : item.breaks.map((range, i) =>
                        i === breakRangeIndex ? breakRange : range,
                      ),
              },
        ),
      );
    setFieldErrors({});
    setBreakDay(null);
    invalidatePreview();
  }
  async function save() {
    const invalid = draftErrors(draft);
    if (Object.keys(invalid).length) {
      setFieldErrors(invalid);
      setMessage("Check the highlighted schedule ranges.");
      return;
    }
    const week = toWeek(draft);
    if (!week) {
      setMessage("Enter every time as HH:MM. Use 24:00 only as an end time.");
      return;
    }
    const saveTarget = target;
    const version = selectionVersion.current;
    setPending(true);
    setMessage("");
    setFieldErrors({});
    invalidatePreview();
    try {
      const shopWasUnconfigured =
        saveTarget.kind === "shop" && data.shop.revision === 0;
      const result =
        saveTarget.kind === "shop"
          ? await saveShopScheduleAction({ week, revision: data.shop.revision })
          : await saveBarberScheduleAction({
              week,
              revision: schedule?.revision ?? 0,
              barberId: saveTarget.barberId,
            });
      if (!result.success) {
        if (version === selectionVersion.current) {
          setCanReload(result.error.code === "STALE_SCHEDULE");
          setMessage(result.error.message);
          setFieldErrors(result.fieldErrors ?? {});
        }
      } else {
        const saved = toDraft(result.data.week);
        if (version === selectionVersion.current) {
          setDraft(saved);
          setOriginal(saved);
          setMessage("Availability saved.");
          setCanReload(false);
        }
        setData((previous) =>
          saveTarget.kind === "shop"
            ? {
                ...previous,
                shop: result.data,
                ...(shopWasUnconfigured
                  ? {
                      barbers: previous.barbers.map((item) =>
                        item.archived
                          ? item
                          : { ...item, schedule: result.data },
                      ),
                    }
                  : {}),
              }
            : {
                ...previous,
                barbers: previous.barbers.map((item) =>
                  item.id === saveTarget.barberId
                    ? { ...item, schedule: result.data }
                    : item,
                ),
              },
        );
      }
    } catch {
      if (version === selectionVersion.current) {
        setCanReload(true);
        setMessage(
          "The save could not be confirmed. Your draft is still here; reload to check the saved version.",
        );
      }
    } finally {
      setPending(false);
      invalidatePreview();
    }
  }
  async function reload() {
    setPending(true);
    try {
      const latest = await reloadOwnSchedulesAction();
      if (!latest) {
        setMessage("Unable to reload availability.");
        return;
      }
      setData(latest);
      const next =
        target.kind === "shop"
          ? latest.shop
          : latest.barbers.find((item) => item.id === target.barberId)
              ?.schedule;
      if (next) {
        setDraft(toDraft(next.week));
        setOriginal(toDraft(next.week));
        setMessage("Saved availability reloaded.");
        setCanReload(false);
        invalidatePreview();
      }
    } catch {
      setMessage("Unable to reload availability. Try again.");
    } finally {
      setPending(false);
    }
  }
  return {
    data,
    target,
    schedule,
    draft,
    dirty,
    pending,
    message,
    canReload,
    fieldErrors,
    breakDay,
    breakRangeIndex,
    breakRange,
    setBreakRange,
    breakOpener,
    breakStartInput,
    applyTarget,
    change,
    copyMonday,
    copyShop,
    addBreak,
    editBreak,
    saveBreak,
    save,
    reload,
    closeBreak: () => setBreakDay(null),
  };
}
