"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPublicBookingAction, getBookingSlotsAction } from "../actions";
import type { PublicBookingReceipt } from "../types";
import { customerEmailStatusCopy } from "@/features/notifications/customer-summary";
import { bookingStyles as styles } from "./shop-styles";

type Service = {
  id: string;
  name: string;
  priceUsd: string;
  durationMinutes: string;
  barbers: { id: string; name: string }[];
};

type Slot = { start: string; localStart: string; offset: string };

const stepNames = ["Service", "Barber", "Date & time", "Your details"];

function recoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function money(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function formatDate(date: string) {
  if (!date) return "Choose your date";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function shopToday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function Receipt({
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
          <dd>{receipt.booking.customer.email}</dd>
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
        <a href={receipt.manageUrl} className={styles.primaryLink}>
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

export function BookingFlow({
  services,
  shopName,
  publicContact,
  timeZone,
}: {
  services: Service[];
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
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [contact, setContact] = useState({
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

  const summary = (
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
          <dd>
            {slots.find((slot) => slot.start === startAt)?.localStart ??
              "Choose your time"}
          </dd>
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

  if (receipt)
    return (
      <Receipt
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

  const groups = [
    { label: "Morning", filter: (hour: number) => hour < 12 },
    { label: "Afternoon", filter: (hour: number) => hour >= 12 && hour < 17 },
    { label: "Evening", filter: (hour: number) => hour >= 17 },
  ];

  const firstDate = shopToday(timeZone);
  const dateOptions = Array.from({ length: 31 }, (_, index) =>
    addDays(firstDate, index),
  );
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
              <legend className={styles.visuallyHidden}>
                Choose a service
              </legend>
              {services.map((service) => (
                <label
                  key={service.id}
                  className={
                    serviceId === service.id
                      ? styles.choiceSelected
                      : styles.choice
                  }
                >
                  <input
                    className={styles.radio}
                    aria-label={`${service.name}, ${money(service.priceUsd)}, ${service.durationMinutes} minutes`}
                    type="radio"
                    name="serviceId"
                    value={service.id}
                    checked={serviceId === service.id}
                    onChange={() => {
                      if (serviceId !== service.id) {
                        setBarberId("");
                        setDate("");
                        clearStartAt();
                        setSlots([]);
                        setLoadingSlots(false);
                        setSlotLoadError(false);
                      }
                      setServiceId(service.id);
                    }}
                  />
                  <span className={styles.choiceText}>
                    <strong className={styles.choiceTitle}>
                      {service.name}
                    </strong>
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
              <span className={styles.stepHint}>
                One service. All the attention.
              </span>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!selectedService}
                onClick={() => goTo(1)}
              >
                Choose your barber <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
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
              {selectedService?.name}. Choose a barber available for this
              service.
            </p>
            <fieldset className={styles.choiceList} disabled={pending}>
              <legend className={styles.visuallyHidden}>Choose a barber</legend>
              {selectedService?.barbers.map((barber) => (
                <label
                  key={barber.id}
                  className={
                    barberId === barber.id
                      ? styles.choiceSelected
                      : styles.choice
                  }
                >
                  <input
                    className={styles.radio}
                    type="radio"
                    name="barberId"
                    value={barber.id}
                    aria-label={barber.name}
                    checked={barberId === barber.id}
                    onChange={() => {
                      setBarberId(barber.id);
                      setDate("");
                      clearStartAt();
                      setSlots([]);
                      setLoadingSlots(false);
                      setSlotLoadError(false);
                    }}
                  />
                  <span className={styles.barberAvatar} aria-hidden="true">
                    {barber.name.trim().charAt(0)}
                  </span>
                  <span className={styles.choiceText}>
                    <strong className={styles.choiceTitle}>
                      {barber.name}
                    </strong>
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
                onClick={() => goTo(0)}
              >
                Back to services
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!selectedBarber}
                onClick={() => goTo(2)}
              >
                Choose date and time <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
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
                    setDateRailPage((page) => Math.max(0, page - 1))
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
                    setDateRailPage((page) => Math.min(pageCount - 1, page + 1))
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
                    onClick={() => {
                      setDate(option);
                      clearStartAt();
                      setSlots([]);
                      setLoadingSlots(false);
                      setSlotLoadError(false);
                      setMessage("");
                    }}
                  >
                    <span
                      className={isSelected ? "text-white" : styles.dateWeekday}
                    >
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
                onChange={(event) => {
                  const value = event.target.value;
                  setDate(value);
                  const index = dateOptions.indexOf(value);
                  if (index >= 0) setDateRailPage(Math.floor(index / 7));
                  clearStartAt();
                  setSlots([]);
                  setLoadingSlots(false);
                  setSlotLoadError(false);
                  setMessage("");
                }}
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
                  onClick={() => setSlotRetry((count) => count + 1)}
                >
                  Retry availability
                </button>
              </div>
            ) : null}
            {date && !loadingSlots && !slotLoadError && slots.length === 0 ? (
              <div className={styles.emptyState}>
                <h4>No chairs at this time.</h4>
                <p>
                  No times are currently available for this barber and date.
                  Choose another date or barber.
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
                              onChange={() => {
                                setStartAt(slot.start);
                                setSelectedStartIsWithinChangeWindow(
                                  new Date(slot.start).getTime() - Date.now() <
                                    12 * 60 * 60 * 1000,
                                );
                              }}
                            />
                            {new Intl.DateTimeFormat("en-US", {
                              timeZone: "UTC",
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(
                              new Date(`1970-01-01T${slot.localStart}:00Z`),
                            )}
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
                onClick={() => goTo(1)}
              >
                Back to barbers
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!startAt}
                onClick={() => goTo(3)}
              >
                Your details <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
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
                This start is within twelve hours. Online changes won’t be
                available; contact {publicContact} if plans change.
              </p>
            ) : null}
            {message ? (
              <p
                className={
                  messageKind === "error"
                    ? styles.errorMessage
                    : styles.inlineStatus
                }
                role={messageKind === "error" ? "alert" : "status"}
              >
                {message}
                {message.includes("Choose another available time") ? (
                  <button
                    type="button"
                    className={styles.inlineAction}
                    onClick={() => goTo(2)}
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
                    setContact({ ...contact, name: event.target.value })
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
                    setContact({ ...contact, email: event.target.value })
                  }
                />
                <small>
                  Email is required to create the booking. A confirmation may be
                  captured locally when configured; inbox delivery is not
                  enabled.
                </small>
              </label>
              <label className={styles.field}>
                <span>
                  {contact.whatsappOptIn
                    ? "WhatsApp phone number"
                    : "Phone number"}{" "}
                  <small>
                    (
                    {contact.whatsappOptIn
                      ? "required for updates"
                      : "optional"}
                    )
                  </small>
                </span>
                <input
                  aria-label={
                    contact.whatsappOptIn
                      ? "WhatsApp phone number"
                      : "Phone number"
                  }
                  required={contact.whatsappOptIn}
                  type="tel"
                  autoComplete="tel"
                  disabled={pending}
                  value={contact.phone}
                  onChange={(event) =>
                    setContact({ ...contact, phone: event.target.value })
                  }
                />
              </label>
              <label className={styles.consentField}>
                <input
                  type="checkbox"
                  disabled={pending}
                  checked={contact.whatsappOptIn}
                  onChange={(event) =>
                    setContact({
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
              Your appointment is confirmed immediately when the request
              succeeds. A private booking link appears on the next screen.
            </p>
            <div className={styles.stepActions}>
              <button
                type="button"
                className={styles.textButton}
                disabled={pending}
                onClick={() => goTo(2)}
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
        ) : null}
      </form>
      <div className={styles.desktopSummary}>{summary}</div>
    </div>
  );
}
