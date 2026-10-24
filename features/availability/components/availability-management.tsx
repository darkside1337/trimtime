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
import { OverviewStat } from "./overview-stat";
import { weeklyOpenMinutes } from "../schedule-draft";

import type { AvailabilityData, AvailabilityOverview } from "../queries";

const availabilityTabs = [
  {
    id: "availability-tab-shop",
    panelId: "availability-panel-weekly",
    value: "shop",
    label: "Shop hours",
  },
  {
    id: "availability-tab-barber",
    panelId: "availability-panel-weekly",
    value: "barber",
    label: "Barber schedules",
  },
  {
    id: "availability-tab-dates",
    panelId: "availability-panel-dates",
    value: "dates",
    label: "Date overrides & blocks",
  },
] as const;

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

  function navigate(
    next: { target: ScheduleTarget; section: Section; addDate: boolean },
    options: { guardSameTarget?: boolean; discard?: boolean } = {},
  ) {
    if (pending) return;
    const sameTarget = isSameTarget(next.target, target);
    if (!options.discard && dirty && (options.guardSameTarget || !sameTarget)) {
      setPendingNavigation(next);
      return;
    }
    if (!sameTarget || options.discard) recurring.applyTarget(next.target);
    setSection(next.section);
    if (next.addDate)
      window.dispatchEvent(new Event("trimtime:availability-add"));
    if (options.discard) setPendingNavigation(null);
  }

  function changeSection(next: Section) {
    if (next === section) return;
    navigate(
      {
        target:
          next === "shop"
            ? { kind: "shop" }
            : next === "barber" && activeBarbers[0]
              ? { kind: "barber", barberId: activeBarbers[0].id }
              : target,
        section: next,
        addDate: false,
      },
      { guardSameTarget: true },
    );
  }

  function handleAddDateClick() {
    navigate(
      { target, section: "dates", addDate: true },
      { guardSameTarget: section !== "dates" },
    );
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

  return (
    <div className="mt-8 grid gap-6 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-foreground [&_button:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-foreground [&_input:focus-visible]:outline-offset-2 [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-foreground [&_select:focus-visible]:outline-offset-2">
      <div
        className="grid gap-3 min-[901px]:grid-cols-3"
        aria-label="Availability overview"
      >
        <OverviewStat
          ariaLabel="Weekly open hours"
          label="Weekly open hours"
          value={
            <>
              {Math.floor(weeklyMinutes / 60)}h
              {weeklyMinutes % 60 ? ` ${weeklyMinutes % 60}m` : ""}
            </>
          }
          detail="Saved shop hours after breaks"
        />
        <OverviewStat
          ariaLabel="Staff coverage"
          label="Staff coverage"
          value={`${activeBarberCount} ${activeBarberCount === 1 ? "barber" : "barbers"}`}
          detail="Active barbers with saved working hours"
        />
        <OverviewStat
          ariaLabel="Active exceptions"
          label="Saved future exceptions"
          value={`${initialOverview.exceptions.length} planned`}
          detail="Saved future closures, overrides, and barber blocks"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <Tabs
          value={section}
          onValueChange={changeSection}
          className="w-full min-w-0 min-[901px]:w-auto"
        >
          <TabsList className="grid h-auto! w-full grid-cols-3 gap-1">
            {availabilityTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                id={tab.id}
                aria-controls={tab.panelId}
                value={tab.value}
                disabled={pending}
                className="h-auto! min-h-11 whitespace-normal text-center text-xs sm:text-sm"
              >
                {tab.value === "dates"
                  ? `${tab.label} (${initialOverview.exceptions.length})`
                  : tab.label}
              </TabsTrigger>
            ))}
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
          onSwitchTarget={(next, nextSection) =>
            navigate({ target: next, section: nextSection, addDate: false })
          }
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
        onKeepEditing={() => setPendingNavigation(null)}
        onDiscard={() => {
          if (pendingNavigation) navigate(pendingNavigation, { discard: true });
        }}
      />
    </div>
  );
}
