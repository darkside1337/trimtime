"use client";

import type { RefObject } from "react";
import type { BookingContact, BookingService } from "./types";
import { money } from "./format";
import { bookingStyles as styles } from "../shop-styles";

export function BookingStepContact({
  headingRef,
  selectedService,
  startAt,
  pending,
  message,
  messageKind,
  selectedStartIsWithinChangeWindow,
  publicContact,
  contact,
  onContactChange,
  onBackToTime,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  selectedService: BookingService | undefined;
  startAt: string;
  pending: boolean;
  message: string;
  messageKind: "error" | "info";
  selectedStartIsWithinChangeWindow: boolean;
  publicContact: string;
  contact: BookingContact;
  onContactChange: (contact: BookingContact) => void;
  onBackToTime: () => void;
}) {
  return (
    <section aria-labelledby="step-heading">
      <h3
        ref={headingRef}
        tabIndex={-1}
        id="step-heading"
        className={styles.stepHeading}
      >
        The last little detail.
      </h3>
      <p className={styles.stepLead}>
        No account to create. Just a way to reach you.
      </p>
      {selectedStartIsWithinChangeWindow ? (
        <p className={styles.shortNotice} role="note">
          This start is within twelve hours. Online changes won’t be available;
          contact {publicContact} if plans change.
        </p>
      ) : null}
      {message ? (
        <p
          className={
            messageKind === "error" ? styles.errorMessage : styles.inlineStatus
          }
          role={messageKind === "error" ? "alert" : "status"}
        >
          {message}
          {message.includes("Choose another available time") ? (
            <button
              type="button"
              className={styles.inlineAction}
              onClick={onBackToTime}
            >
              Choose another time
            </button>
          ) : null}
        </p>
      ) : null}
      <div className={styles.contactFields}>
        <label className={styles.field}>
          <span>
            Full name <small>(required)</small>
          </span>
          <input
            aria-label="Name"
            required
            autoComplete="name"
            disabled={pending}
            value={contact.name}
            onChange={(event) =>
              onContactChange({ ...contact, name: event.target.value })
            }
          />
        </label>
        <label className={styles.field}>
          <span>
            Email address <small>(required)</small>
          </span>
          <input
            aria-label="Email"
            required
            type="email"
            autoComplete="email"
            disabled={pending}
            value={contact.email}
            onChange={(event) =>
              onContactChange({ ...contact, email: event.target.value })
            }
          />
          <small>
            Email is required to create the booking. A confirmation may be
            captured locally when configured; inbox delivery is not enabled.
          </small>
        </label>
        <label className={styles.field}>
          <span>
            {contact.whatsappOptIn ? "WhatsApp phone number" : "Phone number"}{" "}
            <small>
              ({contact.whatsappOptIn ? "required for updates" : "optional"})
            </small>
          </span>
          <input
            aria-label={
              contact.whatsappOptIn ? "WhatsApp phone number" : "Phone number"
            }
            required={contact.whatsappOptIn}
            type="tel"
            autoComplete="tel"
            disabled={pending}
            value={contact.phone}
            onChange={(event) =>
              onContactChange({ ...contact, phone: event.target.value })
            }
          />
        </label>
        <label className={styles.consentField}>
          <input
            type="checkbox"
            disabled={pending}
            checked={contact.whatsappOptIn}
            onChange={(event) =>
              onContactChange({
                ...contact,
                whatsappOptIn: event.target.checked,
              })
            }
          />
          <span>
            <strong>I’d like WhatsApp booking updates</strong>
            <small>Optional. Messages are not sent in this demo.</small>
          </span>
        </label>
      </div>
      <p className={styles.deliveryNote}>
        Your appointment is confirmed immediately when the request succeeds. A
        private booking link appears on the next screen.
      </p>
      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.textButton}
          disabled={pending}
          onClick={onBackToTime}
        >
          Back to time
        </button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending || !startAt}
        >
          {pending
            ? "Confirming…"
            : `Confirm booking · ${selectedService ? money(selectedService.priceUsd) : ""}`}
        </button>
      </div>
      <p className={styles.contactHelp}>
        For questions or changes, contact {publicContact}.
      </p>
    </section>
  );
}
