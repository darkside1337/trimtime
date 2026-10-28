"use client";

import type { RefObject } from "react";
import type { BookingService } from "./types";
import { money } from "./format";
import { bookingStyles as styles } from "../shop-styles";

export function BookingStepServices({
  services,
  serviceId,
  selectedService,
  pending,
  message,
  headingRef,
  onSelectService,
  onContinue,
}: {
  services: BookingService[];
  serviceId: string;
  selectedService: BookingService | undefined;
  pending: boolean;
  message: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSelectService: (service: BookingService) => void;
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
        What are we doing today?
      </h3>
      {message ? (
        <p className={styles.errorMessage} role="alert">
          {message}
        </p>
      ) : null}
      <p className={styles.stepLead}>
        Choose the service you would like to book.
      </p>
      <fieldset className={styles.choiceList} disabled={pending}>
        <legend className={styles.visuallyHidden}>Choose a service</legend>
        {services.map((service) => (
          <label
            key={service.id}
            className={
              serviceId === service.id ? styles.choiceSelected : styles.choice
            }
          >
            <input
              className={styles.radio}
              aria-label={`${service.name}, ${money(service.priceUsd)}, ${service.durationMinutes} minutes`}
              type="radio"
              name="serviceId"
              value={service.id}
              checked={serviceId === service.id}
              onChange={() => onSelectService(service)}
            />
            <span className={styles.choiceText}>
              <strong className={styles.choiceTitle}>{service.name}</strong>
              <small className={styles.choiceDetail}>
                {service.durationMinutes} minutes
              </small>
            </span>
            <span className={styles.choicePrice}>
              {money(service.priceUsd)}
              <small className={styles.choicePriceCurrency}>USD</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className={styles.stepActions}>
        <span className={styles.stepHint}>One service. All the attention.</span>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!selectedService}
          onClick={onContinue}
        >
          Choose your barber <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
