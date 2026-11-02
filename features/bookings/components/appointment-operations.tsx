"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  cancelOwnerBookingAction,
  moveOwnerBookingAction,
  refreshOwnerAppointmentAction,
  restoreOwnerBookingAction,
} from "../actions";
import { fixedBookingPrice } from "../money";
import { resolveOwnerStartChoices } from "../time";
import type {
  OwnerAppointmentMoveChoices,
  OwnerAppointmentView,
} from "../types";
import {
  useOwnerAppointmentDraft,
  type OwnerAppointmentDraft,
  type OwnerAppointmentDraftValues,
} from "./owner-calendar-context";
import { useAppointmentDismissal } from "../hooks/use-appointment-dismissal";
import { AppointmentCancelDialogContent } from "./appointment-cancel-dialog";
import { AppointmentMoveDialogContent } from "./appointment-move-dialog";
import { AppointmentRestoreDialogContent } from "./appointment-restore-dialog";
import { AppointmentAttendanceForm } from "./appointment-attendance-form";
import {
  classifyOwnerOperationFailure,
  RECOVERY_MISMATCH_WARNING,
  UNCONFIRMED_OPERATION_MESSAGE,
  type OwnerOperationMode,
  type OwnerOperationTerminalAction,
} from "./owner-operation-recovery";
import { createRecoveryKey } from "./recovery-key";

export function AppointmentCalendarBackLink({ href }: { href: string }) {
  const { requestNavigation } = useAppointmentDismissal();
  return (
    <Link
      className={buttonVariants({ variant: "outline" })}
      data-slot="button"
      data-size="default"
      data-variant="outline"
      href={href}
      onClick={(event) => {
        event.preventDefault();
        requestNavigation(href);
      }}
    >
      Back to calendar
    </Link>
  );
}

type Mode = "move" | "cancel" | "restore" | null;
type Values = OwnerAppointmentDraftValues;
type AppointmentOperationsProps = {
  appointment: OwnerAppointmentView;
  choices: OwnerAppointmentMoveChoices;
  now: string;
};

type OperationOutcome =
  | { kind: "uncertain"; code: string | null }
  | { kind: "mismatch"; code: "RECOVERY_MISMATCH" }
  | {
      kind: "terminal";
      code: string;
      terminalAction: OwnerOperationTerminalAction;
    };

type OperationFailureResult = {
  error: { code?: string; message: string };
};

const UNCONFIRMED_INTERRUPTED_MESSAGE =
  "The response was interrupted. Retry the same operation to recover its result.";

function savedOutcome(
  draft: OwnerAppointmentDraft | null,
): OperationOutcome | null {
  if (draft?.recoveryPending !== true) return null;
  return draft.recoveryKind === "mismatch"
    ? { kind: "mismatch", code: "RECOVERY_MISMATCH" }
    : { kind: "uncertain", code: null };
}

