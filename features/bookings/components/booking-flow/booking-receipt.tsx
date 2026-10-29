"use client";

import { useEffect, useRef } from "react";
import type { PublicBookingReceipt } from "../../types";
import { customerEmailStatusCopy } from "@/features/notifications/customer-summary";
import { money } from "./format";
import { bookingStyles as styles } from "../shop-styles";

export function BookingReceipt({
  receipt,
  publicContact,
  onBookAnother,
}: {
  receipt: PublicBookingReceipt;
  publicContact: string;
  onBookAnother: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const when = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: receipt.booking.shop.timeZone,
  }).format(new Date(receipt.booking.startAt));

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <section className={styles.receipt} aria-labelledby="receipt-heading">
      <div className={styles.receiptMark} aria-hidden="true">
        ✓
      </div>
      <p className={styles.eyebrow}>Looking forward to it.</p>
      <h2
        ref={headingRef}
        id="receipt-heading"
        className={styles.receiptHeading}
        tabIndex={-1}
      >
        Your chair is reserved.
      </h2>
      <p className={styles.receiptIntro}>
        Your booking is confirmed. Keep this private link to view its details.
      </p>
      <dl className={styles.receiptDetails}>
        <div>
          <dt>Service</dt>
          <dd>
            {receipt.booking.service.name} ·{" "}
            {receipt.booking.service.durationMinutes} min
          </dd>
        </div>
        <div>
          <dt>Barber</dt>
          <dd>{receipt.booking.barber.name}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>
            <time dateTime={receipt.booking.startAt}>{when}</time>
          </dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>{receipt.booking.shop.name}</dd>
        </div>
        <div>
          <dt>Guest</dt>
          <dd>{receipt.booking.customer.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{receipt.booking.customer.email ?? "No email provided"}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>
            {money(receipt.booking.service.priceUsd)} USD · Pay at the shop
          </dd>
        </div>
      </dl>
      <section
        className={styles.linkPanel}
        aria-labelledby="private-link-heading"
      >
        <h3 id="private-link-heading">Your private booking link</h3>
        <a
          href={receipt.manageUrl}
          className={`${styles.primaryLink} justify-self-end`}
        >
          Open booking details <span aria-hidden="true">↗</span>
        </a>
        <p>Anyone with this link can view this booking. Keep it private.</p>
      </section>
      <p className={styles.deliveryNote} role="status">
        {customerEmailStatusCopy(receipt.notifications.email)} For changes,
        contact the shop at {publicContact}.
      </p>
      <button
        type="button"
        className={styles.textButton}
        onClick={onBookAnother}
      >
        Book another appointment
      </button>
    </section>
  );
}
