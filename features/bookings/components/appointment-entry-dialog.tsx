"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppointmentDismissal } from "../hooks/use-appointment-dismissal";
import { OWNER_APPOINTMENT_ENTRY_DIALOG_ATTRIBUTES } from "./appointment-dialog-attributes";
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
        {...OWNER_APPOINTMENT_ENTRY_DIALOG_ATTRIBUTES}
        data-appointment-entry="true"
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-32px))] max-w-[680px] overflow-y-auto rounded-3xl border border-border bg-background p-0 sm:max-w-[680px] max-[520px]:max-h-dvh max-[520px]:w-full max-[520px]:rounded-none [&_*:focus-visible]:border-[var(--tt-success)] [&_*:focus-visible]:ring-2 [&_*:focus-visible]:ring-[var(--tt-success)]"
      >
        <DialogTitle className="sr-only">New appointment</DialogTitle>
        <DialogDescription className="sr-only">
          Create an exact-minute manual appointment.
        </DialogDescription>
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
