"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
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
type ExceptionView = "date" | "block";
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
  const router = useRouter();
  const [date, setDate] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState("");
  const [dialogTarget, setDialogTarget] = useState<Target>("shop");
  const [exceptionView, setExceptionView] = useState<ExceptionView>("date");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingLoad, setPendingLoad] = useState<{
    date: string;
    target: Target;
    view?: ExceptionView;
  } | null>(null);
  const [removeBlockId, setRemoveBlockId] = useState<string | null>(null);
  const [removeMessage, setRemoveMessage] = useState("");
  const [target, setTarget] = useState<Target>("shop");
  const [blockBarberId, setBlockBarberId] = useState("");
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
  const activeBarbers = useMemo(
    () => initial.barbers.filter((barber) => !barber.archived),
    [initial.barbers],
  );
  const selectedArchivedBarber = initial.barbers.find(
    (barber) => barber.id === dialogTarget && barber.archived,
  );
  const selectedBarber = activeBarbers.find((barber) => barber.id === target);
  const targetArchived = initial.barbers.some(
    (barber) => barber.id === target && barber.archived,
  );
  const hasBlockDraft = Boolean(
    blockStart || blockEnd || startInstant || endInstant || note,
  );

  useEffect(() => {
    const openAdd = () => {
      setDialogDate(date);
      setDialogTarget(target);
      setAddDialogOpen(true);
    };
    window.addEventListener("trimtime:availability-add", openAdd);
    return () =>
      window.removeEventListener("trimtime:availability-add", openAdd);
  }, [date, target]);

  useEffect(() => {
    const editException = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          date?: string;
          target?: string;
          view?: ExceptionView;
        }>
      ).detail;
      if (!detail?.date || !detail.target) return;
      const next = {
        date: detail.date,
        target: detail.target as Target,
        view: detail.view ?? "date",
      };
      if (dirty || hasBlockDraft) {
        setPendingLoad(next);
        setDiscardDialogOpen(true);
        return;
      }
      setExceptionView(next.view);
      setDialogDate(next.date);
      setDialogTarget(next.target);
      setAddDialogOpen(true);
      setDate(next.date);
      setTarget(next.target);
      setBlockBarberId(
        activeBarbers.some((barber) => barber.id === next.target)
          ? next.target
          : "",
      );
      void load(next.date, next.target);
    };
    window.addEventListener("trimtime:availability-edit", editException);
    return () =>
      window.removeEventListener("trimtime:availability-edit", editException);
  }, [activeBarbers, initial.barbers, dirty, hasBlockDraft]);

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
    if (!dateValue) return false;
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
      return false;
    }
    if (requestVersion !== version.current) return false;
    setBusy(false);
    if (!result.success) {
      setMessage(result.error.message);
      return false;
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
    return true;
  }
  const reload = () => load(date, target);

  function requestAddDialogClose() {
    if (busy) return;
    if (dirty || hasBlockDraft) {
      setDiscardDialogOpen(true);
      return;
    }
    setAddDialogOpen(false);
  }

  function requestDialogSelection(next: { date: string; target: Target }) {
    if (dirty || hasBlockDraft) {
      setPendingLoad({ ...next, view: exceptionView });
      setDiscardDialogOpen(true);
      return;
    }
    setDialogDate(next.date);
    setDialogTarget(next.target);
    setBlockBarberId(
      activeBarbers.some((barber) => barber.id === next.target)
        ? next.target
        : "",
    );
    setData(null);
    setFieldErrors({});
    clearBlockBoundaries();
  }

  async function continueFromAddDialog() {
    if (!dialogDate) {
      setMessage("Choose a date to review or add an exception.");
      return;
    }
    if (dirty || hasBlockDraft) {
      setPendingLoad({
        date: dialogDate,
        target: dialogTarget,
        view: exceptionView,
      });
      setDiscardDialogOpen(true);
      return;
    }
    if (await load(dialogDate, dialogTarget)) {
      setDate(dialogDate);
      setTarget(dialogTarget);
      setBlockBarberId(
        activeBarbers.some((barber) => barber.id === dialogTarget)
          ? dialogTarget
          : "",
      );
      setAddDialogOpen(true);
    }
  }

  async function removeBlock(id: string) {
    setBusy(true);
    let result: Awaited<ReturnType<typeof removeTimeBlockAction>>;
    try {
      result = await removeTimeBlockAction({ id });
    } catch {
      setBusy(false);
      const error =
        "Removal status is uncertain. Reload saved state before retrying.";
      setRemoveMessage(error);
      setMessage(error);
      return;
    }
    setBusy(false);
    if (!result.success) {
      setRemoveMessage(result.error.message);
      setMessage(result.error.message);
      return;
    }
    setRemoveBlockId(null);
    setRemoveMessage("");
    setMessage("Block removed. Preview again to see the updated availability.");
    if (result.success) {
      window.dispatchEvent(new Event("trimtime:availability-changed"));
      router.refresh();
      await reload();
    }
  }

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
    router.refresh();
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
    const barberId = selectedBarber?.id ?? blockBarberId;
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
    router.refresh();
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
        Review, add, and remove saved one-date changes and individual barber
        blocks in {initial.timeZone}.
      </p>
      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (!open) requestAddDialogClose();
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-foreground [&_button:focus-visible]:outline-offset-2 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2">
          <DialogHeader>
            <DialogTitle>
              {data?.date === date && date
                ? `Date availability · ${date}`
                : "Add a date override or block"}
            </DialogTitle>
            <DialogDescription>
              Choose a shop-local date and schedule to review saved exceptions
              or add a dated change. Closures, replacements, and blocks remain
              independent restrictions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="add-exception-date">Schedule day</Label>
              <Input
                id="add-exception-date"
                type="date"
                value={dialogDate}
                disabled={busy || dirty}
                onChange={(event) => {
                  requestDialogSelection({
                    date: event.target.value,
                    target: dialogTarget,
                  });
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-exception-target">Apply to</Label>
              <select
                id="add-exception-target"
                className="h-10 rounded-md border border-input bg-background px-3"
                value={dialogTarget}
                disabled={busy || dirty}
                onChange={(event) => {
                  requestDialogSelection({
                    date: dialogDate,
                    target: event.target.value,
                  });
                }}
              >
                <option value="shop">Shop</option>
                {selectedArchivedBarber && (
                  <option value={selectedArchivedBarber.id}>
                    {selectedArchivedBarber.name} · archived
                  </option>
                )}
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
            disabled={busy || !dialogDate || dirty}
            onClick={() => void continueFromAddDialog()}
          >
            {busy
              ? "Loading date…"
              : data?.date === date
                ? "Reload date"
                : "Load date"}
          </Button>
          {date && data?.date === date && (
            <>
              <div className="mt-5 grid max-w-sm gap-2">
                <Label htmlFor="exception-view">Exception type</Label>
                <select
                  id="exception-view"
                  className="h-10 rounded-md border border-input bg-background px-3"
                  value={exceptionView}
                  disabled={busy}
                  onChange={(event) =>
                    setExceptionView(event.target.value as ExceptionView)
                  }
                >
                  <option value="date">Date settings</option>
                  <option value="block">Barber time block</option>
                </select>
              </div>
              {exceptionView === "date" && (
                <>
                  {targetArchived ? (
                    <p className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                      This barber is archived. Their dated schedule is
                      read-only; retained time blocks below can still be
                      removed.
                    </p>
                  ) : (
                    <div className="mt-6 grid gap-3 border-t border-border pt-5">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={override}
                          disabled={busy}
                          onCheckedChange={(checked) => {
                            const enabled = checked === true;
                            if (
                              enabled &&
                              !override &&
                              !working.length &&
                              date
                            ) {
                              const day =
                                (new Date(`${date}T00:00:00Z`).getUTCDay() +
                                  6) %
                                7;
                              const recurring =
                                target === "shop"
                                  ? initial.shop.week[day]
                                  : initial.barbers.find(
                                      (barber) => barber.id === target,
                                    )?.schedule.week[day];
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
                            <div
                              key={group}
                              className="grid gap-3 sm:grid-cols-2"
                            >
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
                                        aria-invalid={Boolean(
                                          fieldErrors[startId],
                                        )}
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
                                        aria-invalid={Boolean(
                                          fieldErrors[endId],
                                        )}
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
                                            (_, itemIndex) =>
                                              itemIndex !== index,
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
                                Add {group === "hours" ? "hours" : "break"}{" "}
                                range
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={closed}
                          disabled={busy}
                          onCheckedChange={(checked) => {
                            setClosed(checked === true);
                            setDirty(true);
                          }}
                        />
                        {target === "shop"
                          ? "Close the shop for this date"
                          : "Mark this barber off for this date"}
                      </label>
                      <p className="text-sm text-muted-foreground">
                        Saving replacement hours does not remove a closure, day
                        off, or time block. Remove each restriction explicitly.
                      </p>
                      <div className="grid max-w-xl gap-2">
                        <Label htmlFor="dated-reason-sample">
                          Reason / notes · sample
                        </Label>
                        <Input
                          id="dated-reason-sample"
                          value="Holiday opening hours"
                          readOnly
                          aria-readonly="true"
                        />
                        <p className="text-xs text-muted-foreground">
                          Design preview; date reasons are not saved.
                        </p>
                      </div>
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
                  )}
                </>
              )}
              {exceptionView === "block" && (
                <div className="mt-6 grid gap-3 border-t border-border pt-5">
                  <h3 className="font-semibold">Add a barber time block</h3>
                  <p className="text-sm text-muted-foreground">
                    Blocks are individual-barber restrictions. They can be set
                    outside working hours and remain at the same UTC instants if
                    the shop time zone changes.
                  </p>
                  {targetArchived ? (
                    <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                      New blocks require an active barber. Existing blocks for
                      this archived barber remain available to remove below.
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor="block-start">
                            Start (shop local time)
                          </Label>
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
                            onClick={() =>
                              void resolveBoundary(blockStart, false)
                            }
                          >
                            Resolve start
                          </Button>
                          {startChoices.length > 1 && (
                            <select
                              aria-label="Start UTC offset"
                              className="h-10 rounded-md border border-input bg-background px-3"
                              value={startInstant}
                              onChange={(event) =>
                                setStartInstant(event.target.value)
                              }
                            >
                              <option value="">Choose UTC offset</option>
                              {startChoices.map((choice) => (
                                <option
                                  key={choice.instant}
                                  value={choice.instant}
                                >
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
                              onChange={(event) =>
                                setEndInstant(event.target.value)
                              }
                            >
                              <option value="">Choose UTC offset</option>
                              {endChoices.map((choice) => (
                                <option
                                  key={choice.instant}
                                  value={choice.instant}
                                >
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
                      {target === "shop" && (
                        <div className="grid max-w-sm gap-2">
                          <Label htmlFor="block-barber">
                            Barber for this time block
                          </Label>
                          <select
                            id="block-barber"
                            className="h-10 rounded-md border border-input bg-background px-3"
                            value={blockBarberId}
                            disabled={busy}
                            onChange={(event) =>
                              setBlockBarberId(event.target.value)
                            }
                          >
                            <option value="">Choose an active barber</option>
                            {activeBarbers.map((barber) => (
                              <option key={barber.id} value={barber.id}>
                                {barber.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <Button
                        type="button"
                        className="w-fit"
                        disabled={
                          busy || dirty || (target === "shop" && !blockBarberId)
                        }
                        onClick={() => void addBlock()}
                      >
                        Save time block
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    disabled={busy || !date}
                    onClick={() => void continueFromAddDialog()}
                  >
                    Reload saved state
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
                            )?.name ??
                            initial.barbers.find(
                              (barber) => barber.id === block.barberId,
                            )?.name ??
                            "Barber")}
                        {initial.barbers.find(
                          (barber) =>
                            barber.id === block.barberId && barber.archived,
                        ) && " · archived"}
                        : {displayInstant(block.start, data.timeZone)} –{" "}
                        {displayInstant(block.end, data.timeZone)}
                        {block.note ? ` · ${block.note}` : ""}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || dirty}
                        onClick={() => {
                          setRemoveMessage("");
                          setRemoveBlockId(block.id);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <p
            aria-live="polite"
            className={message ? "mt-4 text-sm" : "sr-only"}
          >
            {message}
          </p>
          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={requestAddDialogClose}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removeBlockId !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoveBlockId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this barber time block?</DialogTitle>
            <DialogDescription>
              The saved block will stop restricting this barber&apos;s
              availability. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {removeMessage && (
            <p role="alert" className="text-sm text-destructive">
              {removeMessage}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setRemoveBlockId(null)}
            >
              Keep block
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !removeBlockId}
              onClick={() => {
                if (removeBlockId) void removeBlock(removeBlockId);
              }}
            >
              {busy ? "Removing…" : "Remove block"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OwnerDiscardDialog
        open={discardDialogOpen}
        onKeepEditing={() => {
          setDiscardDialogOpen(false);
          setPendingLoad(null);
          if (!addDialogOpen && !pendingLoad) setAddDialogOpen(true);
        }}
        onDiscard={() => {
          const next = pendingLoad;
          setPendingLoad(null);
          setDirty(false);
          setDiscardDialogOpen(false);
          clearBlockBoundaries();
          setNote("");
          if (next) {
            setDialogDate(next.date);
            setDialogTarget(next.target);
            setExceptionView(next.view ?? "date");
            setDate(next.date);
            setTarget(next.target);
            setBlockBarberId(
              activeBarbers.some((barber) => barber.id === next.target)
                ? next.target
                : "",
            );
            void load(next.date, next.target);
            setAddDialogOpen(true);
          } else {
            clearBlockBoundaries();
            setNote("");
            setAddDialogOpen(false);
            void reload();
          }
        }}
      />
    </section>
  );
}