function localParts(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function AppointmentOperations(props: AppointmentOperationsProps) {
  const { formGeneration } = useOwnerAppointmentDraft();
  return (
    <AppointmentOperationsForm
      key={`${props.appointment.id}:${props.appointment.revision}:${formGeneration}`}
      {...props}
    />
  );
}

function AppointmentOperationsForm({
  appointment,
  choices,
  now,
}: AppointmentOperationsProps) {
  const router = useRouter();
  const { draft, setDraft, clearDraft } = useOwnerAppointmentDraft();
  const [busy, setBusy] = useState(false);
  const savedDraft =
    draft?.appointmentId === appointment.id && draft.operationMode === "move"
      ? draft
      : null;
  const savedCancelDraft =
    draft?.appointmentId === appointment.id && draft.operationMode === "cancel"
      ? draft
      : null;
  const savedRestoreDraft =
    draft?.appointmentId === appointment.id && draft.operationMode === "restore"
      ? draft
      : null;
  const [mode, setMode] = useState<Mode>(
    savedDraft?.recoveryPending
      ? "move"
      : savedCancelDraft?.recoveryPending
        ? "cancel"
        : null,
  );
  const [moveOutcome, setMoveOutcome] = useState<OperationOutcome | null>(() =>
    savedOutcome(savedDraft),
  );
  const [cancelOutcome, setCancelOutcome] = useState<OperationOutcome | null>(
    () => savedOutcome(savedCancelDraft),
  );
  const [restoreOutcome, setRestoreOutcome] = useState<OperationOutcome | null>(
    () => savedOutcome(savedRestoreDraft),
  );
  const [error, setError] = useState(() =>
    savedOutcome(savedDraft)?.kind === "mismatch"
      ? RECOVERY_MISMATCH_WARNING
      : "",
  );
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const initial = useMemo<Values>(() => {
    const initialLocal = localParts(appointment.startAt, choices.timeZone);
    return {
      customerName: appointment.customer.name,
      email: appointment.customer.email ?? "",
      phone: appointment.customer.phone ?? "",
      whatsappOptIn: appointment.customer.whatsappOptIn,
      serviceId: appointment.service.id,
      barberId: appointment.barber.id,
      date: initialLocal.date,
      time: initialLocal.time,
      occurrence: "",
    };
  }, [
    appointment.startAt,
    appointment.customer.name,
    appointment.customer.email,
    appointment.customer.phone,
    appointment.customer.whatsappOptIn,
    appointment.service.id,
    appointment.barber.id,
    choices.timeZone,
  ]);
  const [values, setValues] = useState<Values>(savedDraft?.values ?? initial);
  const baseline = savedDraft?.baseline ?? initial;
  const recoveryKey =
    (mode === "cancel"
      ? savedCancelDraft?.recoveryKey
      : mode === "restore"
        ? savedRestoreDraft?.recoveryKey
        : savedDraft?.recoveryKey) ?? createRecoveryKey();
  const submittedPayload = savedDraft?.submittedPayload ?? null;
  const restorePayload = savedRestoreDraft?.submittedPayload ?? null;
  const service = choices.services.find((item) => item.id === values.serviceId);
  const barbers = choices.barbers.filter(
    (item) => !service || service.barberIds.includes(item.id),
  );
  const starts = useMemo(
    () => resolveOwnerStartChoices(values.date, values.time, choices.timeZone),
    [values.date, values.time, choices.timeZone],
  );
  const chosenStart =
    starts.find((item) => item.startAt === values.occurrence) ??
    (starts.length === 1 ? starts[0] : undefined);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const canChange =
    appointment.status === "confirmed" &&
    Date.parse(appointment.endAt) > Date.parse(now);
  const canRestore =
    appointment.status === "cancelled" &&
    Date.parse(appointment.startAt) > Date.parse(now);
  const canSetAttendance =
    appointment.status !== "cancelled" &&
    Date.parse(appointment.endAt) < Date.parse(now);
  const movePending = moveOutcome !== null && moveOutcome.kind !== "terminal";
  const cancelPending =
    cancelOutcome !== null && cancelOutcome.kind !== "terminal";
  const restorePending =
    restoreOutcome !== null && restoreOutcome.kind !== "terminal";
  const recoveryPending = movePending || cancelPending || restorePending;
  const pendingMode: Exclude<Mode, null> | null = movePending
    ? "move"
    : cancelPending
      ? "cancel"
      : restorePending
        ? "restore"
        : null;
  const uncertain = moveOutcome?.kind === "uncertain";
  const cancelUncertain = cancelOutcome?.kind === "uncertain";
  const restoreUncertain = restoreOutcome?.kind === "uncertain";
  const moveTerminalAction =
    moveOutcome?.kind === "terminal" ? moveOutcome.terminalAction : null;

  function clearOutcomes() {
    setMoveOutcome(null);
    setCancelOutcome(null);
    setRestoreOutcome(null);
  }

  function setOutcome(
    mode: OwnerOperationMode,
    outcome: OperationOutcome | null,
  ) {
    if (mode === "move") setMoveOutcome(outcome);
    else if (mode === "cancel") setCancelOutcome(outcome);
    else setRestoreOutcome(outcome);
  }

  function applyFailure(
    mode: OwnerOperationMode,
    result: OperationFailureResult,
    persistedDraft: OwnerAppointmentDraft,
  ) {
    const failure = classifyOwnerOperationFailure(mode, result.error.code);
    if (failure.kind === "mismatch") {
      setDraft({
        ...persistedDraft,
        recoveryPending: true,
        recoveryKind: "mismatch",
      });
      setOutcome(mode, { kind: "mismatch", code: "RECOVERY_MISMATCH" });
      setError(RECOVERY_MISMATCH_WARNING);
      return;
    }
    if (failure.kind === "terminal") {
      setDraft({
        ...persistedDraft,
        recoveryPending: false,
        recoveryKind: undefined,
      });
      setOutcome(mode, {
        kind: "terminal",
        code: failure.code,
        terminalAction: failure.terminalAction,
      });
      setError(result.error.message);
      return;
    }
    setDraft({
      ...persistedDraft,
      recoveryPending: true,
      recoveryKind: "uncertain",
    });
    setOutcome(mode, { kind: "uncertain", code: failure.code });
    setError(`${result.error.message} ${UNCONFIRMED_OPERATION_MESSAGE}`);
  }

  function applyInterruption(
    mode: OwnerOperationMode,
    persistedDraft: OwnerAppointmentDraft,
    message = UNCONFIRMED_INTERRUPTED_MESSAGE,
  ) {
    setDraft({
      ...persistedDraft,
      recoveryPending: true,
      recoveryKind: "uncertain",
    });
    setOutcome(mode, { kind: "uncertain", code: null });
    setError(message);
  }

  function finishSuccess() {
    clearDraft();
    clearOutcomes();
    setMode(null);
    setError("");
    router.refresh();
  }

  function closeDialog(options?: { refreshRestore?: boolean }) {
    const refreshRestore =
      options?.refreshRestore === true && restoreOutcome?.kind === "uncertain";
    setMode(null);
    setError("");
    setMoveOutcome((outcome) =>
      outcome?.kind === "terminal" ? null : outcome,
    );
    setCancelOutcome((outcome) =>
      outcome?.kind === "terminal" ? null : outcome,
    );
    setRestoreOutcome((outcome) =>
      outcome?.kind === "terminal" ? null : outcome,
    );
    if (refreshRestore) refreshOwnerAppointmentAction().catch(() => {});
  }

  async function requestAuthoritativeRefresh() {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const result = await refreshOwnerAppointmentAction();
      if (!result.success) {
        setError(
          `The appointment could not be refreshed. ${result.error.message} The saved operation is still available.`,
        );
        return false;
      }
      return true;
    } catch {
      setError(
        "The appointment could not be refreshed. Check your connection and try refreshing again. The saved operation is still available.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refreshAndDiscard() {
    setReloadConfirmation(false);
    if (await requestAuthoritativeRefresh()) {
      clearDraft();
      clearOutcomes();
      setMode(null);
      setError("");
    }
  }

  async function refreshSavedDetails() {
    await requestAuthoritativeRefresh();
  }

  async function reviewCurrentMoveOffer() {
    if (await requestAuthoritativeRefresh()) {
      setDraft({
        values,
        baseline,
        recoveryKey: createRecoveryKey(),
        submittedPayload: null,
        appointmentId: appointment.id,
        operationMode: "move",
      });
      setMoveOutcome(null);
      setMode(null);
      setError("");
    }
  }

  function update(patch: Partial<Values>) {
    if (moveOutcome?.kind === "uncertain" || moveOutcome?.kind === "mismatch")
      return;
    const next = { ...values, ...patch };
    if (
      patch.serviceId &&
      !choices.services
        .find((item) => item.id === patch.serviceId)
        ?.barberIds.includes(next.barberId)
    )
      next.barberId = "";
    const editingAfterTerminal = moveOutcome?.kind === "terminal";
    setValues(next);
    setDraft({
      values: next,
      baseline,
      recoveryKey: editingAfterTerminal ? createRecoveryKey() : recoveryKey,
      submittedPayload: editingAfterTerminal ? null : submittedPayload,
      appointmentId: appointment.id,
      operationMode: "move",
    });
    if (editingAfterTerminal) setMoveOutcome(null);
    setError("");
  }

  async function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !service || !values.barberId || !chosenStart) {
      if (!service || !values.barberId || !chosenStart)
        setError(
          starts.length > 1
            ? "Choose which occurrence of this repeated local time you mean."
            : "Choose a service, eligible barber, date, and exact start minute.",
        );
      return;
    }
    const payload = {
      bookingId: appointment.id,
      expectedRevision: appointment.revision,
      operationKey: recoveryKey,
      serviceId: service.id,
      barberId: values.barberId,
      startAt: chosenStart.startAt,
      reviewedOffer: {
        name: service.name,
        priceUsd: fixedBookingPrice(service.priceUsd),
        durationMinutes: String(service.durationMinutes),
      },
    };
    const serialized = JSON.stringify(payload);
    const persistedDraft: OwnerAppointmentDraft = {
      values,
      baseline,
      recoveryKey,
      submittedPayload: serialized,
      appointmentId: appointment.id,
      operationMode: "move",
    };
    setDraft(persistedDraft);
    setBusy(true);
    setError("");
    setMoveOutcome(null);
    try {
      const result = await moveOwnerBookingAction(payload);
      if (!result.success) {
        applyFailure("move", result, persistedDraft);
        return;
      }
      finishSuccess();
    } catch {
      applyInterruption("move", persistedDraft);
    } finally {
      setBusy(false);
    }
  }

  async function retryMove() {
    if (!savedDraft?.submittedPayload || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await moveOwnerBookingAction(
        JSON.parse(savedDraft.submittedPayload),
      );
      if (!result.success) {
        applyFailure("move", result, savedDraft);
        return;
      }
      finishSuccess();
    } catch {
      applyInterruption(
        "move",
        savedDraft,
        "Recovery is still unavailable. Retry the same operation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (busy) return;
    const payload = {
      bookingId: appointment.id,
      expectedRevision: appointment.revision,
      operationKey: recoveryKey,
    };
    const persistedDraft: OwnerAppointmentDraft = {
      values,
      baseline,
      recoveryKey,
      submittedPayload: JSON.stringify(payload),
      appointmentId: appointment.id,
      operationMode: "cancel",
    };
    setDraft(persistedDraft);
    setBusy(true);
    setError("");
    setCancelOutcome(null);
    try {
      const result = await cancelOwnerBookingAction(payload);
      if (!result.success) {
        applyFailure("cancel", result, persistedDraft);
        return;
      }
      finishSuccess();
    } catch {
      applyInterruption(
        "cancel",
        persistedDraft,
        "The response was interrupted. Retry cancellation to recover its result.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryCancel() {
    if (!savedCancelDraft?.submittedPayload || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await cancelOwnerBookingAction(
        JSON.parse(savedCancelDraft.submittedPayload),
      );
      if (!result.success) {
        applyFailure("cancel", result, savedCancelDraft);
        return;
      }
      finishSuccess();
    } catch {
      applyInterruption(
        "cancel",
        savedCancelDraft,
        "Recovery is still unavailable. Retry the same operation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (busy) return;
    const payload = {
      bookingId: appointment.id,
      expectedRevision: appointment.revision,
      operationKey: recoveryKey,
    };
    const persistedDraft: OwnerAppointmentDraft = {
      values,
      baseline,
      recoveryKey,
      submittedPayload: JSON.stringify(payload),
      appointmentId: appointment.id,
      operationMode: "restore",
    };
    setDraft(persistedDraft);
    setBusy(true);
    setError("");
    setRestoreOutcome(null);
    try {
      const result = await restoreOwnerBookingAction(payload);
      if (!result.success) {
        applyFailure("restore", result, persistedDraft);
        return;
      }
      finishSuccess();
    } catch {
      applyInterruption("restore", persistedDraft);
    } finally {
      setBusy(false);
    }
  }

  async function retryRestore() {
    if (!restorePayload || !savedRestoreDraft || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await restoreOwnerBookingAction(
        JSON.parse(restorePayload),
      );
      if (!result.success) {
        applyFailure("restore", result, savedRestoreDraft);
        return;
      }
      finishSuccess();
    } catch {
      applyInterruption(
        "restore",
        savedRestoreDraft,
        "Recovery is still unavailable. Retry the same operation.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canChange && !canRestore && !canSetAttendance && !recoveryPending)
    return null;

  return (
    <>
      {!recoveryPending && (canChange || canRestore) && (
        <div className="flex flex-wrap gap-2" aria-label="Appointment actions">
          {canChange && (
            <>
              <Button variant="outline" onClick={() => setMode("move")}>
                Move appointment
              </Button>
              <Button variant="destructive" onClick={() => setMode("cancel")}>
                Cancel appointment
              </Button>
            </>
          )}
          {canRestore && (
            <Button variant="outline" onClick={() => setMode("restore")}>
              Restore appointment
            </Button>
          )}
        </div>
      )}
      {recoveryPending && mode === null && (
        <Button variant="outline" onClick={() => setMode(pendingMode)}>
          Recover pending operation
        </Button>
      )}
      <AppointmentAttendanceForm appointment={appointment} now={now} />
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) closeDialog({ refreshRestore: true });
        }}
      >
        <DialogContent
          forceBackdrop
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          {mode === "move" ? (
            <AppointmentMoveDialogContent
              choices={choices}
              values={values}
              service={service}
              barbers={barbers}
              starts={starts}
              dirty={dirty}
              busy={busy}
              error={error}
              uncertain={uncertain}
              mismatch={moveOutcome?.kind === "mismatch"}
              terminalAction={moveTerminalAction}
              onUpdate={update}
              onSubmit={submitMove}
              onRetry={retryMove}
              onRefresh={() => void refreshAndDiscard()}
              onRefreshSaved={() => void refreshSavedDetails()}
              onKeepPending={() => closeDialog()}
              onReloadSaved={() => setReloadConfirmation(true)}
              onReviewCurrentOffer={() => void reviewCurrentMoveOffer()}
            />
          ) : mode === "cancel" ? (
            <AppointmentCancelDialogContent
              error={error}
              busy={busy}
              uncertain={cancelUncertain}
              mismatch={cancelOutcome?.kind === "mismatch"}
              terminal={cancelOutcome?.kind === "terminal"}
              onRetry={retryCancel}
              onRefresh={() => void refreshAndDiscard()}
              onRefreshSaved={() => void refreshSavedDetails()}
              onKeep={() => closeDialog()}
              onKeepPending={() => closeDialog()}
              onConfirm={cancel}
            />
          ) : (
            <AppointmentRestoreDialogContent
              appointment={appointment}
              busy={busy}
              error={error}
              uncertain={restoreUncertain}
              mismatch={restoreOutcome?.kind === "mismatch"}
              terminal={restoreOutcome?.kind === "terminal"}
              onRetry={retryRestore}
              onRefresh={() => void refreshAndDiscard()}
              onRefreshSaved={() => void refreshSavedDetails()}
              onKeep={() => closeDialog()}
              onKeepPending={() => closeDialog()}
              onConfirm={restore}
            />
          )}
        </DialogContent>
      </Dialog>
      <OwnerDiscardDialog
        open={reloadConfirmation}
        onKeepEditing={() => setReloadConfirmation(false)}
        onDiscard={() => void refreshAndDiscard()}
      />
    </>
  );
}
