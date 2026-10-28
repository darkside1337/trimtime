"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cancelOwnerBookingAction, moveOwnerBookingAction } from "../actions";
import { fixedBookingPrice } from "../money";
import { resolveOwnerStartChoices } from "../time";
import type {
  OwnerAppointmentMoveChoices,
  OwnerAppointmentView,
} from "../types";
import {
  useOwnerAppointmentDraft,
  type OwnerAppointmentDraftValues,
} from "./owner-calendar-context";
import { useAppointmentDismissal } from "../hooks/use-appointment-dismissal";
import { AppointmentCancelDialogContent } from "./appointment-cancel-dialog";
import { AppointmentMoveDialogContent } from "./appointment-move-dialog";
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

type Mode = "move" | "cancel" | null;
type Values = OwnerAppointmentDraftValues;
type AppointmentOperationsProps = {
  appointment: OwnerAppointmentView;
  choices: OwnerAppointmentMoveChoices;
  now: string;
};

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
  const [error, setError] = useState("");
  const savedDraft =
    draft?.appointmentId === appointment.id && draft.operationMode === "move"
      ? draft
      : null;
  const savedCancelDraft =
    draft?.appointmentId === appointment.id && draft.operationMode === "cancel"
      ? draft
      : null;
  const [mode, setMode] = useState<Mode>(
    savedDraft?.recoveryPending
      ? "move"
      : savedCancelDraft?.recoveryPending
        ? "cancel"
        : null,
  );
  const [uncertain, setUncertain] = useState(
    savedDraft?.recoveryPending === true,
  );
  const [cancelUncertain, setCancelUncertain] = useState(
    savedCancelDraft?.recoveryPending === true,
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
      : savedDraft?.recoveryKey) ?? createRecoveryKey();
  const submittedPayload = savedDraft?.submittedPayload ?? null;
  const cancelPayload = savedCancelDraft?.submittedPayload ?? null;
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
  const recoveryPending = uncertain || cancelUncertain;

  function update(patch: Partial<Values>) {
    if (uncertain) return;
    const next = { ...values, ...patch };
    if (
      patch.serviceId &&
      !choices.services
        .find((item) => item.id === patch.serviceId)
        ?.barberIds.includes(next.barberId)
    )
      next.barberId = "";
    setValues(next);
    setDraft({
      values: next,
      baseline,
      recoveryKey,
      submittedPayload,
      appointmentId: appointment.id,
      operationMode: "move",
    });
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
    setDraft({
      values,
      baseline,
      recoveryKey,
      submittedPayload: serialized,
      appointmentId: appointment.id,
      operationMode: "move",
    });
    setBusy(true);
    setError("");
    try {
      const result = await moveOwnerBookingAction(payload);
      if (!result.success) {
        if (draft) setDraft({ ...draft, recoveryPending: false });
        setError(result.error.message);
        return;
      }
      clearDraft();
      setUncertain(false);
      setCancelUncertain(false);
      setMode(null);
      router.refresh();
    } catch {
      setDraft({
        values,
        baseline,
        recoveryKey,
        submittedPayload: serialized,
        appointmentId: appointment.id,
        operationMode: "move",
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

  async function retryMove() {
    if (!submittedPayload || busy) return;
    setBusy(true);
    try {
      const result = await moveOwnerBookingAction(JSON.parse(submittedPayload));
      if (!result.success) {
        if (draft) setDraft({ ...draft, recoveryPending: false });
        setError(result.error.message);
        return;
      }
      clearDraft();
      setUncertain(false);
      setCancelUncertain(false);
      setMode(null);
      router.refresh();
    } catch {
      if (draft) setDraft({ ...draft, recoveryPending: true });
      setError("Recovery is still unavailable. Retry the same operation.");
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
    setDraft({
      values,
      baseline,
      recoveryKey,
      submittedPayload: JSON.stringify(payload),
      appointmentId: appointment.id,
      operationMode: "cancel",
    });
    setBusy(true);
    setError("");
    try {
      const result = await cancelOwnerBookingAction(payload);
      if (!result.success) {
        if (draft) setDraft({ ...draft, recoveryPending: false });
        setError(result.error.message);
        return;
      }
      clearDraft();
      setUncertain(false);
      setCancelUncertain(false);
      setMode(null);
      router.refresh();
    } catch {
      setDraft({
        values,
        baseline,
        recoveryKey,
        submittedPayload: JSON.stringify(payload),
        appointmentId: appointment.id,
        operationMode: "cancel",
        recoveryPending: true,
      });
      setCancelUncertain(true);
      setError(
        "The response was interrupted. Retry cancellation to recover its result.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryCancel() {
    if (!cancelPayload || busy) return;
    setBusy(true);
    try {
      const result = await cancelOwnerBookingAction(JSON.parse(cancelPayload));
      if (!result.success) {
        if (draft) setDraft({ ...draft, recoveryPending: false });
        setError(result.error.message);
        return;
      }
      clearDraft();
      setUncertain(false);
      setCancelUncertain(false);
      setMode(null);
      router.refresh();
    } catch {
      if (draft) setDraft({ ...draft, recoveryPending: true });
      setError("Recovery is still unavailable. Retry the same operation.");
    } finally {
      setBusy(false);
    }
  }

  if (!canChange && !recoveryPending) return null;

  return (
    <>
      {canChange && !recoveryPending && (
        <div className="flex flex-wrap gap-2" aria-label="Appointment actions">
          <Button variant="outline" onClick={() => setMode("move")}>
            Move appointment
          </Button>
          <Button variant="destructive" onClick={() => setMode("cancel")}>
            Cancel appointment
          </Button>
        </div>
      )}
      {recoveryPending && mode === null && (
        <Button
          variant="outline"
          onClick={() => setMode(uncertain ? "move" : "cancel")}
        >
          Recover pending operation
        </Button>
      )}
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setMode(null);
            setError("");
          }
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
              onUpdate={update}
              onSubmit={submitMove}
              onRetry={retryMove}
              onReloadSaved={() => setReloadConfirmation(true)}
              onReviewCurrentOffer={() => {
                setDraft({
                  values,
                  baseline,
                  recoveryKey: createRecoveryKey(),
                  submittedPayload: null,
                  appointmentId: appointment.id,
                  operationMode: "move",
                });
                setMode(null);
                router.refresh();
              }}
            />
          ) : (
            <AppointmentCancelDialogContent
              error={error}
              busy={busy}
              uncertain={cancelUncertain}
              onRetry={retryCancel}
              onKeep={() => setMode(null)}
              onConfirm={cancel}
            />
          )}
        </DialogContent>
      </Dialog>
      <OwnerDiscardDialog
        open={reloadConfirmation}
        onKeepEditing={() => setReloadConfirmation(false)}
        onDiscard={() => {
          clearDraft();
          setMode(null);
          setReloadConfirmation(false);
          router.refresh();
        }}
      />
    </>
  );
}
