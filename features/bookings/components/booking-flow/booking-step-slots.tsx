"use client";

import type { RefObject } from "react";
import type { BookingService, BookingSlot } from "./types";
import { addDays } from "./format";
import { bookingStyles as styles } from "../shop-styles";

const groups = [
  { label: "Morning", filter: (hour: number) => hour < 12 },
  { label: "Afternoon", filter: (hour: number) => hour >= 12 && hour < 17 },
  { label: "Evening", filter: (hour: number) => hour >= 17 },
];

export function BookingStepSlots({
  headingRef,
  timeZone,
  selectedService,
  selectedBarber,
  date,
  dateOptions,
  firstDate,
  dateRailPage,
  slots,
  startAt,
  loadingSlots,
  slotLoadError,
  pending,
  onDateRailPageChange,
  onDateChange,
  onStartAtChange,
  onRetry,
  onBack,
  onContinue,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  timeZone: string;
  selectedService: BookingService | undefined;
  selectedBarber: { id: string; name: string } | undefined;
  date: string;
  dateOptions: string[];
  firstDate: string;
  dateRailPage: number;
  slots: BookingSlot[];
  startAt: string;
  loadingSlots: boolean;
  slotLoadError: boolean;
  pending: boolean;
  onDateRailPageChange: (update: (page: number) => number) => void;
  onDateChange: (date: string) => void;
  onStartAtChange: (slot: BookingSlot) => void;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const pageCount = Math.ceil(dateOptions.length / 7);
  const visibleDates = dateOptions.slice(
    dateRailPage * 7,
    dateRailPage * 7 + 7,
  );
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${visibleDates[0]}T00:00:00Z`));

  return (
    <section aria-labelledby="step-heading">
      <h3
        ref={headingRef}
        tabIndex={-1}
        id="step-heading"
        className={styles.stepHeading}
      >
        Let’s find your time.
      </h3>
      <p className={styles.stepLead}>
        {selectedBarber?.name} · {selectedService?.name} ·{" "}
        {selectedService?.durationMinutes} minutes
      </p>
      <div className={styles.dateRailHeader}>
        <h4 className={styles.dateMonth}>{monthLabel}</h4>
        <div className="flex gap-2">
          <button
            type="button"
            className={styles.railButton}
            aria-label="Previous dates"
            disabled={dateRailPage === 0 || pending}
            onClick={() =>
              onDateRailPageChange((page) => Math.max(0, page - 1))
            }
          >
            ←
          </button>
          <button
            type="button"
            className={styles.railButton}
            aria-label="Next dates"
            disabled={dateRailPage >= pageCount - 1 || pending}
            onClick={() =>
              onDateRailPageChange((page) => Math.min(pageCount - 1, page + 1))
            }
          >
            →
          </button>
        </div>
      </div>
      <div
        className={styles.dateRail}
        role="group"
        aria-label="Available dates"
      >
        {visibleDates.map((option) => {
          const dateParts = new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            weekday: "short",
          }).format(new Date(`${option}T00:00:00Z`));
          const dayNumber = new Date(`${option}T00:00:00Z`).getUTCDate();
          const isSelected = date === option;
          return (
            <button
              key={option}
              type="button"
              className={
                isSelected ? styles.dateOptionSelected : styles.dateOption
              }
              aria-label={new Intl.DateTimeFormat("en-US", {
                timeZone: "UTC",
                dateStyle: "full",
              }).format(new Date(`${option}T00:00:00Z`))}
              aria-pressed={isSelected}
              disabled={pending}
              onClick={() => onDateChange(option)}
            >
              <span className={isSelected ? "text-white" : styles.dateWeekday}>
                {dateParts}
              </span>
              <span className={styles.dateNumber}>{dayNumber}</span>
            </button>
          );
        })}
      </div>
      <label className={styles.dateNativeFallback}>
        Or enter a date
        <input
          className={styles.dateInput}
          aria-label="Date"
          type="date"
          min={firstDate}
          max={addDays(firstDate, 30)}
          required
          value={date}
          disabled={pending}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </label>
      <p className={styles.timeZoneNote}>
        {timeZone} · Choose an available start below
      </p>
      {loadingSlots ? (
        <p role="status" className={styles.inlineStatus}>
          Loading available starts…
        </p>
      ) : null}
      {slotLoadError && !loadingSlots ? (
        <div className={styles.emptyState} role="alert">
          <h4>Times could not be loaded.</h4>
          <p>Try again to check this date’s current availability.</p>
          <button
            type="button"
            className={styles.inlineAction}
            onClick={onRetry}
          >
            Retry availability
          </button>
        </div>
      ) : null}
      {date && !loadingSlots && !slotLoadError && slots.length === 0 ? (
        <div className={styles.emptyState}>
          <h4>No chairs at this time.</h4>
          <p>
            No times are currently available for this barber and date. Choose
            another date or barber.
          </p>
        </div>
      ) : null}
      {slots.length > 0 ? (
        <fieldset
          className={styles.slotGroups}
          aria-label="Available start times"
          disabled={pending}
        >
          <legend className={styles.visuallyHidden}>
            Choose an available start time
          </legend>
          {groups.map(({ label, filter }) => {
            const groupSlots = slots.filter((slot) =>
              filter(Number(slot.localStart.slice(0, 2))),
            );
            if (!groupSlots.length) return null;
            return (
              <div key={label}>
                <h4 className={styles.groupHeading}>{label}</h4>
                <div className={styles.slotGrid}>
                  {groupSlots.map((slot) => (
                    <label
                      key={slot.start}
                      className={
                        slot.start === startAt
                          ? styles.slotSelected
                          : styles.slot
                      }
                    >
                      <input
                        type="radio"
                        name="startAt"
                        value={slot.start}
                        checked={slot.start === startAt}
                        disabled={pending}
                        onChange={() => onStartAtChange(slot)}
                      />
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: "UTC",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(`1970-01-01T${slot.localStart}:00Z`))}
                      {slot.offset !== "+00:00" ? (
                        <small>UTC{slot.offset}</small>
                      ) : null}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>
      ) : null}
      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.textButton}
          disabled={pending}
          onClick={onBack}
        >
          Back to barbers
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!startAt}
          onClick={onContinue}
        >
          Your details <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
