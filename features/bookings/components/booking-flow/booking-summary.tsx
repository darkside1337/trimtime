"use client";

import type { BookingService } from "./types";
import { formatDate, money } from "./format";
import { bookingStyles as styles } from "../shop-styles";

export function BookingSummary({
  shopName,
  publicContact,
  selectedService,
  selectedBarber,
  date,
  selectedStartLocal,
}: {
  shopName: string;
  publicContact: string;
  selectedService: BookingService | undefined;
  selectedBarber: { id: string; name: string } | undefined;
  date: string;
  selectedStartLocal: string | undefined;
}) {
  return (
    <aside className={styles.summary} aria-label="Booking summary">
      <p className={styles.summaryKicker}>Your chair, on paper</p>
      <h3>{shopName}.</h3>
      <dl>
        <div>
          <dt>Service</dt>
          <dd>
            {selectedService
              ? `${selectedService.name} · ${selectedService.durationMinutes} min`
              : "Choose your service"}
          </dd>
        </div>
        <div>
          <dt>Barber</dt>
          <dd>{selectedBarber?.name ?? "Choose your barber"}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDate(date)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{selectedStartLocal ?? "Choose your time"}</dd>
        </div>
      </dl>
      <div className={styles.summaryTotal}>
        <span>Total</span>
        <strong>
          {selectedService ? money(selectedService.priceUsd) : "—"}
        </strong>
      </div>
      <p className={styles.summaryCaption}>USD · Pay at the shop</p>
      <div className={styles.summaryHelp}>
        <strong>Need to change your plans?</strong>
        <p>Contact the shop directly at {publicContact}.</p>
      </div>
      <p className={styles.summaryEnd}>Good hair. No fuss.</p>
    </aside>
  );
}
