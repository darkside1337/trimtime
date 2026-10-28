"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPublicBookingAction, getBookingSlotsAction } from "../actions";
import type { PublicBookingReceipt } from "../types";
import { bookingStyles as styles } from "./shop-styles";
import { BookingReceipt } from "./booking-flow/booking-receipt";
import { BookingSummary } from "./booking-flow/booking-summary";
import { BookingStepServices } from "./booking-flow/booking-step-services";
import { BookingStepBarbers } from "./booking-flow/booking-step-barbers";
import { BookingStepSlots } from "./booking-flow/booking-step-slots";
import { BookingStepContact } from "./booking-flow/booking-step-contact";
import { addDays, shopToday } from "./booking-flow/format";
import type {
  BookingContact,
  BookingService,
  BookingSlot,
} from "./booking-flow/types";

const stepNames = ["Service", "Barber", "Date & time", "Your details"];

function recoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

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
  const [recovery, setRecovery] = useState("");
  const focusHeadingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusHeadingRef.current) return;
    headingRef.current?.focus();
    focusHeadingRef.current = false;
  }, [step]);

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
    setStep(nextStep);
    focusHeadingRef.current = true;
    setMessage("");
  }

  function clearStartAt() {
    setStartAt("");
    setSelectedStartIsWithinChangeWindow(false);
  }

  function selectService(service: BookingService) {
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
    setBarberId(nextBarberId);
    setDate("");
    clearStartAt();
    setSlots([]);
    setLoadingSlots(false);
    setSlotLoadError(false);
  }

  function selectStartAt(slot: BookingSlot) {
    setStartAt(slot.start);
    setSelectedStartIsWithinChangeWindow(
      new Date(slot.start).getTime() - Date.now() < 12 * 60 * 60 * 1000,
    );
  }

  function resetFlow() {
    sessionStorage.removeItem("trimtime:pending-booking-recovery");
    setReceipt(null);
    setServiceId("");
    setBarberId("");
    setDate("");
    clearStartAt();
    setSlots([]);
    setLoadingSlots(false);
    setRecovery("");
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
      pending
    )
      return;
    setPending(true);
    setMessage("Confirming your booking…");
    setMessageKind("info");
    try {
      const recoveryKeyValue =
        recovery ||
        sessionStorage.getItem("trimtime:pending-booking-recovery") ||
        recoveryKey();
      setRecovery(recoveryKeyValue);
      sessionStorage.setItem(
        "trimtime:pending-booking-recovery",
        recoveryKeyValue,
      );
      const result = await createPublicBookingAction({
        serviceId,
        barberId,
        startAt,
        reviewedOffer: {
          name: selectedService.name,
          priceUsd: Number(selectedService.priceUsd).toFixed(2),
          durationMinutes: String(selectedService.durationMinutes),
        },
        contact: { ...contact, phone: contact.phone || undefined },
        recoveryKey: recoveryKeyValue,
      });
      if (result.success) {
        sessionStorage.removeItem("trimtime:pending-booking-recovery");
        setReceipt(result.data);
      } else if (result.error.code === "STALE_OFFER") {
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
      } else if (result.error.code === "UNAVAILABLE_INTERVAL") {
        setSlots((current) => current.filter((slot) => slot.start !== startAt));
        clearStartAt();
        setMessage(
          "That time was just taken. No booking was created; your details are still here. Choose another available time.",
        );
        setMessageKind("error");
      } else if (result.error.code === "RATE_LIMITED") {
        setMessage(result.error.message);
        setMessageKind("error");
      } else {
        setMessage(result.error.message);
        setMessageKind("error");
      }
    } catch {
      setMessage(
        "The request could not be confirmed. Your details are still here; retry to check the same request.",
      );
      setMessageKind("error");
    } finally {
      setPending(false);
    }
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
            onContactChange={setContact}
            onBackToTime={() => goTo(2)}
          />
        ) : null}
      </form>
      <div className={styles.desktopSummary}>{summary}</div>
    </div>
  );
}
