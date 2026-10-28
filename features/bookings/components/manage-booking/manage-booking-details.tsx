"use client";

import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { customerEmailStatusCopy } from "@/features/notifications/customer-summary";
import type { ManagedBookingView } from "../../types";
import { appointmentTime } from "./appointment-time";

export function ManageBookingDetails({
  booking,
  past,
  headingRef,
  refreshingStatus,
  refreshRequested,
  onPreviewCancellation,
  onChangePreview,
  refreshMessageStatus,
}: {
  booking: ManagedBookingView;
  past: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  refreshingStatus: boolean;
  refreshRequested: boolean;
  onPreviewCancellation: () => void;
  onChangePreview: () => void;
  refreshMessageStatus: () => void;
}) {
  const { date, range } = appointmentTime(booking);
  const cancelled = booking.status === "cancelled";
  const viewOnly = cancelled || past;
  const heading = cancelled
    ? "Cancelled"
    : past
      ? "Past, unmarked"
      : "Confirmed";
  return (
    <>
      <div className="flex min-h-[70px] items-center justify-between gap-4 border-b border-[#e6e6e2] text-xs">
        <p className="font-semibold" role="status">
          <span aria-hidden="true" className="mr-3 text-[#21734f]">
            {viewOnly ? "○" : "✓"}
          </span>
          {heading}
        </p>
        <span className="text-[#72726e]">Your appointment</span>
      </div>
      <div className="border-b border-[#e6e6e2] py-8">
        <h2
          className="font-[family-name:var(--font-shop-display)] text-[clamp(38px,5vw,52px)] font-bold leading-none tracking-[-0.02em] max-[767px]:text-[36px] focus:outline-none"
          ref={headingRef}
          tabIndex={-1}
        >
          {date}
        </h2>
        <p className="mt-4 text-2xl">{range}</p>
        <p className="mt-1 text-xs text-[#72726e]">{booking.shop.timeZone}</p>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 max-[767px]:grid max-[767px]:grid-cols-2">
          {!viewOnly && !booking.changeCutoffPassed ? (
            <Button
              className="max-[767px]:whitespace-normal"
              variant="link"
              onClick={onPreviewCancellation}
            >
              Preview cancellation
            </Button>
          ) : null}
          <Button
            className="max-[767px]:order-3 max-[767px]:col-span-2 max-[767px]:justify-self-start"
            disabled
            variant="link"
          >
            Add to calendar · Unavailable
          </Button>
          {!viewOnly && !booking.changeCutoffPassed ? (
            <Button
              className="max-[767px]:order-2 max-[767px]:whitespace-normal"
              onClick={onChangePreview}
            >
              Open change preview
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-[#72726e]">
          {cancelled
            ? "This appointment was cancelled."
            : past
              ? "This appointment is past and unmarked."
              : booking.changeCutoffPassed
                ? `Online changes are not available within 12 hours of your start. Contact ${booking.shop.publicContact}.`
                : "Online changes are not available yet. Contact the shop if your plans change."}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-7 border-b border-[#e6e6e2] py-7 max-[767px]:gap-x-4">
        <div className="grid gap-1">
          <dt className="text-xs text-[#72726e]">Service</dt>
          <dd className="font-[family-name:var(--font-shop-display)] text-[32px] leading-tight">
            {booking.service.name}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-[#72726e]">Your barber</dt>
          <dd className="font-[family-name:var(--font-shop-display)] text-[32px] leading-tight">
            {booking.barber.name}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-[#72726e]">Reserved for</dt>
          <dd>{booking.customer.name}</dd>
          <dd className="wrap-anywhere text-xs">
            {booking.customer.email ?? "No email provided"}
          </dd>
          {booking.customer.phone ? (
            <dd className="text-xs">{booking.customer.phone}</dd>
          ) : null}
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-[#72726e]">Duration</dt>
          <dd>{booking.service.durationMinutes} minutes</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-[#72726e]">Total · USD</dt>
          <dd className="font-[family-name:var(--font-shop-display)] text-[32px] leading-tight">
            ${Number(booking.service.priceUsd).toFixed(2)}
          </dd>
          <dd className="text-xs text-[#72726e]">Pay at the shop</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-[#72726e]">Where</dt>
          <dd>{booking.shop.name}</dd>
          <dd className="text-xs text-[#72726e]">{booking.shop.address}</dd>
        </div>
      </dl>

      <div className="mt-6 bg-[#f7f7f5] p-6 text-[13px] leading-relaxed">
        <p className="font-semibold">
          {cancelled
            ? "Your appointment is cancelled."
            : past
              ? "This appointment is past and unmarked."
              : booking.changeCutoffPassed
                ? "Online changes are closed."
                : "Room for a change of plans."}
        </p>
        <p className="mt-2">
          {viewOnly
            ? "Keep these details for your records. Contact the shop if you need help."
            : booking.changeCutoffPassed
              ? "Your appointment starts within 12 hours. Contact the shop if your plans change."
              : "Customer changes are not available yet. Contact the shop if your plans change."}
        </p>
        <p className="mt-2 text-[#72726e]" role="status">
          {customerEmailStatusCopy(booking.notifications.email)}
        </p>
        <Button
          aria-busy={refreshingStatus}
          aria-disabled={refreshingStatus}
          className="mt-3 aria-disabled:opacity-50"
          onClick={refreshMessageStatus}
          variant="outline"
        >
          {refreshingStatus ? "Refreshing status…" : "Refresh message status"}
        </Button>
        <p aria-live="polite" className="sr-only" role="status">
          {refreshRequested
            ? refreshingStatus
              ? "Refreshing message status."
              : "Refresh request finished. Check the message status above."
            : ""}
        </p>
      </div>
    </>
  );
}

export function ManageBookingAside({
  booking,
}: {
  booking: ManagedBookingView;
}) {
  return (
    <aside className="self-start border-t-[3px] border-[#242424] bg-[#f7f7f5] p-[22px] max-[767px]:mt-2">
      <h2 className="font-[family-name:var(--font-shop-display)] text-[32px] font-bold uppercase leading-none">
        The same good place.
      </h2>
      <p className="mt-5 font-[family-name:var(--font-shop-display)] text-[30px] font-bold">
        {booking.shop.name}
      </p>
      <p className="mt-1 text-sm">{booking.shop.address}</p>
      <p className="mt-6 text-sm">{booking.shop.publicContact}</p>
      <div className="mt-6 border-t border-[#e6e6e2] pt-5 text-xs">
        <p className="font-semibold">Need a hand?</p>
        <p className="mt-2 text-[#72726e]">
          Contact the shop for help with your booking or contact details.
        </p>
      </div>
    </aside>
  );
}
