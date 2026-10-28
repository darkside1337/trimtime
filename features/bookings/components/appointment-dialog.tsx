"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OwnerAppointmentView } from "../types";
import { AppointmentDetails } from "./appointment-details";
import { AppointmentOperations } from "./appointment-operations";
import type { OwnerAppointmentMoveChoices } from "../types";
import { useAppointmentDismissal } from "../hooks/use-appointment-dismissal";

export function AppointmentDialog({
  appointment,
  calendarHref,
  now,
  moveChoices,
}: {
  appointment: OwnerAppointmentView;
  calendarHref: string;
  now: string;
  moveChoices: OwnerAppointmentMoveChoices;
}) {
  const { requestClose, requestNavigation } = useAppointmentDismissal(true);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-32px))] max-w-[680px] overflow-y-auto rounded-3xl border border-border bg-background p-6 shadow-xl sm:max-w-[680px] max-[520px]:max-h-dvh max-[520px]:w-full max-[520px]:rounded-none max-[520px]:p-5 [&_*:focus-visible]:border-[var(--tt-success)] [&_*:focus-visible]:ring-2 [&_*:focus-visible]:ring-[var(--tt-success)]"
      >
        <DialogTitle className="sr-only">Appointment details</DialogTitle>
        <DialogDescription className="sr-only">
          Saved appointment details and notification status.
        </DialogDescription>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Close appointment details"
            onClick={requestClose}
          >
            ×
          </Button>
        </div>
        <AppointmentDetails
          appointment={appointment}
          now={now}
          operations={
            <AppointmentOperations
              appointment={appointment}
              choices={moveChoices}
              now={now}
            />
          }
        />
        <div className="flex justify-end">
          <Link
            className={buttonVariants({ variant: "outline" })}
            data-slot="button"
            data-size="default"
            data-variant="outline"
            href={calendarHref}
            onClick={(event) => {
              event.preventDefault();
              requestNavigation(calendarHref);
            }}
          >
            Back to calendar
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppointmentDialogError({ message }: { message: string }) {
  const router = useRouter();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent>
        <DialogTitle>Appointment unavailable</DialogTitle>
        <DialogDescription>{message}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.refresh()}>
            Try again
          </Button>
          <Link
            className={buttonVariants({ variant: "outline" })}
            data-slot="button"
            data-size="default"
            data-variant="outline"
            href="/"
          >
            Back to calendar
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
