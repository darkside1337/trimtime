"use client";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RECOVERY_MISMATCH_WARNING } from "./owner-operation-recovery";

export function AppointmentCancelDialogContent({
  error,
  busy,
  uncertain,
  mismatch,
  terminal,
  onRetry,
  onRefresh,
  onRefreshSaved,
  onKeep,
  onKeepPending,
  onConfirm,
}: {
  error: string;
  busy: boolean;
  uncertain: boolean;
  mismatch: boolean;
  terminal: boolean;
  onRetry: () => void;
  onRefresh: () => void;
  onRefreshSaved: () => void;
  onKeep: () => void;
  onKeepPending: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogTitle className="max-w-full pr-8">Cancel appointment?</DialogTitle>
      <DialogDescription>
        This releases the scheduled time and keeps the cancelled appointment
        details and management link available until their existing expiry.
      </DialogDescription>
      {(error || mismatch) && (
        <p role="alert">{error || RECOVERY_MISMATCH_WARNING}</p>
      )}
      {mismatch ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button disabled={busy} onClick={onRefresh}>
            {busy ? "Refreshing…" : "Refresh appointment"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onKeepPending}>
            Keep pending operation
          </Button>
        </div>
      ) : uncertain ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button disabled={busy} onClick={onRetry}>
            {busy ? "Recovering…" : "Retry same operation"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onRefreshSaved}>
            Refresh saved details
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {terminal && (
            <Button variant="outline" disabled={busy} onClick={onRefresh}>
              Refresh appointment
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onKeep}>
            Keep appointment
          </Button>
          {!terminal && (
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {busy ? "Cancelling…" : "Confirm cancellation"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
