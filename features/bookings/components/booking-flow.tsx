"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionError } from "@/lib/action-result";
import { createPublicBookingAction, getBookingSlotsAction } from "../actions";
import type { PublicBookingReceipt } from "../types";
import { bookingStyles as styles } from "./shop-styles";
import { createRecoveryKey } from "./recovery-key";
import { BookingReceipt } from "./booking-flow/booking-receipt";
import { BookingRecoveryNotice } from "./booking-flow/booking-recovery-notice";
import { BookingSummary } from "./booking-flow/booking-summary";
import { BookingStepServices } from "./booking-flow/booking-step-services";
import { BookingStepBarbers } from "./booking-flow/booking-step-barbers";
import { BookingStepSlots } from "./booking-flow/booking-step-slots";
import { BookingStepContact } from "./booking-flow/booking-step-contact";
import { addDays, shopToday } from "./booking-flow/format";
import {
  browserSessionStorage,
  classifyBookingFailure,
  clearPendingAttempt,
  clearPendingRecovery,
  isPendingAttemptExpired,
  readPendingAttempt,
  readPendingWarning,
  resolveRecoveryRestore,
  sameBookingPayload,
  savePendingAttempt,
  savePendingWarning,
  shopDateForStart,
  type BookingPayload,
  type PendingBookingAttempt,
  type RecoveryWarningKind,
} from "./booking-flow/recovery";
import type { RecoveryNoticeKind } from "./booking-flow/booking-recovery-notice";
import type {
  BookingContact,
  BookingService,
  BookingSlot,
} from "./booking-flow/types";

const stepNames = ["Service", "Barber", "Date & time", "Your details"];

