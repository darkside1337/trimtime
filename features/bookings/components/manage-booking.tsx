"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ManagedBookingView } from "../types";
import { shop as styles } from "./shop-styles";
import {
  ManageBookingAside,
  ManageBookingDetails,
} from "./manage-booking/manage-booking-details";
import { ManageBookingDialogs } from "./manage-booking/manage-booking-dialogs";
import { BookingPreview } from "./manage-booking/manage-booking-preview";
import {
  display,
  Footer,
  Hero,
  SiteHeader,
} from "./manage-booking/manage-booking-shell";
import type { PreviewDialog, PreviewScreen } from "./manage-booking/types";

export { UnavailableManageBooking } from "./manage-booking/manage-booking-unavailable";

export function ManageBooking({
  booking,
  past,
}: {
  booking: ManagedBookingView;
  past: boolean;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<PreviewScreen>("details");
  const [dialog, setDialog] = useState<PreviewDialog>(null);
  const [refreshingStatus, startRefresh] = useTransition();
  const [refreshRequested, setRefreshRequested] = useState(false);
  const screenHeadingRef = useRef<HTMLHeadingElement>(null);

  function refreshMessageStatus() {
    if (refreshingStatus) return;
    setRefreshRequested(true);
    startRefresh(() => router.refresh());
  }

  useEffect(() => {
    if (screen === "details")
      screenHeadingRef.current?.focus({ preventScroll: true });
  }, [screen]);

  return (
    <main
      className={cn(
        styles.page,
        display.variable,
        "[--primary:#21734f] [--primary-foreground:#fff] [--radius-pill:2px]",
      )}
    >
      <div className={styles.noticeBar}>
        <span>Fictional shop · Real attention to detail</span>
        <span>Your booking details are private</span>
      </div>
      <SiteHeader
        name={booking.shop.name}
        publicContact={booking.shop.publicContact}
      />
      <Hero />

      <div
        className={cn(
          styles.wrap,
          screen === "details" && styles.bookingLayout,
        )}
      >
        <section className="min-w-0 border-t-[3px] border-[#242424]">
          {screen === "details" ? (
            <ManageBookingDetails
              booking={booking}
              past={past}
              headingRef={screenHeadingRef}
              refreshingStatus={refreshingStatus}
              refreshRequested={refreshRequested}
              onPreviewCancellation={() => setDialog("cancel")}
              onChangePreview={() => setScreen("edit")}
              refreshMessageStatus={refreshMessageStatus}
            />
          ) : (
            <BookingPreview
              booking={booking}
              headingRef={screenHeadingRef}
              onClose={() => setDialog("discard")}
            />
          )}
        </section>

        {screen === "details" ? <ManageBookingAside booking={booking} /> : null}
      </div>

      <Footer name={booking.shop.name} />
      <ManageBookingDialogs
        booking={booking}
        dialog={dialog}
        onOpenChange={(open) => setDialog(open ? dialog : null)}
        onDiscard={() => {
          setDialog(null);
          setScreen("details");
        }}
      />
    </main>
  );
}
