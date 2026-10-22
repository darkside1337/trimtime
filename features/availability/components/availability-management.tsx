"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  reloadOwnSchedulesAction,
  previewOwnSlotsAction,
  saveBarberScheduleAction,
  saveShopScheduleAction,
} from "../actions";
import type { AvailabilityData } from "../queries";
import type { DaySchedule, MinuteRange, Slot, WeeklySchedule } from "../types";
import type { ActionFieldErrors } from "@/lib/action-result";

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const emptyWeek: WeeklySchedule = days.map(() => ({ working: [], breaks: [] }));
type DraftRange = { start: string; end: string };
type DraftDay = { working: DraftRange[]; breaks: DraftRange[] };
type DraftWeek = DraftDay[];
type Target = { kind: "shop" } | { kind: "barber"; barberId: string };

const time = (minute: number) =>
  minute === 1440
    ? "24:00"
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
function toDraft(week: WeeklySchedule): DraftWeek {
  return week.map((day) => ({
    working: day.working.map(({ start, end }) => ({
      start: time(start),
      end: time(end),
    })),
    breaks: day.breaks.map(({ start, end }) => ({
      start: time(start),
      end: time(end),
    })),
  }));
}
function minute(value: string, allowMidnight: boolean): number | null {
  if (allowMidnight && value === "24:00") return 1440;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const mins = Number(match[2]);
  return hour < 24 && mins < 60 ? hour * 60 + mins : null;
}
function toWeek(draft: DraftWeek): WeeklySchedule | null {
  const week: WeeklySchedule = [];
  for (const day of draft) {
    const parse = (ranges: DraftRange[]): MinuteRange[] | null => {
      const result: MinuteRange[] = [];
      for (const range of ranges) {
        const start = minute(range.start, false);
        const end = minute(range.end, true);
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

function draftErrors(draft: DraftWeek): ActionFieldErrors {
  const errors: ActionFieldErrors = {};
  draft.forEach((day, dayIndex) => {
    for (const field of ["working", "breaks"] as const)
      day[field].forEach((range, rangeIndex) => {
        for (const edge of ["start", "end"] as const)
          if (minute(range[edge], edge === "end") === null)
            errors[`week.${dayIndex}.${field}.${rangeIndex}.${edge}`] = [
              "Enter a valid 24-hour time.",
            ];
      });
  });
  return errors;
}

function fieldId(path: string) {
  const [, day, field, range, edge] = path.split(".");
  if (field === "breaks") return `break-${day}-${range}`;
  return `${field === "working" ? "work" : "break"}-${day}-${range}-${edge}`;
}

function ScheduleEditor({
  week,
  onChange,
  disabled,
  onAddBreak,
  onEditBreak,
  fieldErrors,
}: {
  week: DraftWeek;
  onChange: (week: DraftWeek) => void;
  disabled: boolean;
  onAddBreak: (day: number) => void;
  onEditBreak: (day: number, range: number) => void;
  fieldErrors: ActionFieldErrors;
}) {
  function update(
    dayIndex: number,
    field: "working" | "breaks",
    rangeIndex: number,
    key: "start" | "end",
    value: string,
  ) {
    onChange(
      week.map((day, index) =>
        index !== dayIndex
          ? day
          : {
              ...day,
              [field]: day[field].map((range, i) =>
                i !== rangeIndex ? range : { ...range, [key]: value },
              ),
            },
      ),
    );
  }
  function remove(
    dayIndex: number,
    field: "working" | "breaks",
    rangeIndex: number,
  ) {
    onChange(
      week.map((day, index) =>
        index !== dayIndex
          ? day
          : { ...day, [field]: day[field].filter((_, i) => i !== rangeIndex) },
      ),
    );
  }
  function add(dayIndex: number, field: "working" | "breaks") {
    onChange(
      week.map((day, index) =>
        index !== dayIndex
          ? day
          : {
              ...day,
              [field]: [
                ...day[field],
                field === "working"
                  ? { start: "09:00", end: "17:00" }
                  : { start: "12:00", end: "13:00" },
              ],
            },
      ),
    );
  }
  return (
    <div className="mt-6 grid gap-3">
      {week.map((day, dayIndex) => (
        <section
          key={days[dayIndex]}
          aria-labelledby={`day-${dayIndex}`}
          className="grid min-w-0 gap-2 border-b border-border py-4 sm:grid-cols-[130px_minmax(0,1fr)] sm:items-start sm:gap-5"
        >
          <h3 id={`day-${dayIndex}`} className="font-semibold sm:pt-2">
            {days[dayIndex]}
          </h3>
          <div className="grid min-w-0 gap-3">
            {day.working.length === 0 ? (
              <p className="text-sm text-muted-foreground">Closed</p>
            ) : (
              day.working.map((range, rangeIndex) => (
                <div
                  key={`work-${rangeIndex}`}
                  className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <div className="grid gap-1">
                    <Label
                      className="sr-only"
                      htmlFor={`work-${dayIndex}-${rangeIndex}-start`}
                    >
                      Opens
                    </Label>
                    <Input
                      id={`work-${dayIndex}-${rangeIndex}-start`}
                      value={range.start}
                      onChange={(event) =>
                        update(
                          dayIndex,
                          "working",
                          rangeIndex,
                          "start",
                          event.target.value,
                        )
                      }
                      disabled={disabled}
                      inputMode="numeric"
                      placeholder="09:00"
                      aria-invalid={Boolean(
                        fieldErrors[
                          `week.${dayIndex}.working.${rangeIndex}.start`
                        ],
                      )}
                      aria-describedby={
                        fieldErrors[
                          `week.${dayIndex}.working.${rangeIndex}.start`
                        ]
                          ? `time-format-hint work-${dayIndex}-${rangeIndex}-start-error`
                          : "time-format-hint"
                      }
                    />
                    {fieldErrors[
                      `week.${dayIndex}.working.${rangeIndex}.start`
                    ]?.map((error) => (
                      <span
                        id={`work-${dayIndex}-${rangeIndex}-start-error`}
                        key={error}
                        className="text-xs text-destructive"
                      >
                        {error}
                      </span>
                    ))}
                  </div>
                  <div className="grid gap-1">
                    <Label
                      className="sr-only"
                      htmlFor={`work-${dayIndex}-${rangeIndex}-end`}
                    >
                      Closes
                    </Label>
                    <Input
                      id={`work-${dayIndex}-${rangeIndex}-end`}
                      value={range.end}
                      onChange={(event) =>
                        update(
                          dayIndex,
                          "working",
                          rangeIndex,
                          "end",
                          event.target.value,
                        )
                      }
                      disabled={disabled}
                      inputMode="numeric"
                      placeholder="17:00"
                      aria-invalid={Boolean(
                        fieldErrors[
                          `week.${dayIndex}.working.${rangeIndex}.end`
                        ],
                      )}
                      aria-describedby={
                        fieldErrors[
                          `week.${dayIndex}.working.${rangeIndex}.end`
                        ]
                          ? `time-format-hint work-${dayIndex}-${rangeIndex}-end-error`
                          : "time-format-hint"
                      }
                    />
                    {fieldErrors[
                      `week.${dayIndex}.working.${rangeIndex}.end`
                    ]?.map((error) => (
                      <span
                        id={`work-${dayIndex}-${rangeIndex}-end-error`}
                        key={error}
                        className="text-xs text-destructive"
                      >
                        {error}
                      </span>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => remove(dayIndex, "working", rangeIndex)}
                  >
                    Remove hours
                  </Button>
                </div>
              ))
            )}
            {day.breaks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {day.breaks.map((range, rangeIndex) => (
                  <div
                    key={`break-${rangeIndex}`}
                    className="flex items-center rounded-full bg-muted text-sm"
                  >
                    <Button
                      id={`break-${dayIndex}-${rangeIndex}`}
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-l-full px-3"
                      disabled={disabled}
                      aria-invalid={Boolean(
                        fieldErrors[
                          `week.${dayIndex}.breaks.${rangeIndex}.start`
                        ] ||
                        fieldErrors[
                          `week.${dayIndex}.breaks.${rangeIndex}.end`
                        ],
                      )}
                      aria-describedby={
                        fieldErrors[
                          `week.${dayIndex}.breaks.${rangeIndex}.start`
                        ] ||
                        fieldErrors[`week.${dayIndex}.breaks.${rangeIndex}.end`]
                          ? `break-${dayIndex}-${rangeIndex}-error`
                          : undefined
                      }
                      aria-label={`Edit ${days[dayIndex]} break ${range.start} to ${range.end}`}
                      onClick={() => onEditBreak(dayIndex, rangeIndex)}
                    >
                      Break · {range.start}–{range.end}
                    </Button>
                    {(fieldErrors[
                      `week.${dayIndex}.breaks.${rangeIndex}.start`
                    ] ||
                      fieldErrors[
                        `week.${dayIndex}.breaks.${rangeIndex}.end`
                      ]) && (
                      <span
                        id={`break-${dayIndex}-${rangeIndex}-error`}
                        className="sr-only"
                      >
                        {[
                          ...(fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.start`
                          ] ?? []),
                          ...(fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.end`
                          ] ?? []),
                        ].join(" ")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-r-full px-2"
                      disabled={disabled}
                      aria-label={`Remove ${days[dayIndex]} break ${range.start} to ${range.end}`}
                      onClick={() => remove(dayIndex, "breaks", rangeIndex)}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => add(dayIndex, "working")}
              >
                Add hours
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={disabled || day.working.length === 0}
                onClick={() => onAddBreak(dayIndex)}
              >
                Add break
              </Button>
            </div>
          </div>
        </section>
      ))}
      <p id="time-format-hint" className="text-xs text-muted-foreground">
        Enter 24-hour times as HH:MM. Use 24:00 only for an end time. Adjacent
        ranges are allowed.
      </p>
    </div>
  );
}

export function AvailabilityManagement({
  initial,
}: {
  initial: AvailabilityData;
}) {
  const [data, setData] = useState(initial);
  const [target, setTarget] = useState<Target>({ kind: "shop" });
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
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const previewVersion = useRef(0);
  const selectionVersion = useRef(0);
  useEffect(() => {
    const clearPreview = () => {
      previewVersion.current++;
      setSlots(null);
    };
    window.addEventListener("trimtime:availability-changed", clearPreview);
    return () =>
      window.removeEventListener("trimtime:availability-changed", clearPreview);
  }, []);
  useEffect(() => {
    const first = Object.keys(fieldErrors).find((path) =>
      path.startsWith("week."),
    );
    if (first) document.getElementById(fieldId(first))?.focus();
  }, [fieldErrors]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const barber =
    target.kind === "barber"
      ? data.barbers.find((item) => item.id === target.barberId)
      : undefined;
  const schedule = target.kind === "shop" ? data.shop : barber?.schedule;
  const activeBarbers = data.barbers.filter((item) => !item.archived);
  const eligibleBarbers = useMemo(
    () =>
      data.barbers.filter(
        (item) =>
          !item.archived &&
          item.schedule &&
          (!serviceId ||
            data.services
              .find((service) => service.id === serviceId)
              ?.barberIds.includes(item.id)),
      ),
    [data, serviceId],
  );
  const services = data.services.filter((service) =>
    service.barberIds.some((id) =>
      activeBarbers.some((item) => item.id === id),
    ),
  );

  function switchTo(next: Target) {
    if (pending) return;
    if (dirty && !window.confirm("Discard your unsaved availability changes?"))
      return;
    const nextSchedule =
      next.kind === "shop"
        ? data.shop
        : (data.barbers.find((item) => item.id === next.barberId)?.schedule ?? {
            week: emptyWeek,
            revision: 0,
          });
    setTarget(next);
    selectionVersion.current++;
    previewVersion.current++;
    setDraft(toDraft(nextSchedule.week));
    setOriginal(toDraft(nextSchedule.week));
    setMessage("");
    setCanReload(false);
    setFieldErrors({});
    setSlots(null);
  }

  async function save() {
    const invalidDraft = draftErrors(draft);
    if (Object.keys(invalidDraft).length) {
      setFieldErrors(invalidDraft);
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
    const scheduleRevision = schedule?.revision ?? 0;
    setPending(true);
    setMessage("");
    setFieldErrors({});
    setSlots(null);
    try {
      const shopWasUnconfigured =
        saveTarget.kind === "shop" && data.shop.revision === 0;
      const result =
        saveTarget.kind === "shop"
          ? await saveShopScheduleAction({ week, revision: data.shop.revision })
          : await saveBarberScheduleAction({
              week,
              revision: scheduleRevision,
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
        }
        if (version === selectionVersion.current) {
          setMessage("Availability saved.");
          setCanReload(false);
        }
        if (saveTarget.kind === "shop")
          setData((previous) => ({
            ...previous,
            shop: result.data,
            ...(shopWasUnconfigured
              ? {
                  barbers: previous.barbers.map((item) =>
                    item.archived ? item : { ...item, schedule: result.data },
                  ),
                }
              : {}),
          }));
        else
          setData((previous) => ({
            ...previous,
            barbers: previous.barbers.map((item) =>
              item.id === saveTarget.barberId
                ? { ...item, schedule: result.data }
                : item,
            ),
          }));
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
      const nextSchedule =
        target.kind === "shop"
          ? latest.shop
          : latest.barbers.find((item) => item.id === target.barberId)
              ?.schedule;
      if (nextSchedule) {
        setDraft(toDraft(nextSchedule.week));
        setOriginal(toDraft(nextSchedule.week));
        setMessage("Saved availability reloaded.");
        setCanReload(false);
      }
    } catch {
      setMessage("Unable to reload availability. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function preview() {
    setSlots(null);
    setMessage("");
    setPending(true);
    const version = previewVersion.current;
    try {
      const result = await previewOwnSlotsAction({ serviceId, barberId, date });
      if (result.success) {
        if (version === previewVersion.current) {
          setSlots(result.data.slots);
          setMessage(
            `Showing saved availability for ${result.data.date} in ${result.data.timeZone}.`,
          );
        }
      } else if (version === previewVersion.current)
        setMessage(result.error.message);
    } catch {
      if (version === previewVersion.current)
        setMessage("Unable to load a preview. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="availability-controls mt-10 grid gap-10">
      <section
        aria-labelledby="recurring-hours-heading"
        className="rounded-2xl border border-border p-5 sm:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="recurring-hours-heading"
              className="font-heading text-2xl font-bold"
            >
              Recurring hours
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Barber preferences copy shop hours once. Later shop edits do not
              overwrite them; bookable hours use both schedules.
            </p>
          </div>
          <p className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">
            Saved schedules · revision {schedule?.revision ?? 0}
          </p>
        </div>
        <div
          className="mt-6 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Schedule type"
        >
          <button
            id="shop-hours-tab"
            aria-controls="shop-hours-panel"
            tabIndex={target.kind === "shop" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={target.kind === "shop"}
            disabled={pending}
            className="min-h-11 rounded-lg border px-4 aria-selected:bg-secondary aria-selected:font-semibold"
            onClick={() => switchTo({ kind: "shop" })}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const tabs = [
                  ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "[role=tab]",
                  ) ?? []),
                ];
                const current = tabs.indexOf(event.currentTarget);
                const next =
                  event.key === "Home"
                    ? tabs[0]
                    : event.key === "End"
                      ? tabs.at(-1)
                      : tabs[
                          (current +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                            tabs.length
                        ];
                next?.focus();
                next?.click();
              }
            }}
          >
            Shop hours
          </button>
          <button
            id="barber-hours-tab"
            aria-controls="barber-hours-panel"
            tabIndex={target.kind === "barber" ? 0 : -1}
            type="button"
            role="tab"
            aria-selected={target.kind === "barber"}
            disabled={pending}
            className="min-h-11 rounded-lg border px-4 aria-selected:bg-secondary aria-selected:font-semibold"
            onClick={() => {
              const first = activeBarbers[0];
              if (first) switchTo({ kind: "barber", barberId: first.id });
            }}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const tabs = [
                  ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "[role=tab]",
                  ) ?? []),
                ];
                const current = tabs.indexOf(event.currentTarget);
                const next =
                  event.key === "Home"
                    ? tabs[0]
                    : event.key === "End"
                      ? tabs.at(-1)
                      : tabs[
                          (current +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                            tabs.length
                        ];
                next?.focus();
                next?.click();
              }
            }}
          >
            Barber hours
          </button>
        </div>
        {target.kind === "barber" && (
          <div className="mt-4 grid max-w-sm gap-2">
            <Label htmlFor="schedule-barber">Barber</Label>
            <select
              id="schedule-barber"
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={target.barberId}
              disabled={pending}
              onChange={(event) =>
                switchTo({ kind: "barber", barberId: event.target.value })
              }
            >
              {activeBarbers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {!data.shop.revision && (
              <p className="text-sm text-muted-foreground">
                Save shop hours first to initialize barber schedules.
              </p>
            )}
          </div>
        )}
        <div
          id={
            target.kind === "shop" ? "shop-hours-panel" : "barber-hours-panel"
          }
          role="tabpanel"
          aria-labelledby={
            target.kind === "shop" ? "shop-hours-tab" : "barber-hours-tab"
          }
          tabIndex={0}
        >
          {target.kind === "barber" && !data.shop.revision ? (
            <p className="mt-6 rounded-xl bg-muted p-5 text-sm">
              Barber hours are unavailable until you save the shop week.
            </p>
          ) : (
            <ScheduleEditor
              week={draft}
              onChange={(value) => {
                setDraft(value);
                setFieldErrors({});
                previewVersion.current++;
                setSlots(null);
              }}
              disabled={pending}
              fieldErrors={fieldErrors}
              onAddBreak={(index) => {
                setBreakDay(index);
                setBreakRangeIndex(null);
                setBreakRange({ start: "12:00", end: "13:00" });
              }}
              onEditBreak={(dayIndex, rangeIndex) => {
                setBreakDay(dayIndex);
                setBreakRangeIndex(rangeIndex);
                setBreakRange(draft[dayIndex]!.breaks[rangeIndex]!);
              }}
            />
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save hours"}
          </Button>
          {canReload && (
            <Button
              type="button"
              variant="outline"
              onClick={reload}
              disabled={pending}
            >
              Reload saved hours
            </Button>
          )}
        </div>
      </section>

      <section
        aria-labelledby="preview-heading"
        className="rounded-2xl border border-border bg-muted/40 p-5 sm:p-8"
      >
        <h2 id="preview-heading" className="font-heading text-2xl font-bold">
          Preview available starts
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Previews use saved schedules and current service settings. Save
          schedule edits before previewing; a preview does not reserve a time.
        </p>
        <p className="mt-2 text-sm font-medium">
          Shop time zone: {data.timeZone}
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="preview-service">Service</Label>
            <select
              id="preview-service"
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={serviceId}
              onChange={(event) => {
                setServiceId(event.target.value);
                setBarberId("");
                previewVersion.current++;
                setSlots(null);
              }}
            >
              <option value="">Choose a service</option>
              {services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.durationMinutes} min
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="preview-barber">Eligible barber</Label>
            <select
              id="preview-barber"
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={barberId}
              onChange={(event) => {
                setBarberId(event.target.value);
                previewVersion.current++;
                setSlots(null);
              }}
            >
              <option value="">Choose a barber</option>
              {eligibleBarbers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="preview-date">Date</Label>
            <Input
              id="preview-date"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                previewVersion.current++;
                setSlots(null);
              }}
            />
          </div>
        </div>
        {services.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Offer a service and assign it to an active barber to preview times.
          </p>
        )}
        <Button
          type="button"
          className="mt-5"
          disabled={pending || !serviceId || !barberId || !date}
          onClick={preview}
        >
          Preview times
        </Button>
        {slots !== null && (
          <div className="mt-5" aria-live="polite">
            <h3 className="font-semibold">Available starts</h3>
            {slots.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <li
                    key={slot.start}
                    className="rounded-full border bg-background px-3 py-2 text-sm tabular-nums"
                  >
                    {slot.localStart} · UTC{slot.offset}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No available starts match these saved schedules and public
                booking windows.
              </p>
            )}
          </div>
        )}
      </section>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={message ? "text-sm" : "sr-only"}
      >
        {message}
      </p>
      {Object.values(fieldErrors).some((messages) => messages.length > 0) && (
        <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
          {Object.entries(fieldErrors).flatMap(([path, messages]) =>
            messages.map((error, index) => (
              <li key={`${path}-${index}`}>{error}</li>
            )),
          )}
        </ul>
      )}
      <Dialog
        open={breakDay !== null}
        onOpenChange={(open) => {
          if (!open) setBreakDay(null);
        }}
      >
        <DialogContent className="availability-dialog">
          <DialogHeader>
            <DialogTitle>
              {breakRangeIndex === null
                ? "Add a recurring break"
                : "Edit a recurring break"}
            </DialogTitle>
            <DialogDescription>
              Enter a break contained within this weekday&apos;s working hours.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="new-break-start">Break starts</Label>
              <Input
                id="new-break-start"
                value={breakRange.start}
                onChange={(event) =>
                  setBreakRange((value) => ({
                    ...value,
                    start: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-break-end">Break ends</Label>
              <Input
                id="new-break-end"
                value={breakRange.end}
                onChange={(event) =>
                  setBreakRange((value) => ({
                    ...value,
                    end: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBreakDay(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (breakDay !== null)
                  setDraft((week) =>
                    week.map((day, index) =>
                      index === breakDay
                        ? {
                            ...day,
                            breaks:
                              breakRangeIndex === null
                                ? [...day.breaks, breakRange]
                                : day.breaks.map((item, i) =>
                                    i === breakRangeIndex ? breakRange : item,
                                  ),
                          }
                        : day,
                    ),
                  );
                setFieldErrors({});
                setBreakDay(null);
              }}
            >
              {breakRangeIndex === null ? "Add break" : "Save break"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
