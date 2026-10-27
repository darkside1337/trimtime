"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppointmentDismissal } from "../hooks/use-appointment-dismissal";
import type { OwnerAppointmentChoices } from "../types";
import { AppointmentForm } from "./appointment-form";

export function AppointmentEntryDialog({
  choices,
  initialDate,
  initialTime,
  initialBarberId,
  calendarHref,
}: {
  choices: OwnerAppointmentChoices;
  initialDate: string;
  initialTime?: string;
  initialBarberId?: string;
  calendarHref: string;
}) {
  const { requestClose } = useAppointmentDismissal(true);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        data-appointment-entry="true"
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-32px))] max-w-[680px] overflow-y-auto rounded-3xl border border-border bg-background p-0 sm:max-w-[680px] max-[520px]:max-h-dvh max-[520px]:w-full max-[520px]:rounded-none [&_*:focus-visible]:border-[var(--tt-success)] [&_*:focus-visible]:ring-2 [&_*:focus-visible]:ring-[var(--tt-success)]"
      >
        <DialogTitle className="sr-only">New appointment</DialogTitle>
        <DialogDescription className="sr-only">
          Create an exact-minute manual appointment.
        </DialogDescription>
        <div className="flex justify-end gap-2 px-5 pt-5">
          <Button
            variant="outline"
            size="icon"
            aria-label="Close new appointment"
            onClick={requestClose}
          >
            ×
          </Button>
        </div>
        <AppointmentForm
          choices={choices}
          initialDate={initialDate}
          initialTime={initialTime}
          initialBarberId={initialBarberId}
          calendarHref={calendarHref}
          dialog
        />
      </DialogContent>
    </Dialog>
  );
}
