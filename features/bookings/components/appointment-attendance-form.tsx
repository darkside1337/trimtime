"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setOwnerAttendanceAction } from "../actions";
import type { OwnerAppointmentView } from "../types";
import { createRecoveryKey } from "./recovery-key";
import { useOwnerAppointmentDraft } from "./owner-calendar-context";

export function AppointmentAttendanceForm({
  appointment,
  now,
}: {
  appointment: OwnerAppointmentView;
  now: string;
}) {
  const router = useRouter();
  const { draft, setDraft, clearDraft } = useOwnerAppointmentDraft();
  const savedDraft =
    draft?.appointmentId === appointment.id &&
    draft.operationMode === "attendance"
      ? draft
      : null;
  const initialStatus =
    appointment.status === "no_show" ? "no_show" : "completed";
  const [reviewRecoveryKey] = useState(createRecoveryKey);
  const [status, setStatus] = useState<"completed" | "no_show">(
    savedDraft?.attendanceStatus ?? initialStatus,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(
    savedDraft?.recoveryPending === true,
  );
  const reviewedConflict =
    savedDraft?.needsReview === true &&
    savedDraft.conflictRevision !== appointment.revision;
  const needsReview = savedDraft?.needsReview === true && !reviewedConflict;
  const recoveryKey = reviewedConflict
    ? reviewRecoveryKey
    : (savedDraft?.recoveryKey ?? reviewRecoveryKey);
  const submittedPayload = savedDraft?.submittedPayload ?? null;

  if (
    appointment.status === "cancelled" ||
    Date.parse(appointment.endAt) >= Date.parse(now)
  )
    return null;

  function updateStatus(value: "completed" | "no_show") {
    setStatus(value);
    setError("");
    if (value === initialStatus && !uncertain) {
      if (savedDraft) clearDraft();
      return;
    }
    setDraft({
      appointmentId: appointment.id,
      operationMode: "attendance",
      attendanceStatus: value,
      baselineAttendanceStatus: initialStatus,
      recoveryKey,
      submittedPayload: savedDraft?.submittedPayload ?? null,
      recoveryPending: uncertain,
    });
  }

  async function send(payload: {
    bookingId: string;
    expectedRevision: number;
    operationKey: string;
    status: "completed" | "no_show";
  }) {
    const serialized = JSON.stringify(payload);
    setDraft({
      appointmentId: appointment.id,
      operationMode: "attendance",
      attendanceStatus: payload.status,
      baselineAttendanceStatus: initialStatus,
      recoveryKey: payload.operationKey,
      submittedPayload: serialized,
      mutationPending: true,
      recoveryPending: true,
    });
    setBusy(true);
    setError("");
    try {
      const result = await setOwnerAttendanceAction(payload);
      if (!result.success) {
        const outcomeUncertain = result.error.code === "UNAVAILABLE";
        setDraft({
          appointmentId: appointment.id,
          operationMode: "attendance",
          attendanceStatus: payload.status,
          baselineAttendanceStatus: initialStatus,
          recoveryKey: payload.operationKey,
          submittedPayload: serialized,
          mutationPending: false,
          needsReview: result.error.code === "STALE_BOOKING",
          conflictRevision:
            result.error.code === "STALE_BOOKING"
              ? appointment.revision
              : undefined,
          recoveryPending: outcomeUncertain,
        });
        setUncertain(outcomeUncertain);
        setError(
          outcomeUncertain
            ? `${result.error.message} Retry the same operation to recover its result.`
            : result.error.message,
        );
        return;
      }
      clearDraft();
      setUncertain(false);
      router.refresh();
    } catch {
      setDraft({
        appointmentId: appointment.id,
        operationMode: "attendance",
        attendanceStatus: payload.status,
        baselineAttendanceStatus: initialStatus,
        recoveryKey: payload.operationKey,
        submittedPayload: serialized,
        mutationPending: false,
        recoveryPending: true,
      });
      setUncertain(true);
      setError(
        "The response was interrupted. Retry the same operation to recover its result.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void send({
      bookingId: appointment.id,
      expectedRevision: appointment.revision,
      operationKey: recoveryKey,
      status,
    });
  }

  function retry() {
    if (!submittedPayload || busy) return;
    void send(JSON.parse(submittedPayload));
  }

  function refreshAndReview() {
    const nextRecoveryKey = createRecoveryKey();
    setDraft({
      appointmentId: appointment.id,
      operationMode: "attendance",
      attendanceStatus: status,
      baselineAttendanceStatus: initialStatus,
      recoveryKey: nextRecoveryKey,
      submittedPayload: null,
      needsReview: true,
      conflictRevision: appointment.revision,
      recoveryPending: false,
    });
    router.refresh();
  }

  return (
    <form
      className="grid gap-3 rounded-xl border border-border p-4"
      onSubmit={submit}
    >
      <label
        className="grid gap-1 text-sm font-medium"
        htmlFor="attendance-status"
      >
        Attendance
        <select
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-foreground"
          disabled={busy || uncertain}
          id="attendance-status"
          name="status"
          onChange={(event) =>
            updateStatus(event.currentTarget.value as "completed" | "no_show")
          }
          value={status}
        >
          <option value="completed">Completed</option>
          <option value="no_show">No-show</option>
        </select>
      </label>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {needsReview ? (
        <Button
          disabled={busy}
          onClick={refreshAndReview}
          type="button"
          variant="outline"
        >
          Refresh and review
        </Button>
      ) : uncertain ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => router.refresh()}
            type="button"
            variant="outline"
          >
            Refresh saved details
          </Button>
          <Button
            disabled={busy}
            onClick={retry}
            type="button"
            variant="outline"
          >
            {busy ? "Recovering attendance…" : "Retry same operation"}
          </Button>
        </div>
      ) : (
        <Button disabled={busy || status === appointment.status} type="submit">
          {busy ? "Saving attendance…" : "Save attendance"}
        </Button>
      )}
    </form>
  );
}
