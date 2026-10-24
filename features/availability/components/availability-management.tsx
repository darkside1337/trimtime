"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateAvailabilityManagement } from "./date-availability-management";
import {
  reloadOwnSchedulesAction,
  previewOwnSlotsAction,
  saveBarberScheduleAction,
  saveShopScheduleAction,
} from "../actions";
import type { AvailabilityData, AvailabilityOverview } from "../queries";
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
const weekMinutes = (week: WeeklySchedule) =>
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

function draftDayMinutes(day: DraftDay) {
  const rangeMinutes = (ranges: DraftRange[]) =>
    ranges.reduce(
      (total, range) =>
        total +
        ((minute(range.end, true) ?? 0) - (minute(range.start, false) ?? 0)),
      0,
    );
  return Math.max(0, rangeMinutes(day.working) - rangeMinutes(day.breaks));
}

function formatHours(minutes: number) {
  return minutes % 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes / 60}h`;
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
  onAddBreak: (day: number, opener: HTMLButtonElement) => void;
  onEditBreak: (day: number, range: number, opener: HTMLButtonElement) => void;
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
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 lg:grid-cols-[100px_minmax(0,1fr)]"
        >
          <div>
            <h3 id={`day-${dayIndex}`} className="font-semibold">
              {days[dayIndex]}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {day.working.length
                ? `Open · ${formatHours(draftDayMinutes(day))}`
                : "Scheduled off"}
            </p>
            {(dayIndex === 4 || dayIndex === 5) && (
              <Badge variant="secondary" className="mt-1 px-1.5 text-[10px]">
                {dayIndex === 4 ? "5 sample bookings" : "1 sample booking"}
              </Badge>
            )}
          </div>
          <div className="contents lg:grid lg:min-w-0 lg:gap-3 lg:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
            <Label className="flex min-h-11 items-center gap-2 lg:col-span-1">
              <Switch
                checked={day.working.length > 0}
                disabled={disabled}
                onCheckedChange={(open) =>
                  onChange(
                    week.map((item, index) =>
                      index !== dayIndex
                        ? item
                        : open
                          ? {
                              working: [{ start: "09:00", end: "17:00" }],
                              breaks: [],
                            }
                          : { working: [], breaks: [] },
                    ),
                  )
                }
              />
              {day.working.length ? "Open" : "Closed"}
            </Label>
            <div className="col-span-2 grid min-w-0 gap-2 lg:col-span-1">
              {day.working.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add hours after opening this day.
                </p>
              ) : (
                day.working.map((range, rangeIndex) => (
                  <div
                    key={`work-${rangeIndex}`}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
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
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">Remove hours</span>
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="col-span-2 grid min-w-0 gap-2 lg:col-span-1">
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
                          fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.end`
                          ]
                            ? `break-${dayIndex}-${rangeIndex}-error`
                            : undefined
                        }
                        aria-label={`Edit ${days[dayIndex]} break ${range.start} to ${range.end}`}
                        onClick={(event) =>
                          onEditBreak(dayIndex, rangeIndex, event.currentTarget)
                        }
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
                  onClick={(event) => onAddBreak(dayIndex, event.currentTarget)}
                >
                  Add break
                </Button>
              </div>
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
  initialOverview,
}: {
  initial: AvailabilityData;
  initialOverview: AvailabilityOverview;
}) {
  const [data, setData] = useState(initial);
  const [overviewDraft, setOverviewDraft] = useState<{
    source: AvailabilityOverview;
    value: AvailabilityOverview;
  } | null>(null);
  const overview =
    overviewDraft?.source === initialOverview
      ? overviewDraft.value
      : initialOverview;
  const [target, setTarget] = useState<Target>({ kind: "shop" });
  const [section, setSection] = useState("shop");
  const [discardTarget, setDiscardTarget] = useState<Target | null>(null);
  const [discardSection, setDiscardSection] = useState<string | null>(null);
  const [pendingAddDialog, setPendingAddDialog] = useState(false);
  const [exceptionFilter, setExceptionFilter] = useState<
    "all" | "dates" | "blocks"
  >("all");
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
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const previewVersion = useRef(0);
  const selectionVersion = useRef(0);
  function updateOverview(
    update: (current: AvailabilityOverview) => AvailabilityOverview,
  ) {
    setOverviewDraft((previous) => ({
      source: initialOverview,
      value: update(
        previous?.source === initialOverview ? previous.value : initialOverview,
      ),
    }));
  }
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
  const shopCapacity = data.shop.week.map(
    (day) =>
      day.working.reduce((sum, range) => sum + range.end - range.start, 0) -
      day.breaks.reduce((sum, range) => sum + range.end - range.start, 0),
  );
  const maximumCapacity = Math.max(...shopCapacity, 1);

  function applyTarget(next: Target) {
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

  function switchTo(next: Target, nextSection: string) {
    if (pending) return;
    const sameTarget =
      next.kind === target.kind &&
      (next.kind === "shop" ||
        (target.kind === "barber" && next.barberId === target.barberId));
    if (dirty && !sameTarget) {
      setDiscardTarget(next);
      setDiscardSection(nextSection);
      return;
    }
    if (!sameTarget) applyTarget(next);
    setSection(nextSection);
  }

  function changeSection(next: string) {
    if (next === section) return;
    if (dirty) {
      setDiscardTarget(
        next === "shop"
          ? { kind: "shop" }
          : next === "barber" && activeBarbers[0]
            ? { kind: "barber", barberId: activeBarbers[0].id }
            : target,
      );
      setDiscardSection(next);
      return;
    }
    if (next === "dates") {
      setSection(next);
      return;
    }
    if (next === "shop") switchTo({ kind: "shop" }, next);
    else if (activeBarbers[0])
      switchTo({ kind: "barber", barberId: activeBarbers[0].id }, next);
    else setSection(next);
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
        if (saveTarget.kind === "shop") {
          updateOverview((previous) => ({
            ...previous,
            weeklyOpenMinutes: weekMinutes(result.data.week),
            ...(shopWasUnconfigured
              ? {
                  activeBarberCount: data.barbers.filter(
                    (item) =>
                      !item.archived &&
                      result.data.week.some((day) => day.working.length > 0),
                  ).length,
                }
              : {}),
          }));
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
        } else {
          const barberHadHours = Boolean(
            data.barbers
              .find((item) => item.id === saveTarget.barberId)
              ?.schedule.week.some((day) => day.working.length > 0),
          );
          const barberHasHours = result.data.week.some(
            (day) => day.working.length > 0,
          );
          updateOverview((previous) => ({
            ...previous,
            activeBarberCount:
              previous.activeBarberCount +
              Number(barberHasHours) -
              Number(barberHadHours),
          }));
          setData((previous) => ({
            ...previous,
            barbers: previous.barbers.map((item) =>
              item.id === saveTarget.barberId
                ? { ...item, schedule: result.data }
                : item,
            ),
          }));
        }
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
    <div className="mt-8 grid gap-6 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-foreground [&_button:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-foreground [&_input:focus-visible]:outline-offset-2 [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-foreground [&_select:focus-visible]:outline-offset-2">
      <div
        className="grid gap-3 min-[901px]:grid-cols-3"
        aria-label="Availability overview"
      >
        <section
          className="rounded-xl border border-border bg-muted/40 p-4"
          aria-label="Weekly open hours"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Weekly open hours
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {Math.floor(overview.weeklyOpenMinutes / 60)}h
            {overview.weeklyOpenMinutes % 60
              ? ` ${overview.weeklyOpenMinutes % 60}m`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Saved shop hours after breaks
          </p>
        </section>
        <section
          className="rounded-xl border border-border bg-muted/40 p-4"
          aria-label="Staff coverage"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Staff coverage
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {overview.activeBarberCount}{" "}
            {overview.activeBarberCount === 1 ? "barber" : "barbers"}
          </p>
          <p className="text-xs text-muted-foreground">
            Active barbers with saved working hours
          </p>
        </section>
        <section
          className="rounded-xl border border-border bg-muted/40 p-4"
          aria-label="Active exceptions"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saved future exceptions
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {overview.exceptions.length} planned
          </p>
          <p className="text-xs text-muted-foreground">
            Saved future closures, overrides, and barber blocks
          </p>
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <Tabs
          value={section}
          onValueChange={changeSection}
          className="w-full min-w-0 min-[901px]:w-auto"
        >
          <TabsList className="grid h-auto! w-full grid-cols-3 gap-1">
            <TabsTrigger
              id="availability-tab-shop"
              aria-controls="availability-panel-shop"
              value="shop"
              disabled={pending}
              className="h-auto! min-h-11 whitespace-normal text-center text-xs sm:text-sm"
            >
              Shop hours
            </TabsTrigger>
            <TabsTrigger
              id="availability-tab-barber"
              aria-controls="availability-panel-barber"
              value="barber"
              disabled={pending}
              className="h-auto! min-h-11 whitespace-normal text-center text-xs sm:text-sm"
            >
              Barber schedules
            </TabsTrigger>
            <TabsTrigger
              id="availability-tab-dates"
              aria-controls="availability-panel-dates"
              value="dates"
              disabled={pending}
              className="h-auto! min-h-11 whitespace-normal text-center text-xs sm:text-sm"
            >
              Date overrides &amp; blocks ({overview.exceptions.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (dirty && section !== "dates") {
              setPendingAddDialog(true);
              changeSection("dates");
              return;
            }
            changeSection("dates");
            window.dispatchEvent(new Event("trimtime:availability-add"));
          }}
        >
          Add date override or block
        </Button>
      </div>
      <aside
        className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground"
        role="note"
      >
        <p className="font-semibold">Design preview</p>
        <p className="mt-1">
          Weekly schedules, dated settings, and saved capacity are live. Friday
          and Saturday booking badges are presentation samples only; they are
          not customer bookings and do not affect availability or saves.
        </p>
      </aside>
      <div
        id={
          section === "shop"
            ? "availability-panel-shop"
            : "availability-panel-barber"
        }
        role="tabpanel"
        aria-labelledby={
          section === "shop"
            ? "availability-tab-shop"
            : "availability-tab-barber"
        }
        tabIndex={0}
        hidden={section !== "shop" && section !== "barber"}
      >
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
                {section === "shop"
                  ? "Shop operating hours"
                  : "Barber schedule"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {section === "shop"
                  ? "Active barbers copy these hours once. Later shop changes never replace their saved schedules."
                  : "Saved barber hours remain independent from shop hours; bookable time is their intersection."}
              </p>
            </div>
            <p className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">
              Saved schedules · revision {schedule?.revision ?? 0}
            </p>
          </div>
          {section === "shop" && (
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              disabled={pending}
              onClick={() => {
                const monday = draft[0];
                if (!monday) return;
                setDraft((week) =>
                  week.map((day, index) =>
                    index >= 1 && index <= 4
                      ? {
                          working: monday.working.map((range) => ({
                            ...range,
                          })),
                          breaks: monday.breaks.map((range) => ({ ...range })),
                        }
                      : day,
                  ),
                );
                setFieldErrors({});
                setMessage(
                  "Monday copied into the weekday draft. Save to apply.",
                );
              }}
            >
              Copy Mon to weekdays
            </Button>
          )}
          {section === "barber" && (
            <div className="mt-5 grid gap-3">
              <h3 className="text-sm font-medium">
                Individual barber schedule
              </h3>
              <div
                className="flex flex-wrap gap-2"
                aria-label="Choose a barber"
              >
                {activeBarbers.map((item) => {
                  const selected =
                    target.kind === "barber" && target.barberId === item.id;
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      disabled={pending}
                      onClick={() =>
                        switchTo(
                          { kind: "barber", barberId: item.id },
                          "barber",
                        )
                      }
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-7 place-items-center rounded-full bg-background/20 text-xs font-semibold"
                      >
                        {item.name
                          .split(/\s+/)
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                      {item.name}
                    </Button>
                  );
                })}
              </div>
              {!data.shop.revision && (
                <p className="text-sm text-muted-foreground">
                  Save shop hours first to initialize barber schedules.
                </p>
              )}
            </div>
          )}
          {section === "barber" && target.kind === "barber" && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                This barber&apos;s saved hours are independent from shop hours.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setDraft(toDraft(data.shop.week));
                  setFieldErrors({});
                  previewVersion.current++;
                  setSlots(null);
                  setMessage(
                    "Shop hours copied into this barber draft. Save to apply.",
                  );
                }}
              >
                Copy shop hours once
              </Button>
            </div>
          )}
          <div
            id="weekly-schedule-panel"
            role="region"
            aria-label={
              section === "shop"
                ? "Shop weekly schedule"
                : "Barber weekly schedule"
            }
            tabIndex={0}
          >
            {section === "barber" && activeBarbers.length === 0 ? (
              <p className="mt-6 rounded-xl bg-muted p-5 text-sm">
                Add an active barber before setting barber hours.
              </p>
            ) : target.kind === "barber" && !data.shop.revision ? (
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
                onAddBreak={(index, opener) => {
                  breakOpener.current = opener;
                  setBreakDay(index);
                  setBreakRangeIndex(null);
                  setBreakRange({ start: "12:00", end: "13:00" });
                }}
                onEditBreak={(dayIndex, rangeIndex, opener) => {
                  breakOpener.current = opener;
                  setBreakDay(dayIndex);
                  setBreakRangeIndex(rangeIndex);
                  setBreakRange(draft[dayIndex]!.breaks[rangeIndex]!);
                }}
              />
            )}
          </div>
          {section === "shop" && (
            <section className="mt-7" aria-labelledby="weekly-capacity-title">
              <h3 id="weekly-capacity-title" className="font-semibold">
                Weekly shop operating capacity
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Saved open minutes across the seven-day week, after breaks.
              </p>
              <div className="mt-4 grid grid-cols-7 gap-1 rounded-xl border border-border bg-muted/40 p-2 sm:gap-3 sm:p-4">
                {data.shop.week.map((day, index) => {
                  const minutes = shopCapacity[index] ?? 0;
                  const barHeight = Math.round(
                    (minutes / maximumCapacity) * 64,
                  );
                  return (
                    <div key={days[index]} className="grid gap-1 text-center">
                      <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">
                        <span className="sm:hidden">
                          {days[index]?.slice(0, 1)}
                        </span>
                        <span className="hidden sm:inline">
                          {days[index]?.slice(0, 3)}
                        </span>
                      </span>
                      <svg
                        viewBox="0 0 24 72"
                        preserveAspectRatio="none"
                        className="h-16 w-full text-foreground"
                        role="img"
                        aria-label={`${days[index]} ${minutes} open minutes after breaks`}
                      >
                        <rect
                          x="4"
                          y="4"
                          width="16"
                          height="64"
                          rx="4"
                          className="fill-muted"
                        />
                        <rect
                          x="4"
                          y={68 - barHeight}
                          width="16"
                          height={barHeight}
                          rx="4"
                          className="fill-foreground"
                        />
                      </svg>
                      <span className="text-xs tabular-nums">
                        {minutes
                          ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}h`
                          : "Off"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <div
            hidden={section === "barber" && activeBarbers.length === 0}
            className="mt-5 flex flex-wrap items-center justify-end gap-3"
          >
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
      </div>
      <div
        id="availability-panel-dates"
        role="tabpanel"
        aria-labelledby="availability-tab-dates"
        tabIndex={0}
        hidden={section !== "dates"}
      >
        <DateAvailabilityManagement initial={data} />
        <section
          className="mt-5 rounded-2xl border border-border p-5 sm:p-7"
          aria-labelledby="upcoming-exceptions-title"
        >
          <h2
            id="upcoming-exceptions-title"
            className="font-heading text-xl font-bold"
          >
            Upcoming saved exceptions
          </h2>
          <div
            className="mt-4 flex flex-wrap gap-2"
            aria-label="Filter exceptions"
          >
            {(
              [
                ["all", "All", overview.exceptions.length],
                [
                  "dates",
                  "Date changes",
                  overview.exceptions.filter((item) => item.kind !== "block")
                    .length,
                ],
                [
                  "blocks",
                  "Time blocks",
                  overview.exceptions.filter((item) => item.kind === "block")
                    .length,
                ],
              ] as const
            ).map(([value, label, count]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={exceptionFilter === value ? "default" : "outline"}
                aria-pressed={exceptionFilter === value}
                onClick={() => setExceptionFilter(value)}
              >
                {label} · {count}
              </Button>
            ))}
          </div>
          {overview.exceptions.filter(
            (item) =>
              exceptionFilter === "all" ||
              (exceptionFilter === "blocks" && item.kind === "block") ||
              (exceptionFilter === "dates" && item.kind !== "block"),
          ).length ? (
            <ul className="mt-4 grid gap-4 min-[1200px]:grid-cols-3">
              {overview.exceptions
                .filter(
                  (item) =>
                    exceptionFilter === "all" ||
                    (exceptionFilter === "blocks" && item.kind === "block") ||
                    (exceptionFilter === "dates" && item.kind !== "block"),
                )
                .map((exception) => (
                  <li
                    key={exception.id}
                    className="flex min-w-0 flex-col items-start gap-4 rounded-xl border border-border bg-muted/30 p-4"
                  >
                    <div className="grid gap-2">
                      <Badge variant="outline" className="w-fit">
                        {exception.kind === "block"
                          ? "Barber time block"
                          : exception.kind === "shop-date"
                            ? "Shop date"
                            : "Barber date"}
                      </Badge>
                      <p className="font-semibold">
                        {exception.title}
                        {exception.archived ? " · archived" : ""}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {exception.date}
                      </p>
                      <p className="break-words text-sm text-muted-foreground">
                        {exception.detail}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("trimtime:availability-edit", {
                            detail: {
                              date: exception.date,
                              target: exception.target,
                              view:
                                exception.kind === "block" ? "block" : "date",
                            },
                          }),
                        );
                      }}
                    >
                      {exception.kind === "block" ? "View block" : "Edit date"}
                    </Button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {overview.exceptions.length
                ? "No saved exceptions match this filter."
                : "No future date exceptions or barber blocks are saved."}
            </p>
          )}
        </section>
      </div>

      <section
        hidden={section !== "shop"}
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
        <DialogContent
          initialFocus={breakStartInput}
          finalFocus={breakOpener}
          className="[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-foreground [&_button:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-foreground [&_input:focus-visible]:outline-offset-2"
        >
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
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="sample-break-label">Break label · sample</Label>
            <Input
              id="sample-break-label"
              value={target.kind === "shop" ? "Shop lunch" : "Personal break"}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
            <p className="text-xs text-muted-foreground">
              Design preview; labels aren&apos;t saved.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="new-break-start">Break starts</Label>
              <Input
                id="new-break-start"
                value={breakRange.start}
                ref={breakStartInput}
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
      <OwnerDiscardDialog
        open={discardTarget !== null}
        onKeepEditing={() => {
          setDiscardTarget(null);
          setDiscardSection(null);
          setPendingAddDialog(false);
        }}
        onDiscard={() => {
          if (discardTarget) applyTarget(discardTarget);
          if (discardSection) {
            setSection(discardSection);
            if (discardSection === "dates" && pendingAddDialog)
              window.dispatchEvent(new Event("trimtime:availability-add"));
            setPendingAddDialog(false);
          }
          setDiscardTarget(null);
          setDiscardSection(null);
        }}
      />
    </div>
  );
}
