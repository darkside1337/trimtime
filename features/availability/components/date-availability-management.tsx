"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AvailabilityData } from "../queries";
import { dayScheduleSchema } from "../schemas";
import {
  createTimeBlockAction,
  getBlockBoundaryChoicesAction,
  getOwnDateAvailabilityAction,
  removeTimeBlockAction,
  saveBarberDateScheduleAction,
  saveShopDateScheduleAction,
} from "../actions";
import type { DateAvailabilityView } from "../types";

type Boundary = { instant: string; offset: string };
type RangeDraft = { start: string; end: string };
type Target = "shop" | string;
const formatMinute = (minute: number, end = false) =>
  end && minute === 1440
    ? "24:00"
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const rangeDrafts = (ranges: { start: number; end: number }[] = []) =>
  ranges.map(({ start, end }) => ({
    start: formatMinute(start),
    end: formatMinute(end, true),
  }));
const displayInstant = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(instant));
const parseMinute = (value: string, end = false) => {
  if (end && value === "24:00") return 1440;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export function DateAvailabilityManagement({
  initial,
}: {
  initial: AvailabilityData;
}) {
  const [date, setDate] = useState("");
  const [target, setTarget] = useState<Target>("shop");
  const [data, setData] = useState<DateAvailabilityView | null>(null);
  const [working, setWorking] = useState<RangeDraft[]>([]);
  const [breaks, setBreaks] = useState<RangeDraft[]>([]);
  const [closed, setClosed] = useState(false);
  const [override, setOverride] = useState(true);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [startChoices, setStartChoices] = useState<Boundary[]>([]);
  const [endChoices, setEndChoices] = useState<Boundary[]>([]);
  const [startInstant, setStartInstant] = useState("");
  const [endInstant, setEndInstant] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const version = useRef(0);
  const startBoundaryVersion = useRef(0);
  const endBoundaryVersion = useRef(0);
  const activeBarbers = initial.barbers.filter((barber) => !barber.archived);
  const selectedBarber = activeBarbers.find((barber) => barber.id === target);

  function clearBlockBoundaries() {
    startBoundaryVersion.current++;
    endBoundaryVersion.current++;
    setBlockStart("");
    setBlockEnd("");
    setStartChoices([]);
    setEndChoices([]);
    setStartInstant("");
    setEndInstant("");
  }

  async function load(dateValue: string, targetValue: Target) {
    if (!dateValue) return;
    const requestVersion = ++version.current;
    setBusy(true);
    let result: Awaited<ReturnType<typeof getOwnDateAvailabilityAction>>;
    try {
      result = await getOwnDateAvailabilityAction({ date: dateValue });
    } catch {
      if (requestVersion === version.current) {
        setBusy(false);
        setMessage("Unable to load dated availability. Try again.");
      }
      return;
    }
    if (requestVersion !== version.current) return;
    setBusy(false);
    if (!result.success) {
      setMessage(result.error.message);
      return;
    }
    const state =
      targetValue === "shop"
        ? result.data.shop
        : result.data.barbers.find((barber) => barber.id === targetValue)
            ?.schedule;
    setData(result.data);
    setClosed(state?.closed ?? false);
    setOverride(state?.override !== null && state?.override !== undefined);
    const day = state?.override;
    setWorking(rangeDrafts(day?.working));
    setBreaks(rangeDrafts(day?.breaks));
    setDirty(false);
    setFieldErrors({});
    setMessage("");
  }
  const reload = () => load(date, target);

  async function resolveBoundary(value: string, end: boolean) {
    const requestVersion = end
      ? ++endBoundaryVersion.current
      : ++startBoundaryVersion.current;
    const currentVersion = () =>
      end ? endBoundaryVersion.current : startBoundaryVersion.current;
    if (end) {
      setEndChoices([]);
      setEndInstant("");
    } else {
      setStartChoices([]);
      setStartInstant("");
    }
    const minute = parseMinute(value, end);
    if (!date || minute === null) {
      setMessage("Enter a valid local time first.");
      return;
    }
    let result: Awaited<ReturnType<typeof getBlockBoundaryChoicesAction>>;
    try {
      result = await getBlockBoundaryChoicesAction({ date, minute });
    } catch {
      if (requestVersion === currentVersion())
        setMessage("Unable to resolve that time. Try again.");
      return;
    }
    if (requestVersion !== currentVersion()) return;
    if (!result.success) {
      setMessage(result.error.message);
      return;
    }
    const choices = result.data;
    if (!choices.length) {
      setMessage("That local time does not exist in the shop time zone.");
      return;
    }
    if (end) {
      setEndChoices(choices);
      setEndInstant(choices.length === 1 ? choices[0]!.instant : "");
    } else {
      setStartChoices(choices);
      setStartInstant(choices.length === 1 ? choices[0]!.instant : "");
    }
    setMessage(
      choices.length > 1
        ? "Choose the correct UTC offset for this repeated local time."
        : "",
    );
  }

  async function saveSchedule() {
    if (!date || !data) return;
    if (
      override &&
      [...working, ...breaks].some(
        ({ start: from, end: to }) =>
          parseMinute(from) === null || parseMinute(to, true) === null,
      )
    ) {
      setMessage("Check the hours and break ranges.");
      return;
    }
    const parsedDay = dayScheduleSchema.safeParse({
      working: working.map(({ start: from, end: to }) => ({
        start: parseMinute(from)!,
        end: parseMinute(to, true)!,
      })),
      breaks: breaks.map(({ start: from, end: to }) => ({
        start: parseMinute(from)!,
        end: parseMinute(to, true)!,
      })),
    });
    if (override && !parsedDay.success) {
      const errors = Object.fromEntries(
        parsedDay.error.issues.map((issue) => {
          const group = issue.path[0] === "breaks" ? "break" : "hours";
          const index = typeof issue.path[1] === "number" ? issue.path[1] : 0;
          const endpoint = issue.path[2] === "end" ? "end" : "start";
          return [`dated-${group}-${endpoint}-${index}`, issue.message];
        }),
      );
      setFieldErrors(errors);
      setMessage("Check the hours and break ranges.");
      document.getElementById(Object.keys(errors)[0] ?? "")?.focus();
      return;
    }
    setFieldErrors({});
    const state =
      target === "shop"
        ? data.shop
        : data.barbers.find((barber) => barber.id === target)?.schedule;
    if (!state) return;
    setBusy(true);
    const input = {
      date,
      timeZone: data.timeZone,
      override: override
        ? parsedDay.success
          ? parsedDay.data
          : { working: [], breaks: [] }
        : null,
      closed,
      revision: state.revision,
    };
    let result: Awaited<ReturnType<typeof saveShopDateScheduleAction>>;
    try {
      result =
        target === "shop"
          ? await saveShopDateScheduleAction(input)
          : await saveBarberDateScheduleAction({ ...input, barberId: target });
    } catch {
      setBusy(false);
      setMessage(
        "Save status is uncertain. Reload saved state before retrying.",
      );
      return;
    }
    setBusy(false);
    if (!result.success) {
      setMessage(result.error.message);
      return;
    }
    setDirty(false);
    window.dispatchEvent(new Event("trimtime:availability-changed"));
    await reload();
    setMessage("Saved. Preview again to see the updated availability.");
  }

  async function addBlock() {
    if (!data || !date || !startInstant || !endInstant) {
      setMessage(
        "Resolve both block times and choose any repeated-time offsets.",
      );
      return;
    }
    const barberId = selectedBarber?.id ?? activeBarbers[0]?.id;
    if (!barberId) {
      setMessage("Add an active barber before creating a block.");
      return;
    }
    setBusy(true);
    let result: Awaited<ReturnType<typeof createTimeBlockAction>>;
    try {
      result = await createTimeBlockAction({
        barberId,
        date,
        timeZone: data.timeZone,
        start: startInstant,
        end: endInstant,
        note,
      });
    } catch {
      setBusy(false);
      setMessage(
        "Save status is uncertain. Reload saved state before retrying.",
      );
      return;
    }
    setBusy(false);
    if (!result.success) {
      setMessage(result.error.message);
      return;
    }
    setBlockStart("");
    setBlockEnd("");
    setStartChoices([]);
    setEndChoices([]);
    setStartInstant("");
    setEndInstant("");
    setNote("");
    setDirty(false);
    window.dispatchEvent(new Event("trimtime:availability-changed"));
    await reload();
    setMessage("Block saved. Preview again to see the updated availability.");
  }

  return (
    <section
      className="mt-10 rounded-2xl border border-border bg-card p-5 sm:p-7"
      aria-labelledby="dated-availability-title"
    >
      <h2
        id="dated-availability-title"
        className="font-heading text-2xl font-bold"
      >
        Overrides &amp; blocks
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Set a one-date replacement, close the shop or mark a barber off, and
        block individual barber time in {initial.timeZone}.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="exception-date">Schedule day</Label>
          <Input
            id="exception-date"
            type="date"
            value={date}
            disabled={busy || dirty}
            onInput={(event) => {
              setDate(event.currentTarget.value);
              setData(null);
              setFieldErrors({});
              clearBlockBoundaries();
            }}
            onChange={(event) => {
              setDate(event.target.value);
              setData(null);
              setFieldErrors({});
              clearBlockBoundaries();
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="exception-target">Apply to</Label>
          <select
            id="exception-target"
            className="h-10 rounded-md border border-input bg-background px-3"
            value={target}
            disabled={busy || dirty}
            onChange={(event) => {
              setTarget(event.target.value);
              setData(null);
              setFieldErrors({});
              clearBlockBoundaries();
            }}
          >
            <option value="shop">Shop</option>
            {activeBarbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        disabled={busy || !date}
        onClick={() => void load(date, target)}
      >
        {busy ? "Loading date…" : "Load date"}
      </Button>
      {date && data?.date === date && (
        <>
          <div className="mt-6 grid gap-3 border-t border-border pt-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={override}
                disabled={busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  if (enabled && !override && !working.length && date) {
                    const day =
                      (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
                    const recurring =
                      target === "shop"
                        ? initial.shop.week[day]
                        : initial.barbers.find((barber) => barber.id === target)
                            ?.schedule.week[day];
                    setWorking(rangeDrafts(recurring?.working));
                    setBreaks(rangeDrafts(recurring?.breaks));
                  }
                  setOverride(enabled);
                  setDirty(true);
                }}
              />
              Replace recurring hours and breaks
            </label>
            {override && (
              <div className="grid gap-4">
                {(
                  [
                    [working, setWorking, "hours"],
                    [breaks, setBreaks, "break"],
                  ] as const
                ).map(([ranges, setRanges, group]) => (
                  <div key={group} className="grid gap-3 sm:grid-cols-2">
                    {ranges.map((range, index) => {
                      const startId = `dated-${group}-start-${index}`;
                      const endId = `dated-${group}-end-${index}`;
                      const update = (
                        field: "start" | "end",
                        value: string,
                      ) => {
                        setRanges((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, [field]: value }
                              : item,
                          ),
                        );
                        setDirty(true);
                        setFieldErrors({});
                      };
                      return (
                        <div
                          key={index}
                          className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                        >
                          <div className="grid gap-2">
                            <Label htmlFor={startId}>
                              {group === "hours"
                                ? `Hours start${index ? ` ${index + 1}` : ""}`
                                : `Break start${index ? ` ${index + 1}` : ""}`}
                            </Label>
                            <Input
                              id={startId}
                              value={range.start}
                              placeholder="09:00"
                              disabled={busy}
                              aria-invalid={Boolean(fieldErrors[startId])}
                              aria-describedby={
                                fieldErrors[startId]
                                  ? `${startId}-error`
                                  : undefined
                              }
                              onChange={(event) =>
                                update("start", event.target.value)
                              }
                            />
                            {fieldErrors[startId] && (
                              <p
                                id={`${startId}-error`}
                                className="text-sm text-destructive"
                              >
                                {fieldErrors[startId]}
                              </p>
                            )}
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor={endId}>
                              {group === "hours"
                                ? `Hours end${index ? ` ${index + 1}` : ""} (24:00 allowed)`
                                : `Break end${index ? ` ${index + 1}` : ""} (24:00 allowed)`}
                            </Label>
                            <Input
                              id={endId}
                              value={range.end}
                              placeholder="17:00"
                              disabled={busy}
                              aria-invalid={Boolean(fieldErrors[endId])}
                              aria-describedby={
                                fieldErrors[endId]
                                  ? `${endId}-error`
                                  : undefined
                              }
                              onChange={(event) =>
                                update("end", event.target.value)
                              }
                            />
                            {fieldErrors[endId] && (
                              <p
                                id={`${endId}-error`}
                                className="text-sm text-destructive"
                              >
                                {fieldErrors[endId]}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Remove ${group} range ${index + 1}`}
                            onClick={() => {
                              setRanges((current) =>
                                current.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              );
                              setDirty(true);
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit"
                      disabled={busy}
                      onClick={() => {
                        setRanges((current) => [
                          ...current,
                          { start: "", end: "" },
                        ]);
                        setDirty(true);
                      }}
                    >
                      Add {group === "hours" ? "hours" : "break"} range
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={closed}
                disabled={busy}
                onChange={(event) => {
                  setClosed(event.target.checked);
                  setDirty(true);
                }}
              />
              {target === "shop"
                ? "Close the shop for this date"
                : "Mark this barber off for this date"}
            </label>
            <p className="text-sm text-muted-foreground">
              Saving replacement hours does not remove a closure, day off, or
              time block. Remove each restriction explicitly.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || !dirty}
                onClick={() => void saveSchedule()}
              >
                Save date settings
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !date}
                onClick={() => {
                  setDirty(false);
                  void reload();
                }}
              >
                Reload saved state
              </Button>
            </div>
          </div>
          <div className="mt-6 grid gap-3 border-t border-border pt-5">
            <h3 className="font-semibold">Add a barber time block</h3>
            <p className="text-sm text-muted-foreground">
              Blocks are individual-barber restrictions. They can be set outside
              working hours and remain at the same UTC instants if the shop time
              zone changes.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="block-start">Start (shop local time)</Label>
                <Input
                  id="block-start"
                  value={blockStart}
                  placeholder="10:00"
                  disabled={busy}
                  onChange={(event) => {
                    startBoundaryVersion.current++;
                    setBlockStart(event.target.value);
                    setStartChoices([]);
                    setStartInstant("");
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={() => void resolveBoundary(blockStart, false)}
                >
                  Resolve start
                </Button>
                {startChoices.length > 1 && (
                  <select
                    aria-label="Start UTC offset"
                    className="h-10 rounded-md border border-input bg-background px-3"
                    value={startInstant}
                    onChange={(event) => setStartInstant(event.target.value)}
                  >
                    <option value="">Choose UTC offset</option>
                    {startChoices.map((choice) => (
                      <option key={choice.instant} value={choice.instant}>
                        {choice.offset}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="block-end">
                  End (shop local time, 24:00 allowed)
                </Label>
                <Input
                  id="block-end"
                  value={blockEnd}
                  placeholder="10:15"
                  disabled={busy}
                  onChange={(event) => {
                    endBoundaryVersion.current++;
                    setBlockEnd(event.target.value);
                    setEndChoices([]);
                    setEndInstant("");
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={() => void resolveBoundary(blockEnd, true)}
                >
                  Resolve end
                </Button>
                {endChoices.length > 1 && (
                  <select
                    aria-label="End UTC offset"
                    className="h-10 rounded-md border border-input bg-background px-3"
                    value={endInstant}
                    onChange={(event) => setEndInstant(event.target.value)}
                  >
                    <option value="">Choose UTC offset</option>
                    {endChoices.map((choice) => (
                      <option key={choice.instant} value={choice.instant}>
                        {choice.offset}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="block-note">Note (optional)</Label>
              <Input
                id="block-note"
                value={note}
                disabled={busy}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </div>
            <Button
              type="button"
              className="w-fit"
              disabled={busy || dirty}
              onClick={() => void addBlock()}
            >
              Save time block
            </Button>
            {data?.blocks.map((block) => (
              <div
                key={block.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
              >
                <span>
                  {block.barberId === selectedBarber?.id
                    ? selectedBarber.name
                    : (activeBarbers.find(
                        (barber) => barber.id === block.barberId,
                      )?.name ?? "Barber")}
                  : {displayInstant(block.start, data.timeZone)} –{" "}
                  {displayInstant(block.end, data.timeZone)}
                  {block.note ? ` · ${block.note}` : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    let result: Awaited<
                      ReturnType<typeof removeTimeBlockAction>
                    >;
                    try {
                      result = await removeTimeBlockAction({ id: block.id });
                    } catch {
                      setBusy(false);
                      setMessage(
                        "Removal status is uncertain. Reload saved state before retrying.",
                      );
                      return;
                    }
                    setBusy(false);
                    setMessage(
                      result.success
                        ? "Block removed. Preview again to see the updated availability."
                        : result.error.message,
                    );
                    if (result.success) await reload();
                    if (result.success)
                      window.dispatchEvent(
                        new Event("trimtime:availability-changed"),
                      );
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
      <p aria-live="polite" className={message ? "mt-4 text-sm" : "sr-only"}>
        {message}
      </p>
    </section>
  );
}
