"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ManagedBookingView } from "../../types";
import { appointmentTime } from "./appointment-time";
import { display } from "./manage-booking-shell";
import type { PreviewDialog } from "./types";

export function ManageBookingDialogs({
  booking,
  dialog,
  onOpenChange,
  onDiscard,
}: {
  booking: ManagedBookingView;
  dialog: PreviewDialog;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  const isCancel = dialog === "cancel";
  const current = appointmentTime(booking);
  return (
    <Dialog open={dialog !== null} onOpenChange={onOpenChange}>
      <DialogContent className={cn(display.variable, "[--radius-pill:2px]")}>
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-shop-display)] text-3xl font-bold uppercase">
            {isCancel ? "Let this chair go?" : "Keep your original?"}
          </DialogTitle>
          <DialogDescription>
            {isCancel
              ? "Preview only. This appointment will not be cancelled."
              : "Your original appointment is still reserved. Leave without saving these preview choices?"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 bg-[#f7f7f5] p-4 text-sm">
          <p>
            {booking.service.name} with {booking.barber.name}
          </p>
          <p>
            {current.date} · {current.range}
          </p>
          <p className="text-xs text-[#72726e]">
            Preview only · no appointment data will change
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isCancel ? "Keep appointment" : "Keep editing"}
          </Button>
          {isCancel ? (
            <Button disabled variant="destructive">
              Yes, cancel appointment · Unavailable
            </Button>
          ) : (
            <Button onClick={onDiscard}>Discard preview choices</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
