"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateAvailabilityManagement } from "./date-availability-management";
import { useRecurringSchedule } from "../hooks/use-recurring-schedule";
import { isSameTarget, type ScheduleTarget, type Section } from "../types";
import { SlotPreviewPanel } from "./slot-preview-panel";
import { UpcomingSavedExceptions } from "./upcoming-saved-exceptions";
import { RecurringHoursPanel } from "./recurring-hours-panel";
import { BreakEditorDialog } from "./break-editor-dialog";
import { weeklyOpenMinutes } from "../schedule-draft";

import type { AvailabilityData, AvailabilityOverview } from "../queries";

export function AvailabilityManagement({
  initial,
  initialOverview,
}: {
  initial: AvailabilityData;
  initialOverview: AvailabilityOverview;
}) {
  const [previewInvalidationKey, setPreviewInvalidationKey] = useState(0);
  const invalidatePreview = useCallback(() => {
    setPreviewInvalidationKey((key) => key + 1);
  }, []);
  const recurring = useRecurringSchedule(initial, invalidatePreview);
  const {
    data,
    target,
    dirty,
    pending,
    message,
    fieldErrors,
    breakDay,
    breakRangeIndex,
    breakRange,
    breakOpener,
    breakStartInput,
  } = recurring;
  const [section, setSection] = useState<Section>("shop");
  const [pendingNavigation, setPendingNavigation] = useState<{
    target: ScheduleTarget;
    section: Section;
    addDate: boolean;
  } | null>(null);

  useEffect(() => {
    const clearPreview = () => invalidatePreview();
    window.addEventListener("trimtime:availability-changed", clearPreview);
    return () =>
      window.removeEventListener("trimtime:availability-changed", clearPreview);
  }, [invalidatePreview]);
  const activeBarbers = data.barbers.filter((item) => !item.archived);
  const weeklyMinutes = weeklyOpenMinutes(data.shop.week);
  const activeBarberCount = data.barbers.filter(
    (item) =>
      !item.archived &&
      item.schedule.week.some((day) => day.working.length > 0),
  ).length;

  function applyTarget(next: ScheduleTarget) {
    recurring.applyTarget(next);
  }

  function switchTo(next: ScheduleTarget, nextSection: Section) {
    if (pending) return;
    const sameTarget = isSameTarget(next, target);
    if (dirty && !sameTarget) {
      setPendingNavigation({
        target: next,
        section: nextSection,
        addDate: false,
      });
      return;
    }
    if (!sameTarget) applyTarget(next);
    setSection(nextSection);
  }

  function changeSection(next: Section) {
    if (next === section) return;
    if (dirty) {
      setPendingNavigation({
        target:
          next === "shop"
            ? { kind: "shop" }
            : next === "barber" && activeBarbers[0]
              ? { kind: "barber", barberId: activeBarbers[0].id }
              : target,
        section: next,
        addDate: false,
      });
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

  function handleAddDateClick() {
    if (dirty && section !== "dates") {
      setPendingNavigation({ target, section: "dates", addDate: true });
      return;
    }
    changeSection("dates");
    window.dispatchEvent(new Event("trimtime:availability-add"));
  }

  function handleEditException(
    exception: AvailabilityOverview["exceptions"][number],
  ) {
    window.dispatchEvent(
      new CustomEvent("trimtime:availability-edit", {
        detail: {
          date: exception.date,
          target: exception.target,
          view: exception.kind === "block" ? "block" : "date",
        },
      }),
    );
  }

  function handleKeepEditing() {
    setPendingNavigation(null);
  }

  function handleDiscardChanges() {
    if (!pendingNavigation) return;
    const next = pendingNavigation;
    applyTarget(next.target);
    setSection(next.section);
    if (next.addDate)
      window.dispatchEvent(new Event("trimtime:availability-add"));
    setPendingNavigation(null);
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
            {Math.floor(weeklyMinutes / 60)}h
            {weeklyMinutes % 60 ? ` ${weeklyMinutes % 60}m` : ""}
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
            {activeBarberCount} {activeBarberCount === 1 ? "barber" : "barbers"}
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
            {initialOverview.exceptions.length} planned
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
              aria-controls="availability-panel-weekly"
              value="shop"
              disabled={pending}
              className="h-auto! min-h-11 whitespace-normal text-center text-xs sm:text-sm"
            >
              Shop hours
            </TabsTrigger>
            <TabsTrigger
              id="availability-tab-barber"
              aria-controls="availability-panel-weekly"
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
              Date overrides &amp; blocks ({initialOverview.exceptions.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button type="button" disabled={pending} onClick={handleAddDateClick}>
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
        id="availability-panel-weekly"
        role="tabpanel"
        aria-labelledby={
          section === "shop"
            ? "availability-tab-shop"
            : "availability-tab-barber"
        }
        tabIndex={0}
        hidden={section !== "shop" && section !== "barber"}
      >
        <RecurringHoursPanel
          workflow={recurring}
          section={section}
          onSwitchTarget={switchTo}
        />
      </div>
      <div
        id="availability-panel-dates"
        role="tabpanel"
        aria-labelledby="availability-tab-dates"
        tabIndex={0}
        hidden={section !== "dates"}
      >
        <DateAvailabilityManagement initial={data} />
        <UpcomingSavedExceptions
          exceptions={initialOverview.exceptions}
          onEdit={handleEditException}
        />
      </div>

      <SlotPreviewPanel
        data={data}
        hidden={section !== "shop"}
        invalidationKey={previewInvalidationKey}
        disabled={pending}
      />
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
      <BreakEditorDialog
        open={breakDay !== null}
        rangeIndex={breakRangeIndex}
        range={breakRange}
        label={target.kind === "shop" ? "Shop lunch" : "Personal break"}
        startInput={breakStartInput}
        opener={breakOpener}
        onOpenChange={(open) => {
          if (!open) recurring.closeBreak();
        }}
        onChange={recurring.setBreakRange}
        onSave={recurring.saveBreak}
      />
      <OwnerDiscardDialog
        open={pendingNavigation !== null}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscardChanges}
      />
    </div>
  );
}
