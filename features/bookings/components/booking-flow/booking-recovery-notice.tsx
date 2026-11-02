"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingBookingAttempt } from "./recovery";
import { bookingStyles as styles } from "../shop-styles";

export type RecoveryNoticeKind =
  | "saved"
  | "uncertain"
  | "changed"
  | "mismatch"
  | "legacy"
  | "expired"
  | "corrupt";

const headings: Record<RecoveryNoticeKind, string> = {
  saved: "Check your earlier booking request",
  uncertain: "We couldn’t confirm your booking",
  changed: "Check the earlier request first",
  mismatch: "An earlier request may already be booked",
  legacy: "An earlier request may already be booked",
  expired: "The earlier request details expired",
  corrupt: "The earlier request details couldn’t be read",
};

export function BookingRecoveryNotice({
  kind,
  attempt,
  timeZone,
  publicContact,
  pending,
  onRecover,
  onStartNew,
}: {
  kind: RecoveryNoticeKind;
  attempt: PendingBookingAttempt | null;
  timeZone: string;
  publicContact: string;
  pending: boolean;
  onRecover: () => void;
  onStartNew: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const warningRef = useRef<HTMLHeadingElement>(null);
  const canRecover =
    attempt !== null &&
    (kind === "saved" ||
      kind === "uncertain" ||
      kind === "changed" ||
      kind === "mismatch");
  const description =
    kind === "saved"
      ? "A booking request from this browser tab may have been saved. Check it before starting over so you don’t book twice."
      : kind === "uncertain"
        ? "The last request didn’t return a clear result. It may have been saved. Check the same request before starting over."
        : kind === "changed"
          ? "The form details are different from the saved request. That request may already be booked; check it first."
          : kind === "mismatch"
            ? `This tab’s earlier request couldn’t be confirmed by the shop. It may already be booked. Check it again; if the warning returns, check with ${publicContact} before starting a separate booking.`
            : kind === "legacy"
              ? `This tab has a recovery code from an earlier version, but not the original request details. If you sent a request, it may already be booked. Check with ${publicContact} before starting a new booking.`
              : kind === "expired"
                ? `The recovery copy kept in this tab expired. If you sent a request, it may already be booked. Check with ${publicContact} before starting a new booking.`
                : `The recovery details kept in this tab couldn’t be read. If you sent a request, it may already be booked. Check with ${publicContact} before starting a new booking.`;

  useEffect(() => {
    if (confirming) warningRef.current?.focus();
    else headingRef.current?.focus();
  }, [confirming, kind]);

  const summary = attempt
    ? `${attempt.payload.reviewedOffer.name} · ${new Intl.DateTimeFormat(
        "en-US",
        {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone,
        },
      ).format(new Date(attempt.payload.startAt))}`
    : null;

  return (
    <section
      className="col-span-full grid gap-3 border-l-2 border-[#21734f] bg-[#f7f7f5] px-4 py-3.5 text-[13px] leading-[1.6] text-[#242424]"
      aria-labelledby="booking-recovery-heading"
      aria-describedby="booking-recovery-description"
    >
      <h3
        ref={headingRef}
        id="booking-recovery-heading"
        tabIndex={-1}
        className="m-0 font-[family-name:var(--font-shop-display)] text-[22px] font-bold uppercase leading-none focus:outline-none"
      >
        {headings[kind]}
      </h3>
      <p id="booking-recovery-description" className="m-0">
        {description}
      </p>
      {summary ? (
        <p className="m-0 text-xs text-[#72726e]">Saved request: {summary}</p>
      ) : null}
      <p className="m-0 text-xs text-[#72726e]">
        Recovery details stay in this browser tab only. After one hour, the
        contact details are removed when you return or retry, if browser storage
        permits it. The warning stays until this booking is confirmed or you
        choose to start over.
      </p>
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {canRecover ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={pending}
              onClick={onRecover}
            >
              {pending ? "Checking…" : "Check earlier request"}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.textButton}
            disabled={pending}
            onClick={() => {
              setAcknowledged(false);
              setConfirming(true);
            }}
          >
            Start a separate booking
          </button>
        </div>
      ) : (
        <div
          className="grid gap-3 border-t border-[#e6e6e2] pt-3"
          role="group"
          aria-labelledby="booking-recovery-warning"
        >
          <h4
            ref={warningRef}
            id="booking-recovery-warning"
            tabIndex={-1}
            className="m-0 text-sm font-bold focus:outline-none"
          >
            This may create a second appointment.
          </h4>
          <p className="m-0">
            If the earlier request was saved, starting a separate booking will
            create another appointment. Check the earlier request first when
            possible.
          </p>
          <label className={styles.consentField}>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={pending}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              <strong>I understand a second appointment may be created</strong>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!acknowledged || pending}
              onClick={onStartNew}
            >
              Start separate booking anyway
            </button>
            <button
              type="button"
              className={styles.textButton}
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Keep checking the earlier request
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
