"use client";

import type { RefObject } from "react";
import type { BookingService } from "./types";
import { bookingStyles as styles } from "../shop-styles";

export function BookingStepBarbers({
  selectedService,
  barberId,
  selectedBarber,
  pending,
  headingRef,
  onSelectBarber,
  onBack,
  onContinue,
}: {
  selectedService: BookingService | undefined;
  barberId: string;
  selectedBarber: { id: string; name: string } | undefined;
  pending: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSelectBarber: (barberId: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section aria-labelledby="step-heading">
      <h3
        ref={headingRef}
        tabIndex={-1}
        id="step-heading"
        className={styles.stepHeading}
      >
        Pick your barber.
      </h3>
      <p className={styles.stepLead}>
        {selectedService?.name}. Choose a barber available for this service.
      </p>
      <fieldset className={styles.choiceList} disabled={pending}>
        <legend className={styles.visuallyHidden}>Choose a barber</legend>
        {selectedService?.barbers.map((barber) => (
          <label
            key={barber.id}
            className={
              barberId === barber.id ? styles.choiceSelected : styles.choice
            }
          >
            <input
              className={styles.radio}
              type="radio"
              name="barberId"
              value={barber.id}
              aria-label={barber.name}
              checked={barberId === barber.id}
              onChange={() => onSelectBarber(barber.id)}
            />
            <span className={styles.barberAvatar} aria-hidden="true">
              {barber.name.trim().charAt(0)}
            </span>
            <span className={styles.choiceText}>
              <strong className={styles.choiceTitle}>{barber.name}</strong>
              <small className={styles.choiceDetail}>
                {selectedService?.name} · Available for this service
              </small>
            </span>
            <span className={styles.choiceHint}>Choose this barber</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.textButton}
          disabled={pending}
          onClick={onBack}
        >
          Back to services
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!selectedBarber}
          onClick={onContinue}
        >
          Choose date and time <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
