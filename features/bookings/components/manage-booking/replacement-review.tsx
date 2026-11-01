import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import type {
  CustomerReplacementChoices,
  CustomerReplacementSlotsView,
  ManagedBookingView,
} from "../../types";
import { appointmentTime } from "./appointment-time";

function AppointmentSummary({
  booking,
  title,
}: {
  booking: ManagedBookingView;
  title: string;
}) {
  const { date, range } = appointmentTime(booking);
  return (
    <section className="min-w-0 border-t border-[#242424] py-4">
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

type ReplacementService =
  | CustomerReplacementChoices["services"][number]
  | CustomerReplacementChoices["retainedService"];

type ReplacementBarber = CustomerReplacementChoices["barbers"][number];

export function ReplacementReview({
  booking,
  choices,
  slots,
  selectedService,
  selectedBarber,
  startAt,
  headingRef,
  isWithin12Hours,
  busy,
  error,
  uncertain,
  staleBooking,
  onBackToChoices,
  onClose,
  onReload,
  onRetry,
  onConfirm,
}: {
  booking: ManagedBookingView;
  choices: CustomerReplacementChoices | null;
  slots: CustomerReplacementSlotsView["slots"];
  selectedService: ReplacementService;
  selectedBarber: ReplacementBarber;
  startAt: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  isWithin12Hours: boolean;
  busy: boolean;
  error: string;
  uncertain: boolean;
  staleBooking: boolean;
  onBackToChoices: () => void;
  onClose: () => void;
  onReload: () => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const selectedSlot = slots.find((slot) => slot.start === startAt);
  const isAmbiguous = selectedSlot
    ? slots.filter((slot) => slot.localStart === selectedSlot.localStart)
        .length > 1
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
          <Button disabled={busy} variant="link" onClick={onBackToChoices}>
            Back to choices
          </Button>
        ) : null}
      </div>
      <h2
        className="font-[family-name:var(--font-shop-display)] text-[clamp(36px,5vw,52px)] font-bold uppercase leading-none"
        ref={headingRef}
        tabIndex={-1}
      >
        A quick look before we change it.
      </h2>
      <p className="mt-3 text-sm text-[#72726e]">
        Your original appointment stays reserved until you confirm this change.
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
                ${Number(selectedService.priceUsd).toFixed(2)} · Pay at the shop
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
            <Button disabled={busy} variant="outline" onClick={onReload}>
              Reload booking details
            </Button>
            <Button disabled={busy} onClick={onRetry}>
              Retry change
            </Button>
          </div>
        ) : staleBooking ? (
          <Button onClick={onReload}>Reload booking details</Button>
        ) : (
          <>
            <Button disabled={busy} variant="link" onClick={onClose}>
              Back to your booking
            </Button>
            <Button
              disabled={busy}
              onClick={onConfirm}
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
