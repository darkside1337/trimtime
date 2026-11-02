"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import type {
  CustomerReplacementChoices,
  CustomerReplacementReceipt,
  ManagedBookingView,
  ReplaceCustomerBookingInput,
} from "../../types";
import {
  getCustomerReplacementChoicesAction,
  replaceCustomerBookingAction,
} from "../../actions";
import { createRecoveryKey } from "../recovery-key";
import { appointmentTime } from "./appointment-time";

import {
  checkCutoffWithin12Hours,
  type AuthoritativeServerClock,
} from "./cutoff-warning";
import { ReplacementReview } from "./replacement-review";
import { ReplacementStepBarbers } from "./replacement-step-barbers";
import { ReplacementStepServices } from "./replacement-step-services";
import { ReplacementStepSlots } from "./replacement-step-slots";
import { useReplacementSlots } from "./use-replacement-slots";
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

  const [serverClock, setServerClock] =
    useState<AuthoritativeServerClock | null>(null);
  const updateAuthoritativeTime = useCallback(
    (serverNowIso?: string, networkDelayMs: number = 0) => {
      if (!serverNowIso) return;
      const serverTimeMs = new Date(serverNowIso).getTime();
      if (Number.isNaN(serverTimeMs)) return;

      setServerClock({
        serverTimeMs,
        recordedAtMonotonicMs: performance.now(),
        networkDelayMs,
      });
    },
    [],
  );

  const {
    slots,
    loading: loadingSlots,
    error: slotsError,
    invalidate: invalidateSlots,
    refresh: refreshSlots,
  } = useReplacementSlots({
    token,
    choices,
    serviceId,
    barberId,
    date,
    onServerNow: updateAuthoritativeTime,
  });

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
  }, [token, reloadChoicesCount, booking.barber.name, updateAuthoritativeTime]);

  useEffect(() => {
    if (!loadingChoices) {
      (screen === "review" ? reviewHeadingRef : headingRef).current?.focus();
    }
  }, [screen, headingRef, loadingChoices]);

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
          invalidateSlots(Boolean(date && serviceId && barberId));
          setReloadChoicesCount((c) => c + 1);
          setScreen("edit");
        } else if (result.error.code === "UNAVAILABLE_INTERVAL") {
          setError(
            "The selected time is no longer available. Please choose another time.",
          );
          setStartAt("");
          setScreen("edit");
          refreshSlots();
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
    return (
      <ReplacementReview
        booking={booking}
        choices={choices}
        slots={slots}
        selectedService={selectedService}
        selectedBarber={selectedBarber}
        startAt={startAt}
        headingRef={reviewHeadingRef}
        isWithin12Hours={isWithin12Hours}
        busy={busy}
        error={error}
        uncertain={uncertain}
        staleBooking={staleBooking}
        onBackToChoices={() => setScreen("edit")}
        onClose={onClose}
        onReload={reload}
        onRetry={retry}
        onConfirm={() => void handleConfirm()}
      />
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
          {choices ? (
            <ReplacementStepServices
              choices={choices}
              serviceId={serviceId}
              onServiceChange={(nextServiceId) => {
                invalidateSlots(Boolean(date));
                const nextService = choices.services.find(
                  (service) => service.id === nextServiceId,
                );
                const nextBarberId = nextService?.barberIds.includes(barberId)
                  ? barberId
                  : (nextService?.barberIds[0] ?? "");
                setServiceId(nextServiceId);
                setBarberId(nextBarberId);
                setStartAt("");
              }}
            />
          ) : null}

          <ReplacementStepBarbers
            barbers={availableBarbers}
            barberId={barberId}
            onBarberChange={(nextBarberId) => {
              invalidateSlots(Boolean(date && serviceId));
              setBarberId(nextBarberId);
              setStartAt("");
            }}
          />

          <ReplacementStepSlots
            date={date}
            slots={slots}
            loading={loadingSlots}
            error={slotsError}
            barberId={barberId}
            hasAvailableBarbers={availableBarbers.length > 0}
            startAt={startAt}
            onDateChange={(nextDate) => {
              invalidateSlots(Boolean(nextDate && serviceId && barberId));
              setDate(nextDate);
              setStartAt("");
            }}
            onStartAtChange={setStartAt}
          />

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
