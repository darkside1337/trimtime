"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  CustomerReplacementChoices,
  CustomerReplacementReceipt,
  ManagedBookingView,
  ReplaceCustomerBookingInput,
} from "../../types";
import {
  getCustomerReplacementChoicesAction,
  getCustomerReplacementSlotsAction,
  replaceCustomerBookingAction,
} from "../../actions";
import { createRecoveryKey } from "../recovery-key";
import { appointmentTime } from "./appointment-time";

function AppointmentSummary({
  booking,
  title,
  className,
}: {
  booking: ManagedBookingView;
  title: string;
  className?: string;
}) {
  const { date, range } = appointmentTime(booking);
  return (
    <section
      className={cn("min-w-0 border-t border-[#242424] py-4", className)}
    >
      <h2 className="font-[family-name:var(--font-shop-display)] text-[30px] font-bold leading-tight">
        {title}
      </h2>
      <dl className="mt-4 grid gap-4 text-sm">
        <div>
          <dt className="text-xs text-[#72726e]">Service</dt>
          <dd>
            {booking.service.name} · {booking.service.durationMinutes} minutes
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#72726e]">Barber</dt>
          <dd>{booking.barber.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#72726e]">Date and time</dt>
          <dd>
            {date}, {range}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#72726e]">Total · USD</dt>
          <dd>
            ${Number(booking.service.priceUsd).toFixed(2)} · Pay at the shop
          </dd>
        </div>
      </dl>
    </section>
  );
}

function formatSlotTime(
  startAt: string,
  durationMinutes: number,
  timeZone: string,
) {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const dateFmt = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  });
  const timeFmt = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return {
    date: dateFmt.format(start),
    range: `${timeFmt.format(start)} – ${timeFmt.format(end)}`,
    localTime: timeFmt.format(start),
  };
}

import {
  checkCutoffWithin12Hours,
  type AuthoritativeServerClock,
} from "./cutoff-warning";
export { checkCutoffWithin12Hours, type AuthoritativeServerClock };