export function BookingFlow({
  services,
  shopName,
  publicContact,
  timeZone,
}: {
  services: BookingService[];
  shopName: string;
  publicContact: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState("");
  const selectedService = services.find((service) => service.id === serviceId);
  const [barberId, setBarberId] = useState("");
  const selectedBarber = selectedService?.barbers.find(
    (barber) => barber.id === barberId,
  );
  const [date, setDate] = useState("");
  const [dateRailPage, setDateRailPage] = useState(0);
  const [slotLoadError, setSlotLoadError] = useState(false);
  const [slotRetry, setSlotRetry] = useState(0);
  const [startAt, setStartAt] = useState("");
  const [
    selectedStartIsWithinChangeWindow,
    setSelectedStartIsWithinChangeWindow,
  ] = useState(false);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [contact, setContact] = useState<BookingContact>({
    name: "",
    email: "",
    phone: "",
    whatsappOptIn: false,
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "info">("info");
  const [receipt, setReceipt] = useState<PublicBookingReceipt | null>(null);
  const [recoveryNotice, setRecoveryNotice] =
    useState<RecoveryNoticeKind | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [attemptView, setAttemptView] = useState<PendingBookingAttempt | null>(
    null,
  );
  const attemptRef = useRef<PendingBookingAttempt | null>(null);
  const recoveryHydratedRef = useRef(false);
  const inFlightRef = useRef(false);
  const focusHeadingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusHeadingRef.current) return;
    headingRef.current?.focus();
    focusHeadingRef.current = false;
  }, [step]);

  useEffect(() => {
    if (recoveryHydratedRef.current) return;
    recoveryHydratedRef.current = true;
    const storage = browserSessionStorage();
    const restore = resolveRecoveryRestore(
      readPendingAttempt(storage),
      readPendingWarning(storage),
    );
    if (restore.status === "none" && !restore.degraded) return;
    void Promise.resolve().then(() => {
      if (restore.degraded || restore.status === "unavailable")
        setStorageUnavailable(true);
      if (restore.status === "none" || restore.status === "unavailable") return;
      if (restore.status === "warning") {
        setRecoveryNotice(restore.notice);
        return;
      }
      const attempt = restore.attempt;
      attemptRef.current = attempt;
      setAttemptView(attempt);
      const restoredService = services.find(
        (service) => service.id === attempt.payload.serviceId,
      );
      const restoredBarber = restoredService?.barbers.find(
        (barber) => barber.id === attempt.payload.barberId,
      );
      setServiceId(restoredService?.id ?? "");
      setBarberId(restoredBarber?.id ?? "");
      setContact({
        name: attempt.payload.contact.name,
        email: attempt.payload.contact.email,
        phone: attempt.payload.contact.phone ?? "",
        whatsappOptIn: attempt.payload.contact.whatsappOptIn,
      });
      if (restoredService && restoredBarber) {
        const restoredDate = shopDateForStart(
          attempt.payload.startAt,
          timeZone,
        );
        setDate(restoredDate);
        setStartAt(attempt.payload.startAt);
        setSelectedStartIsWithinChangeWindow(
          new Date(attempt.payload.startAt).getTime() - Date.now() <
            12 * 60 * 60 * 1000,
        );
        const firstDate = shopToday(timeZone);
        const dayIndex = Math.round(
          (Date.parse(`${restoredDate}T00:00:00Z`) -
            Date.parse(`${firstDate}T00:00:00Z`)) /
            86_400_000,
        );
        if (dayIndex >= 0 && dayIndex < 31)
          setDateRailPage(Math.floor(dayIndex / 7));
        setStep(3);
      }
      setRecoveryNotice(restore.notice);
    });
  }, [services, timeZone]);

  useEffect(() => {
    if (!selectedService || !selectedBarber || !date) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoadingSlots(true);
        setSlotLoadError(false);
        return getBookingSlotsAction({ serviceId, barberId, date });
      })
      .then((result) => {
        if (!active) return;
        if (!result) throw new Error("Availability could not be loaded.");
        setSlots(result.slots);
      })
      .catch(() => {
        if (active) {
          setSlots([]);
          setSlotLoadError(true);
        }
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });
    return () => {
      active = false;
    };
  }, [barberId, date, selectedBarber, selectedService, serviceId, slotRetry]);

  function goTo(nextStep: number) {
    if (inFlightRef.current) return;
    setStep(nextStep);
    focusHeadingRef.current = true;
    setMessage("");
  }

  function clearStartAt() {
    setStartAt("");
    setSelectedStartIsWithinChangeWindow(false);
  }

  function selectService(service: BookingService) {
    if (inFlightRef.current) return;
    if (serviceId !== service.id) {
      setBarberId("");
      setDate("");
      clearStartAt();
      setSlots([]);
      setLoadingSlots(false);
      setSlotLoadError(false);
    }
    setServiceId(service.id);
  }

  function selectBarber(nextBarberId: string) {
    if (inFlightRef.current) return;
    setBarberId(nextBarberId);
    setDate("");
    clearStartAt();
    setSlots([]);
    setLoadingSlots(false);
    setSlotLoadError(false);
  }

  function selectStartAt(slot: BookingSlot) {
    if (inFlightRef.current) return;
    setStartAt(slot.start);
    setSelectedStartIsWithinChangeWindow(
      new Date(slot.start).getTime() - Date.now() < 12 * 60 * 60 * 1000,
    );
  }

  function updateContact(nextContact: BookingContact) {
    if (inFlightRef.current) return;
    setContact(nextContact);
  }

  function persistWarning(kind: RecoveryWarningKind) {
    const saved = savePendingWarning(browserSessionStorage(), kind);
    if (!saved) setStorageUnavailable(true);
    return saved;
  }

  function clearRecovery() {
    attemptRef.current = null;
    setAttemptView(null);
    clearPendingRecovery(browserSessionStorage());
  }

  function expireAttempt() {
    // The payload is past its privacy window; drop it but keep an anonymous
    // warning so later reloads stay gated.
    if (persistWarning("expired")) clearPendingAttempt(browserSessionStorage());
    attemptRef.current = null;
    setAttemptView(null);
  }

  function currentPayload(): BookingPayload | null {
    if (!selectedService || !selectedBarber || !startAt) return null;
    return {
      serviceId: selectedService.id,
      barberId: selectedBarber.id,
      startAt,
      reviewedOffer: {
        name: selectedService.name,
        priceUsd: Number(selectedService.priceUsd).toFixed(2),
        durationMinutes: String(selectedService.durationMinutes),
      },
      contact: { ...contact, phone: contact.phone || undefined },
    };
  }

  function handleFailure(error: ActionError, recovering: boolean) {
    const disposition = classifyBookingFailure(error.code, recovering);

    if (disposition === "mismatch") {
      // The attempt may have committed even when its saved receipt could not
      // be produced. Keep the original context and warning instead of
      // silently forgetting that an unknown request may exist.
      persistWarning("mismatch");
      setRecoveryNotice("mismatch");
      setMessage(
        "The shop couldn’t confirm this earlier request. It may already be booked. Check it again, or check with the shop before starting a separate booking.",
      );
      setMessageKind("error");
      return;
    }

    if (disposition === "unknown") {
      persistWarning("uncertain");
      setRecoveryNotice("uncertain");
      setMessage(
        error.code === "SHOP_PAUSED"
          ? "The shop isn’t accepting bookings right now. That response doesn’t confirm whether your earlier request was saved. Check the earlier request when the shop reopens."
          : `${error.message} We couldn’t confirm whether this request was saved. Check the same request before starting over.`,
      );
      setMessageKind("error");
      return;
    }

    clearRecovery();
    setRecoveryNotice(null);
    if (error.code === "STALE_OFFER") {
      setServiceId("");
      setBarberId("");
      setDate("");
      clearStartAt();
      setSlots([]);
      setLoadingSlots(false);
      setStep(0);
      focusHeadingRef.current = true;
      setMessage(
        "The service details changed. Review the current options and choose again.",
      );
      setMessageKind("error");
      router.refresh();
    } else if (error.code === "UNAVAILABLE_INTERVAL") {
      setSlots((current) => current.filter((slot) => slot.start !== startAt));
      clearStartAt();
      setMessage(
        "That time was just taken. No booking was created; your details are still here. Choose another available time.",
      );
      setMessageKind("error");
    } else {
      setMessage(error.message);
      setMessageKind("error");
    }
  }

  async function sendAttempt(
    payload: BookingPayload,
    key: string,
    recovering = false,
  ) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(true);
    setMessage(
      recovering ? "Checking your saved request…" : "Confirming your booking…",
    );
    setMessageKind("info");
    try {
      const result = await createPublicBookingAction({
        ...payload,
        recoveryKey: key,
      });
      if (result.success) {
        clearRecovery();
        setRecoveryNotice(null);
        setReceipt(result.data);
      } else {
        handleFailure(result.error, recovering);
      }
    } catch {
      persistWarning("uncertain");
      setRecoveryNotice("uncertain");
      setMessage(
        "We couldn’t confirm whether this booking was saved. Check the same request before starting over.",
      );
      setMessageKind("error");
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  async function recoverSavedAttempt() {
    const attempt = attemptRef.current;
    if (!attempt || inFlightRef.current) return;
    if (isPendingAttemptExpired(attempt)) {
      expireAttempt();
      setRecoveryNotice("expired");
      setMessage(
        "The recovery copy saved in this tab expired. If the earlier request was saved, it may still exist. Check with the shop before booking again.",
      );
      setMessageKind("error");
      return;
    }
    await sendAttempt(attempt.payload, attempt.recoveryKey, true);
  }

  function startSeparateBooking() {
    clearRecovery();
    setRecoveryNotice(null);
    setMessage(
      "Recovery warning cleared. If you’re unsure whether the earlier request was saved, check with the shop before booking the same time.",
    );
    setMessageKind("info");
    headingRef.current?.focus();
  }

  function resetFlow() {
    clearRecovery();
    setRecoveryNotice(null);
    setReceipt(null);
    setServiceId("");
    setBarberId("");
    setDate("");
    clearStartAt();
    setSlots([]);
    setLoadingSlots(false);
    setMessage("");
    setMessageKind("info");
    setContact({ name: "", email: "", phone: "", whatsappOptIn: false });
    setDateRailPage(0);
    setStep(0);
    focusHeadingRef.current = true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      step !== 3 ||
      !selectedService ||
      !selectedBarber ||
      !startAt ||
      inFlightRef.current
    )
      return;
    const payload = currentPayload();
    if (!payload) return;

    const existing = attemptRef.current;
    if (existing) {
      if (isPendingAttemptExpired(existing)) {
        expireAttempt();
        setRecoveryNotice("expired");
        setMessage(
          "The recovery copy saved in this tab expired. If the earlier request was saved, it may still exist. Check with the shop before booking again.",
        );
        setMessageKind("error");
        return;
      }
      if (sameBookingPayload(existing.payload, payload)) {
        await sendAttempt(existing.payload, existing.recoveryKey, true);
      } else {
        setRecoveryNotice("changed");
        setMessage(
          "The form details changed after the earlier request. Check the earlier request before starting over.",
        );
        setMessageKind("error");
      }
      return;
    }

    if (recoveryNotice) {
      setMessage(
        "Review the earlier request notice and choose whether to start a separate booking.",
      );
      setMessageKind("error");
      return;
    }

    const attempt: PendingBookingAttempt = {
      recoveryKey: createRecoveryKey(),
      payload,
      savedAt: Date.now(),
    };
    attemptRef.current = attempt;
    setAttemptView(attempt);
    // Write the anonymous warning first: if the payload copy cannot be stored,
    // a reload still shows the warning instead of silently allowing a retry.
    persistWarning("uncertain");
    if (!savePendingAttempt(browserSessionStorage(), attempt))
      setStorageUnavailable(true);
    await sendAttempt(attempt.payload, attempt.recoveryKey);
  }

  const selectedStartLocal = slots.find(
    (slot) => slot.start === startAt,
  )?.localStart;

  const summary = (
    <BookingSummary
      shopName={shopName}
      publicContact={publicContact}
      selectedService={selectedService}
      selectedBarber={selectedBarber}
      date={date}
      selectedStartLocal={selectedStartLocal}
    />
  );

  const recoveryBanner = recoveryNotice ? (
    <BookingRecoveryNotice
      kind={recoveryNotice}
      attempt={attemptView}
      timeZone={timeZone}
      publicContact={publicContact}
      pending={pending}
      onRecover={() => void recoverSavedAttempt()}
      onStartNew={startSeparateBooking}
    />
  ) : null;

  const storageBanner = storageUnavailable ? (
    <p
      className="col-span-full bg-[#f7f7f5] px-4 py-3.5 text-[13px] leading-[1.6] text-[#242424]"
      role="status"
    >
      This browser isn’t keeping a recovery copy in this tab. If the booking
      response is lost, keep this tab open and retry here; recovery after reload
      won’t be available.
    </p>
  ) : null;

  if (receipt)
    return (
      <BookingReceipt
        receipt={receipt}
        publicContact={publicContact}
        onBookAnother={resetFlow}
      />
    );

  if (services.length === 0)
    return (
      <div className={styles.bookingLayout}>
        {recoveryBanner}
        {storageBanner}
        <section className={styles.stepContent}>
          <div className={styles.emptyState}>
            <h3 className={styles.stepHeading}>
              No bookable services right now.
            </h3>
            <p>Please contact the shop at {publicContact} for help.</p>
            <a href="#shop-contact" className={styles.secondaryButton}>
              Contact {shopName}
            </a>
          </div>
        </section>
        <div className={styles.desktopSummary}>{summary}</div>
      </div>
    );

  const firstDate = shopToday(timeZone);
  const dateOptions = Array.from({ length: 31 }, (_, index) =>
    addDays(firstDate, index),
  );

  function changeDate(value: string) {
    if (inFlightRef.current) return;
    setDate(value);
    const index = dateOptions.indexOf(value);
    if (index >= 0) setDateRailPage(Math.floor(index / 7));
    clearStartAt();
    setSlots([]);
    setLoadingSlots(false);
    setSlotLoadError(false);
    setMessage("");
  }

  return (
    <div className={styles.bookingLayout}>
      {recoveryBanner}
      {storageBanner}
      <div className={styles.stepper} aria-label="Booking steps">
        {stepNames.map((name, index) => (
          <button
            key={name}
            type="button"
            className={
              index === step
                ? styles.stepActive
                : index < step
                  ? styles.stepComplete
                  : styles.step
            }
            aria-current={index === step ? "step" : undefined}
            onClick={() => index < step && goTo(index)}
            disabled={pending || index >= step}
          >
            <span
              className={
                index === step
                  ? styles.stepNumberActive
                  : index < step
                    ? styles.stepNumberComplete
                    : styles.stepNumber
              }
            >
              {index < step ? "✓" : `0${index + 1}`}
            </span>
            <span>{name}</span>
          </button>
        ))}
      </div>
      <div className={styles.mobileSummary}>
        <details className={styles.mobileSummaryDetails}>
          <summary>Your chair, on paper</summary>
          <div className={styles.mobileSummaryPanel}>{summary}</div>
        </details>
      </div>
      <form className={styles.stepContent} onSubmit={submit}>
        {step === 0 ? (
          <BookingStepServices
            services={services}
            serviceId={serviceId}
            selectedService={selectedService}
            pending={pending}
            message={message}
            headingRef={headingRef}
            onSelectService={selectService}
            onContinue={() => goTo(1)}
          />
        ) : null}

        {step === 1 ? (
          <BookingStepBarbers
            selectedService={selectedService}
            barberId={barberId}
            selectedBarber={selectedBarber}
            pending={pending}
            headingRef={headingRef}
            onSelectBarber={selectBarber}
            onBack={() => goTo(0)}
            onContinue={() => goTo(2)}
          />
        ) : null}

        {step === 2 ? (
          <BookingStepSlots
            headingRef={headingRef}
            timeZone={timeZone}
            selectedService={selectedService}
            selectedBarber={selectedBarber}
            date={date}
            dateOptions={dateOptions}
            firstDate={firstDate}
            dateRailPage={dateRailPage}
            slots={slots}
            startAt={startAt}
            loadingSlots={loadingSlots}
            slotLoadError={slotLoadError}
            pending={pending}
            onDateRailPageChange={setDateRailPage}
            onDateChange={changeDate}
            onStartAtChange={selectStartAt}
            onRetry={() => setSlotRetry((count) => count + 1)}
            onBack={() => goTo(1)}
            onContinue={() => goTo(3)}
          />
        ) : null}

        {step === 3 ? (
          <BookingStepContact
            headingRef={headingRef}
            selectedService={selectedService}
            startAt={startAt}
            pending={pending}
            message={message}
            messageKind={messageKind}
            selectedStartIsWithinChangeWindow={
              selectedStartIsWithinChangeWindow
            }
            publicContact={publicContact}
            contact={contact}
            onContactChange={updateContact}
            onBackToTime={() => goTo(2)}
          />
        ) : null}
      </form>
      <div className={styles.desktopSummary}>{summary}</div>
    </div>
  );
}
