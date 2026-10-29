"use client";

import { useRef, useState } from "react";
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
import { cancelCustomerBookingAction } from "../../actions";
import type { ManagedBookingView } from "../../types";
import { createRecoveryKey } from "../recovery-key";
import { appointmentTime } from "./appointment-time";
import { display } from "./manage-booking-shell";
import type { PreviewDialog } from "./types";

const UNKNOWN_RESULT =
  "The cancellation result is unknown. Retry or reload your booking details.";

export function ManageBookingDialogs({
  booking,
  token,
  dialog,
  onOpenChange,
  onDiscard,
  onCancelled,
}: {
  booking: ManagedBookingView;
  token: string;
  dialog: PreviewDialog;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  onCancelled: () => void;
}) {
  const isCancel = dialog === "cancel";
  const current = appointmentTime(booking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const operationKey = useRef(createRecoveryKey());
  const submittedPayload = useRef<string | null>(null);

  function reset() {
    setError("");
    setUncertain(false);
    setStale(false);
    submittedPayload.current = null;
    operationKey.current = createRecoveryKey();
  }

  function requestOpenChange(open: boolean) {
    if (busy || uncertain || stale) return;
    if (!open) reset();
    onOpenChange(open);
  }

  async function submit(payload?: string) {
    if (busy || !token) return;
    const serialized =
      payload ??
      JSON.stringify({
        token,
        expectedRevision: booking.revision,
        operationKey: operationKey.current,
        confirmed: true,
      });
    if (!payload) submittedPayload.current = serialized;
    setBusy(true);
    setError("");
    setStale(false);
    try {
      const result = await cancelCustomerBookingAction(JSON.parse(serialized));
      if (!result.success) {
        setUncertain(false);
        if (
          result.error.code === "STALE_BOOKING" ||
          result.error.code === "RECOVERY_MISMATCH"
        )
          setStale(true);
        setError(result.error.message);
        return;
      }
      onCancelled();
    } catch {
      setUncertain(true);
      setError(UNKNOWN_RESULT);
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    if (submittedPayload.current) void submit(submittedPayload.current);
  }

  function reload() {
    onOpenChange(false);
    window.location.reload();
  }

  const locked = busy || uncertain || stale;

  return (
    <Dialog
      disablePointerDismissal={locked}
      open={dialog !== null}
      onOpenChange={requestOpenChange}
    >
      <DialogContent
        className={cn(display.variable, "[--radius-pill:2px]")}
        showCloseButton={!locked}
      >
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-shop-display)] text-3xl font-bold uppercase">
            {isCancel ? "Let this chair go?" : "Keep your original?"}
          </DialogTitle>
          <DialogDescription>
            {isCancel
              ? "Cancelling releases this time. Your saved appointment details stay here for your records."
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
          {isCancel ? (
            <p className="text-xs text-[#72726e]">
              Your saved appointment · this link stays private
            </p>
          ) : (
            <p className="text-xs text-[#72726e]">
              Preview only · no appointment data will change
            </p>
          )}
        </div>
        {isCancel ? (
          <p aria-live="polite" className="min-h-5 text-xs" role="status">
            {busy ? "Cancelling appointment…" : ""}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-[#9f2d20]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {isCancel && uncertain ? (
            <>
              <Button disabled={busy} onClick={reload} variant="outline">
                Reload booking details
              </Button>
              <Button disabled={busy} onClick={retry}>
                Retry cancellation
              </Button>
            </>
          ) : isCancel && stale ? (
            <Button onClick={reload}>Reload booking details</Button>
          ) : (
            <>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => requestOpenChange(false)}
              >
                {isCancel ? "Keep appointment" : "Keep editing"}
              </Button>
              {isCancel ? (
                <Button
                  disabled={busy}
                  onClick={() => void submit()}
                  variant="destructive"
                >
                  Yes, cancel appointment
                </Button>
              ) : (
                <Button onClick={onDiscard}>Discard preview choices</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