export function BookingPreview({
  booking,
  token,
  onClose,
  headingRef,
  onReplaced,
}: {
  booking: ManagedBookingView;
  token: string;
  onClose: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onReplaced?: (receipt: CustomerReplacementReceipt) => void;
}) {
  const original = appointmentTime(booking);

  const [choices, setChoices] = useState<CustomerReplacementChoices | null>(
    null,
  );
  const [loadingChoices, setLoadingChoices] = useState(true);
  const [choicesError, setChoicesError] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [date, setDate] = useState(original.dateTime);
  const [startAt, setStartAt] = useState("");

  const [slots, setSlots] = useState<
    Array<{ start: string; end: string; localStart: string; offset: string }>
  >([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [screen, setScreen] = useState<"edit" | "review">("edit");
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [staleBooking, setStaleBooking] = useState(false);
  const [reloadChoicesCount, setReloadChoicesCount] = useState(0);
  const [, setReviewTick] = useState(0);

  const operationKey = useRef(createRecoveryKey());
  const submittedPayload = useRef<ReplaceCustomerBookingInput | null>(null);
  const slotRequestId = useRef(0);

  const [serverClock, setServerClock] =
    useState<AuthoritativeServerClock | null>(null);

  function updateAuthoritativeTime(
    serverNowIso?: string,
    networkDelayMs: number = 0,
  ) {
    if (!serverNowIso) return;
    const serverTimeMs = new Date(serverNowIso).getTime();
    if (!Number.isNaN(serverTimeMs)) {
      setServerClock({
        serverTimeMs,
        recordedAtMonotonicMs: performance.now(),
        networkDelayMs,
      });
    }
  }

  function handleStartSelection(slotIso: string) {
    setStartAt(slotIso);
  }

  function handleProceedToReview() {
    setScreen("review");
  }

  useEffect(() => {
    if (screen !== "review" || !startAt) return;
    const timer = setInterval(() => {
      setReviewTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, startAt]);

  const isWithin12Hours = startAt
    ? checkCutoffWithin12Hours(startAt, serverClock)
    : false;

  useEffect(() => {
    let active = true;
    const reqStartMonotonic = performance.now();
    getCustomerReplacementChoicesAction(token)
      .then((res) => {
        if (!active) return;
        setLoadingChoices(false);
        if (res.success) {
          const reqEndMonotonic = performance.now();
          const roundTripMs = Math.max(0, reqEndMonotonic - reqStartMonotonic);
          setChoices(res.data);
          updateAuthoritativeTime(res.data.serverNow, roundTripMs);
          setLoadingSlots(true);
          setServiceId((prev) => {
            const currentSvc =
              res.data.services.find((s) => s.id === prev) ??
              res.data.retainedService;
            return currentSvc.id;
          });
          setBarberId((prev) => {
            const currentBarber =
              res.data.barbers.find((b) => b.id === prev) ??
              res.data.barbers.find((b) => b.name === booking.barber.name) ??
              res.data.barbers[0];
            return currentBarber ? currentBarber.id : "";
          });
        } else {
          setChoicesError(res.error.message);
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadingChoices(false);
        setChoicesError("Could not load booking choices. Please try again.");
      });
    return () => {
      active = false;
    };
  }, [token, reloadChoicesCount, booking.barber.name]);

  useEffect(() => {
    if (!loadingChoices) {
      (screen === "review" ? reviewHeadingRef : headingRef).current?.focus();
    }
  }, [screen, headingRef, loadingChoices]);

  // Fetch slots whenever choices, service, barber, or date changes
  useEffect(() => {
    const reqId = ++slotRequestId.current;
    if (!choices || !serviceId || !barberId || !date) {
      return;
    }
    const reqStartMonotonic = performance.now();

    getCustomerReplacementSlotsAction({
      token,
      expectedRevision: choices.revision,
      serviceId,
      barberId,
      date,
    })
      .then((res) => {
        if (slotRequestId.current !== reqId) return;
        setLoadingSlots(false);
        if (res.success) {
          const reqEndMonotonic = performance.now();
          const roundTripMs = Math.max(0, reqEndMonotonic - reqStartMonotonic);
          setSlots(res.data.slots);
          updateAuthoritativeTime(res.data.serverNow, roundTripMs);
        } else {
          setSlots([]);
          setSlotsError(res.error.message);
        }
      })
      .catch(() => {
        if (slotRequestId.current !== reqId) return;
        setLoadingSlots(false);
        setSlots([]);
        setSlotsError("Could not load times. Please try again.");
      });
  }, [token, choices, serviceId, barberId, date]);

  const selectedService = choices?.services.find((s) => s.id === serviceId) ??
    choices?.retainedService ?? {
      id: serviceId,
      name: booking.service.name,
      priceUsd: booking.service.priceUsd,
      durationMinutes: booking.service.durationMinutes,
    };

  const selectedBarber = choices?.barbers.find((b) => b.id === barberId) ?? {
    id: barberId,
    name: booking.barber.name,
  };

  const availableBarbers =
    choices?.barbers.filter((b) => {
      const svc = choices.services.find((s) => s.id === serviceId);
      return svc ? svc.barberIds.includes(b.id) : true;
    }) ?? [];

  async function handleConfirm(retryPayload?: ReplaceCustomerBookingInput) {
    if (busy || !choices) return;
    const payload: ReplaceCustomerBookingInput = retryPayload ?? {
      token,
      expectedRevision: choices.revision,
      operationKey: operationKey.current,
      confirmed: true,
      serviceId,
      barberId,
      startAt,
      reviewedOffer: {
        name: selectedService.name,
        priceUsd: Number(selectedService.priceUsd).toFixed(2),
        durationMinutes: String(selectedService.durationMinutes),
      },
    };
    if (!retryPayload) submittedPayload.current = payload;
    setBusy(true);
    setError("");
    setUncertain(false);
    setStaleBooking(false);

    try {
      const result = await replaceCustomerBookingAction(payload);
      if (!result.success) {
        setUncertain(false);
        if (
          result.error.code === "STALE_BOOKING" ||
          result.error.code === "RECOVERY_MISMATCH"
        ) {
          setStaleBooking(true);
          setError(result.error.message);
        } else if (result.error.code === "STALE_OFFER") {
          setError("Service details have changed. Please review again.");
          setReloadChoicesCount((c) => c + 1);
          setScreen("edit");
        } else if (result.error.code === "UNAVAILABLE_INTERVAL") {
          setError(
            "The selected time is no longer available. Please choose another time.",
          );
          setStartAt("");
          setScreen("edit");
          // Trigger slot refresh
          setChoices({ ...choices });
        } else {
          setError(result.error.message);
        }
        return;
      }
      onReplaced?.(result.data);
    } catch {
      setUncertain(true);
      setError(
        "The change result is unknown. Retry or reload your booking details.",
      );
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    if (submittedPayload.current) void handleConfirm(submittedPayload.current);
  }

  function reload() {
    window.location.reload();
  }

  if (loadingChoices) {
    return (
      <section className="border-t-[3px] border-[#242424] pt-7">
        <p className="text-sm text-[#72726e]">Loading available options…</p>
      </section>
    );
  }

  if (choicesError) {
    return (
      <section className="border-t-[3px] border-[#242424] pt-7">
        <div className="border border-[#9f2d20] bg-[#fdf2f2] p-4 text-sm text-[#9f2d20]">
          {choicesError}
        </div>
        <div className="mt-4">
          <Button variant="outline" onClick={onClose}>
            Back to your booking
          </Button>
        </div>
      </section>
    );
  }

  if (screen === "review") {
    const selectedSlot = slots.find((s) => s.start === startAt);
    const isAmbiguous = selectedSlot
      ? slots.filter((s) => s.localStart === selectedSlot.localStart).length > 1
      : false;

    const slotDetails = startAt
      ? formatSlotTime(
          startAt,
          selectedService.durationMinutes,
          choices?.timeZone ?? booking.shop.timeZone,
        )
      : null;

    return (
      <section className="border-t-[3px] border-[#242424] pt-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {!uncertain ? (
            <Button
              disabled={busy}
              variant="link"
              onClick={() => setScreen("edit")}
            >
              Back to choices
            </Button>
          ) : null}
        </div>
        <h2
          className="font-[family-name:var(--font-shop-display)] text-[clamp(36px,5vw,52px)] font-bold uppercase leading-none"
          ref={reviewHeadingRef}
          tabIndex={-1}
        >
          A quick look before we change it.
        </h2>
        <p className="mt-3 text-sm text-[#72726e]">
          Your original appointment stays reserved until you confirm this
          change.
        </p>

        {isWithin12Hours ? (
          <div
            role="note"
            className="mt-5 border border-[#d97706] bg-[#fffbeb] p-4 text-xs font-medium text-[#92400e]"
          >
            This appointment will be within 12 hours. Further online changes or
            cancellation will be unavailable; contact the shop.
          </div>
        ) : null}

        <div className="mt-7 grid gap-6 md:grid-cols-2">
          <AppointmentSummary booking={booking} title="Currently booked" />
          <section className="border-t border-[#242424] bg-[#f7f7f5] p-5">
            <h3 className="font-[family-name:var(--font-shop-display)] text-[30px] font-bold leading-tight">
              Your new appointment
            </h3>
            <dl className="mt-4 grid gap-4 text-sm">
              <div>
                <dt className="text-xs text-[#72726e]">Service</dt>
                <dd>
                  {selectedService.name} · {selectedService.durationMinutes}{" "}
                  minutes
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#72726e]">Barber</dt>
                <dd>{selectedBarber.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#72726e]">Date and time</dt>
                <dd>
                  {slotDetails?.date} · {slotDetails?.range}
                  {isAmbiguous && selectedSlot
                    ? ` · UTC${selectedSlot.offset}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#72726e]">Total · USD</dt>
                <dd>
                  ${Number(selectedService.priceUsd).toFixed(2)} · Pay at the
                  shop
                </dd>
              </div>
            </dl>
          </section>
        </div>
        <p className="mt-5 text-sm text-[#72726e]">
          {choices?.timeZone ?? booking.shop.timeZone}. Your contact details and
          private booking link stay the same.
        </p>

        {busy ? (
          <p
            aria-live="polite"
            className="mt-4 text-xs text-[#72726e]"
            role="status"
          >
            Updating appointment…
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-[#9f2d20]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          {uncertain ? (
            <div className="flex gap-3">
              <Button disabled={busy} variant="outline" onClick={reload}>
                Reload booking details
              </Button>
              <Button disabled={busy} onClick={retry}>
                Retry change
              </Button>
            </div>
          ) : staleBooking ? (
            <Button onClick={reload}>Reload booking details</Button>
          ) : (
            <>
              <Button disabled={busy} variant="link" onClick={onClose}>
                Back to your booking
              </Button>
              <Button
                disabled={busy}
                onClick={() => void handleConfirm()}
                className="bg-[#21734f] text-white hover:bg-[#1a5c3f]"
              >
                Confirm appointment change
              </Button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="border-t-[3px] border-[#242424] pt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Button variant="link" onClick={onClose}>
          Back to your booking
        </Button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="font-[family-name:var(--font-shop-display)] text-[clamp(36px,5vw,52px)] font-bold uppercase leading-none"
            ref={headingRef}
            tabIndex={-1}
          >
            A fresh time. Your call.
          </h2>
          <p className="mt-3 text-sm text-[#72726e]">
            Your original chair stays reserved until you review and confirm a
            change.
          </p>
        </div>
        <Button variant="link" onClick={onClose}>
          Keep original
        </Button>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-[#9f2d20]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid min-w-0 gap-7">
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">
              1. Choose your service
            </legend>
            {choices?.services.map((svc) => (
              <label
                className={cn(
                  "flex min-h-[72px] cursor-pointer items-center gap-4 border border-[#e6e6e2] px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                  serviceId === svc.id && "border-[#21734f] bg-[#f7f7f5]",
                )}
                key={svc.id}
              >
                <input
                  checked={serviceId === svc.id}
                  name="replacement-service"
                  onChange={() => {
                    slotRequestId.current += 1;
                    const nextBarberId = svc.barberIds.includes(barberId)
                      ? barberId
                      : (svc.barberIds[0] ?? "");
                    setServiceId(svc.id);
                    setBarberId(nextBarberId);
                    setStartAt("");
                    setSlots([]);
                    setSlotsError(null);
                    setLoadingSlots(Boolean(date && nextBarberId));
                  }}
                  type="radio"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{svc.name}</span>
                  <span className="text-xs text-[#72726e]">
                    {svc.durationMinutes} minutes
                    {svc.id === choices.retainedService.id
                      ? " · Your current service"
                      : ""}
                  </span>
                </span>
                <span className="text-right text-sm text-[#72726e]">
                  ${Number(svc.priceUsd).toFixed(2)}
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">
              2. Choose your barber
            </legend>
            {availableBarbers.length === 0 ? (
              <p className="text-xs text-[#72726e]">
                No barbers available for this service.
              </p>
            ) : (
              availableBarbers.map((b) => (
                <label
                  className={cn(
                    "flex min-h-[64px] cursor-pointer items-center gap-4 border border-[#e6e6e2] px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                    barberId === b.id && "border-[#21734f] bg-[#f7f7f5]",
                  )}
                  key={b.id}
                >
                  <input
                    checked={barberId === b.id}
                    name="replacement-barber"
                    onChange={() => {
                      slotRequestId.current += 1;
                      setBarberId(b.id);
                      setStartAt("");
                      setSlots([]);
                      setSlotsError(null);
                      setLoadingSlots(Boolean(date && serviceId));
                    }}
                    type="radio"
                  />
                  <span>{b.name}</span>
                </label>
              ))
            )}
          </fieldset>

          <label
            className="grid max-w-lg gap-2 text-sm font-semibold"
            htmlFor="replacement-date"
          >
            Choose a date
            <input
              className="min-h-11 rounded-[2px] border border-[#e6e6e2] px-3 font-normal"
              id="replacement-date"
              onChange={(event) => {
                const newDate = event.target.value;
                slotRequestId.current += 1;
                setDate(newDate);
                setStartAt("");
                setSlots([]);
                setSlotsError(null);
                setLoadingSlots(Boolean(newDate && serviceId && barberId));
              }}
              type="date"
              value={date}
            />
          </label>

          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">
              4. Choose a start time
            </legend>
            {loadingSlots ? (
              <p className="text-xs text-[#72726e]">Loading times…</p>
            ) : slotsError ? (
              <p className="text-xs text-[#9f2d20]">{slotsError}</p>
            ) : !date ? (
              <p className="text-xs text-[#72726e]">
                Choose a date to view available times.
              </p>
            ) : !barberId || availableBarbers.length === 0 ? (
              <p className="text-xs text-[#72726e]">
                No barbers available for this service.
              </p>
            ) : slots.length === 0 ? (
              <p className="text-xs text-[#72726e]">
                No available times on this date.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => {
                  const isAmbiguous =
                    slots.filter((s) => s.localStart === slot.localStart)
                      .length > 1;
                  const label = isAmbiguous
                    ? `${slot.localStart} · UTC${slot.offset}`
                    : slot.localStart;

                  return (
                    <label
                      className={cn(
                        "grid min-h-11 cursor-pointer place-items-center border border-[#e6e6e2] px-2 text-center text-xs",
                        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                        startAt === slot.start &&
                          "border-[#21734f] bg-[#21734f] text-white",
                      )}
                      key={slot.start}
                    >
                      <input
                        checked={startAt === slot.start}
                        className="sr-only"
                        name="replacement-start"
                        onChange={() => {
                          handleStartSelection(slot.start);
                        }}
                        type="radio"
                        value={slot.start}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <Button
            disabled={
              !date ||
              !barberId ||
              !startAt ||
              loadingSlots ||
              !slots.some((s) => s.start === startAt)
            }
            onClick={handleProceedToReview}
          >
            Review change
          </Button>
        </div>

        <aside className="h-fit bg-[#f7f7f5] p-5">
          <p className="text-xs font-semibold">
            Your original chair · still reserved
          </p>
          <p className="mt-5">{booking.service.name}</p>
          <p>{booking.barber.name}</p>
          <p className="mt-3">{original.date}</p>
          <p>{original.range}</p>
          <p className="mt-4 text-xs text-[#72726e]">
            Your original appointment remains intact unless you explicitly
            confirm a change.
          </p>
        </aside>
      </div>
    </section>
  );
}
