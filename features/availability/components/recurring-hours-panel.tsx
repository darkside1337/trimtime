"use client";

import { Button } from "@/components/ui/button";
import type { useRecurringSchedule } from "../hooks/use-recurring-schedule";
import type { ScheduleTarget, Section } from "../types";
import { days } from "../schedule-draft";
import { ScheduleEditor } from "./weekly-schedule-editor";

type Controller = ReturnType<typeof useRecurringSchedule>;

export function RecurringHoursPanel({
  workflow,
  section,
  onSwitchTarget,
}: {
  workflow: Controller;
  section: Section;
  onSwitchTarget: (target: ScheduleTarget, section: Section) => void;
}) {
  const {
    data,
    target,
    schedule,
    draft,
    pending,
    message,
    fieldErrors,
    dirty,
    canReload,
    change,
    addBreak,
    editBreak,
    copyMonday,
    copyShop,
    save,
    reload,
  } = workflow;
  const activeBarbers = data.barbers.filter((barber) => !barber.archived);
  const minutesByDay = data.shop.week.map(
    (day) =>
      day.working.reduce((sum, range) => sum + range.end - range.start, 0) -
      day.breaks.reduce((sum, range) => sum + range.end - range.start, 0),
  );
  const maxMinutes = Math.max(...minutesByDay, 1);

  return (
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
            {section === "shop" ? "Shop operating hours" : "Barber schedule"}
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
          onClick={copyMonday}
        >
          Copy Mon to weekdays
        </Button>
      )}
      {section === "barber" && (
        <div className="mt-5 grid gap-3">
          <h3 className="text-sm font-medium">Individual barber schedule</h3>
          <div className="flex flex-wrap gap-2" aria-label="Choose a barber">
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
                    onSwitchTarget(
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
            onClick={copyShop}
          >
            Copy shop hours once
          </Button>
        </div>
      )}
      <div
        id="weekly-schedule-panel"
        role="region"
        aria-label={
          section === "shop" ? "Shop weekly schedule" : "Barber weekly schedule"
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
            onChange={change}
            disabled={pending}
            fieldErrors={fieldErrors}
            onAddBreak={addBreak}
            onEditBreak={editBreak}
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
            {data.shop.week.map((_, index) => {
              const minutes = minutesByDay[index] ?? 0;
              const barHeight = Math.round((minutes / maxMinutes) * 64);
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
    </section>
  );
}
