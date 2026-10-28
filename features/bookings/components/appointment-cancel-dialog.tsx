"use client";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function AppointmentCancelDialogContent({
  error,
  busy,
  uncertain,
  onRetry,
  onKeep,
  onConfirm,
}: {
  error: string;
  busy: boolean;
  uncertain: boolean;
  onRetry: () => void;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogTitle className="max-w-full pr-8">Cancel appointment?</DialogTitle>
      <DialogDescription>
        This releases the scheduled time and keeps the cancelled appointment
        details and management link available until their existing expiry.
      </DialogDescription>
      {error && <p role="alert">{error}</p>}
      {uncertain ? (
        <Button type="button" disabled={busy} onClick={onRetry}>
          {busy ? "Recovering…" : "Retry same operation"}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={onKeep}>
            Keep appointment
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </div>
      )}
    </>
  );
}
