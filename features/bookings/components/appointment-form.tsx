"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createOwnerBookingAction } from "../actions";
import { fixedBookingPrice } from "../money";
import { resolveOwnerStartChoices } from "../time";
import type { OwnerAppointmentChoices } from "../types";
import { ownerEmailStatusCopy } from "@/features/notifications/customer-summary";
import {
  useOwnerAppointmentDraft,
  type OwnerAppointmentDraftValues,
} from "./owner-calendar-context";
import { useAppointmentDismissal } from "../hooks/use-appointment-dismissal";
import { createRecoveryKey } from "./recovery-key";

type Values = OwnerAppointmentDraftValues;

type Props = {
  choices: OwnerAppointmentChoices;
  initialDate: string;
  initialTime?: string;
  initialBarberId?: string;
  calendarHref: string;
  dialog?: boolean;
};

export function AppointmentForm(props: Props) {
  const { formGeneration } = useOwnerAppointmentDraft();
  return (
    <AppointmentFormContent
      key={`${formGeneration}|${props.initialDate}|${props.initialTime ?? ""}|${props.initialBarberId ?? ""}`}
      {...props}
    />
  );
}

function AppointmentFormContent({
  choices,
  initialDate,
  initialTime = "",
  initialBarberId = "",
  calendarHref,
  dialog = false,
}: Props) {
  const router = useRouter();
  const { draft, setDraft, clearDraft } = useOwnerAppointmentDraft();
  const { requestClose, requestNavigation } = useAppointmentDismissal();
  const initialValues: Values = {
    customerName: "",
    email: "",
    phone: "",
    whatsappOptIn: false,
    serviceId: "",
    barberId: initialBarberId === "all" ? "" : initialBarberId,
    date: initialDate,
    time: initialTime,
    occurrence: "",
  };
  const baseline = useRef<Values>(draft?.baseline ?? initialValues);
  const recovery = useRef<{ key: string; submitted: string | null }>({
    key: draft?.recoveryKey ?? createRecoveryKey(),
    submitted: draft?.submittedPayload ?? null,
  });
  const [values, setValues] = useState<Values>(
    () => draft?.values ?? initialValues,
  );
  const valuesRef = useRef(values);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    if (Object.keys(fieldErrors).length)
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    else if (error) errorRef.current?.focus();
  }, [error, fieldErrors]);
  const selectedService = choices.services.find(
    (service) => service.id === values.serviceId,
  );
  const eligibleBarbers = selectedService
    ? choices.barbers.filter((barber) =>
        selectedService.barberIds.includes(barber.id),
      )
    : choices.barbers;
  const startChoices = useMemo(
    () => resolveOwnerStartChoices(values.date, values.time, choices.timeZone),
    [values.date, values.time, choices.timeZone],
  );
  const selectedChoice =
    startChoices.find((choice) => choice.startAt === values.occurrence) ??
    (startChoices.length === 1 ? startChoices[0] : undefined);

  function update(patch: Partial<Values>) {
    const next = { ...valuesRef.current, ...patch };
    if (
      patch.serviceId !== undefined &&
      next.barberId &&
      !choices.services
        .find((service) => service.id === patch.serviceId)
        ?.barberIds.includes(next.barberId)
    )
      next.barberId = "";
    valuesRef.current = next;
    setValues(next);
    setDraft({
      values: next,
      baseline: baseline.current,
      recoveryKey: recovery.current.key,
      submittedPayload: recovery.current.submitted,
    });
    setError("");
    setErrorCode(null);
    setFieldErrors({});
    setSavedMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!selectedService || !values.barberId || !selectedChoice) {
      setError(
        startChoices.length === 0 && values.time
          ? "That local time does not exist because of a clock change. Choose another minute."
          : startChoices.length > 1 && !values.occurrence
            ? "Choose which occurrence of this repeated local time you mean."
            : "Choose a service, eligible barber, date, and exact start minute.",
      );
      return;
    }
    const payload = {
      serviceId: selectedService.id,
      barberId: values.barberId,
      startAt: selectedChoice.startAt,
      reviewedOffer: {
        name: selectedService.name,
        priceUsd: fixedBookingPrice(selectedService.priceUsd),
        durationMinutes: String(selectedService.durationMinutes),
      },
      contact: {
        name: values.customerName,
        ...(values.email.trim() ? { email: values.email.trim() } : {}),
        ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
        whatsappOptIn: values.whatsappOptIn,
      },
      recoveryKey: recovery.current.key,
    };
    const serialized = JSON.stringify({ ...payload, recoveryKey: undefined });
    if (
      recovery.current.submitted !== null &&
      recovery.current.submitted !== serialized
    )
      recovery.current.key = createRecoveryKey();
    payload.recoveryKey = recovery.current.key;
    recovery.current.submitted = serialized;
    setDraft({
      values,
      baseline: baseline.current,
      recoveryKey: recovery.current.key,
      submittedPayload: recovery.current.submitted,
    });
    setSubmitting(true);
    setError("");
    try {
      const result = await createOwnerBookingAction(payload);
      if (!result.success) {
        setError(result.error.message);
        setErrorCode(result.error.code ?? null);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      const emailCopy = values.email.trim()
        ? ownerEmailStatusCopy(result.data.notifications.email)
        : "No email provided · No email confirmation will be sent.";
      setSavedMessage(`Appointment saved. ${emailCopy}`);
      setErrorCode(null);
      recovery.current.key = createRecoveryKey();
      recovery.current.submitted = null;
      clearDraft();
      const destination = new URL(calendarHref, window.location.origin);
      destination.searchParams.set("created", result.data.bookingId);
      router.push(`${destination.pathname}${destination.search}`);
      router.refresh();
    } catch {
      setError(
        "The save response was interrupted. Retry the same details to recover the saved appointment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const foldNeedsChoice = startChoices.length > 1;
  const localLabel = selectedChoice
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(`${values.date}T${values.time}:00Z`))
    : values.time || "—";
  const summaryEnd =
    selectedService && selectedChoice
      ? new Date(
          Date.parse(selectedChoice.startAt) +
            selectedService.durationMinutes * 60_000,
        ).toISOString()
      : "";

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 max-[640px]:px-4 max-[640px]:py-4">
      {!dialog && (
        <div className="mb-5 flex justify-between">
          <Button
            variant="outline"
            onClick={() => requestNavigation(calendarHref)}
          >
            Back to calendar
          </Button>
          <span className="text-xs font-bold uppercase tracking-[.1em] text-[var(--success)]">
            Owner appointment entry
          </span>
        </div>
      )}
      <header className="mb-6 max-w-xl">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          New appointment
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manual entry for a walk-in or phone booking. Supports exact
          whole-minute starts for ongoing or future slots. Duration and USD
          price come from the selected service.
        </p>
      </header>
      {error && (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}
      {errorCode === "STALE_OFFER" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-sm">
          <span>
            Review the current offered service price and duration before saving
            again.
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.refresh()}
          >
            Review current service details
          </Button>
        </div>
      )}
      {savedMessage && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-border bg-secondary px-4 py-3 text-sm"
        >
          {savedMessage}
        </p>
      )}
      <form
        ref={formRef}
        onSubmit={submit}
        className={`grid items-start gap-6 [&_input:not([type=checkbox])]:min-h-11 [&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:rounded-xl [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-border [&_input:not([type=checkbox])]:bg-background [&_input:not([type=checkbox])]:px-3 [&_input:not([type=checkbox])]:text-sm [&_input:not([type=checkbox])]:font-normal [&_select]:min-h-11 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-border [&_select]:bg-background [&_select]:px-3 [&_select]:text-sm [&_select]:font-normal ${dialog ? "grid-cols-1" : "min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]"}`}
      >
        <div className="grid gap-6 rounded-3xl border border-border bg-background p-6 shadow-sm max-[520px]:p-5">
          <section
            className="grid gap-4"
            aria-labelledby="customer-info-heading"
          >
            <h2
              id="customer-info-heading"
              className="border-b border-border pb-3 text-base font-semibold"
            >
              Customer information
            </h2>
            <Field
              label="Customer name"
              required
              error={fieldErrors.customerName?.[0]}
            >
              <input
                name="customerName"
                autoComplete="name"
                required
                aria-invalid={Boolean(fieldErrors.customerName?.length)}
                aria-describedby={
                  fieldErrors.customerName?.length
                    ? "field-error-customer-name"
                    : undefined
                }
                value={values.customerName}
                onChange={(event) =>
                  update({ customerName: event.target.value })
                }
                placeholder="e.g. Marcus Vance"
              />
            </Field>
            <div className="grid gap-3 min-[521px]:grid-cols-2">
              <Field
                label="Customer email (optional)"
                error={fieldErrors.email?.[0]}
              >
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email?.length)}
                  aria-describedby={
                    fieldErrors.email?.length ? "field-error-email" : undefined
                  }
                  value={values.email}
                  onChange={(event) => update({ email: event.target.value })}
                  placeholder="customer@example.com"
                />
              </Field>
              <Field
                label="Customer phone (optional)"
                error={fieldErrors.phone?.[0]}
              >
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  aria-invalid={Boolean(fieldErrors.phone?.length)}
                  aria-describedby={
                    fieldErrors.phone?.length ? "field-error-phone" : undefined
                  }
                  value={values.phone}
                  onChange={(event) => update({ phone: event.target.value })}
                  placeholder="+1 (555) 012-3456"
                />
              </Field>
            </div>
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              {values.email.trim()
                ? "Customer confirmation status will reflect local capture only."
                : "No email provided · No email confirmation will be sent."}
            </p>
            {(values.phone.trim() || values.whatsappOptIn) && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={values.whatsappOptIn}
                  onCheckedChange={(checked) =>
                    update({ whatsappOptIn: checked === true })
                  }
                />
                <span>
                  {values.phone.trim()
                    ? "Customer explicitly opted in to WhatsApp updates. WhatsApp delivery is currently unavailable."
                    : "A phone number is required to keep WhatsApp consent; uncheck this box or add a phone number."}
                </span>
              </label>
            )}
          </section>
          <section
            className="grid gap-4"
            aria-labelledby="booking-details-heading"
          >
            <h2
              id="booking-details-heading"
              className="border-b border-border pb-3 text-base font-semibold"
            >
              Booking &amp; schedule details
            </h2>
            <div className="grid items-start gap-3 min-[521px]:grid-cols-2">
              <Field
                label="Service"
                required
                error={fieldErrors.serviceId?.[0]}
              >
                <select
                  required
                  aria-invalid={Boolean(fieldErrors.serviceId?.length)}
                  aria-describedby={
                    fieldErrors.serviceId?.length
                      ? "field-error-service"
                      : undefined
                  }
                  value={values.serviceId}
                  onChange={(event) =>
                    update({ serviceId: event.target.value })
                  }
                >
                  <option value="">Choose a service…</option>
                  {choices.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} · ${service.priceUsd}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Barber" required error={fieldErrors.barberId?.[0]}>
                <select
                  required
                  aria-invalid={Boolean(fieldErrors.barberId?.length)}
                  aria-describedby={
                    fieldErrors.barberId?.length
                      ? "field-error-barber"
                      : undefined
                  }
                  value={values.barberId}
                  onChange={(event) => update({ barberId: event.target.value })}
                  disabled={!eligibleBarbers.length}
                >
                  <option value="">Choose an eligible barber…</option>
                  {eligibleBarbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date" required>
                <input
                  name="date"
                  type="date"
                  required
                  value={values.date}
                  onChange={(event) =>
                    update({ date: event.target.value, occurrence: "" })
                  }
                />
              </Field>
              <Field label="Start time" required error={fieldErrors.time?.[0]}>
                <input
                  name="time"
                  type="time"
                  step={60}
                  required
                  aria-invalid={Boolean(fieldErrors.time?.length)}
                  aria-describedby={
                    fieldErrors.time?.length ? "field-error-time" : undefined
                  }
                  value={values.time}
                  onChange={(event) =>
                    update({ time: event.target.value, occurrence: "" })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Exact whole-minute entry permitted (e.g. 10:14).
                </span>
              </Field>
            </div>
            {foldNeedsChoice && (
              <Field label="Repeated local time" required>
                <select
                  required
                  value={values.occurrence}
                  onChange={(event) =>
                    update({ occurrence: event.target.value })
                  }
                >
                  <option value="">Choose one occurrence…</option>
                  {startChoices.map((choice) => (
                    <option key={choice.startAt} value={choice.startAt}>
                      {choice.offset} UTC offset · {choice.startAt}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {values.time && startChoices.length === 0 && (
              <p className="text-sm text-muted-foreground" role="status">
                This local minute does not exist in {choices.timeZone} because
                the clock moves forward. Choose another minute.
              </p>
            )}
          </section>
        </div>
        <aside
          className="grid gap-4 rounded-3xl border border-border bg-muted p-6 max-[520px]:p-5"
          aria-label="Appointment summary"
        >
          <div>
            <h2 className="text-lg font-semibold">Appointment summary</h2>
            <p className="text-xs text-muted-foreground">
              Live derivation from form inputs
            </p>
          </div>
          <SummaryRow
            label="Service"
            value={selectedService?.name ?? "Not selected"}
          />
          <SummaryRow
            label="Barber"
            value={
              eligibleBarbers.find((barber) => barber.id === values.barberId)
                ?.name ?? "Not selected"
            }
          />
          <SummaryRow label="Date" value={values.date || "Not selected"} />
          <SummaryRow
            label="Time range"
            value={
              selectedChoice && summaryEnd
                ? `${localLabel}–${new Intl.DateTimeFormat("en-GB", { timeZone: choices.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(summaryEnd))}`
                : "—"
            }
          />
          <SummaryRow
            label="Duration"
            value={
              selectedService
                ? `${selectedService.durationMinutes} minutes`
                : "—"
            }
          />
          <SummaryRow label="Time zone" value={choices.timeZone} />
          <SummaryRow
            label="Notification"
            value={
              values.email.trim()
                ? "Email status shown after save"
                : values.phone.trim() && values.whatsappOptIn
                  ? "WhatsApp unavailable"
                  : "None"
            }
          />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <strong>Price (USD)</strong>
            <strong className="text-xl">
              ${selectedService?.priceUsd ?? "0.00"}
            </strong>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold">
              {selectedChoice
                ? "Ready to review"
                : foldNeedsChoice
                  ? "Choose occurrence"
                  : "Incomplete details"}
            </span>
            <p className="mt-2 text-xs text-muted-foreground">
              {selectedChoice
                ? "The server will verify current service, barber, schedule and availability before saving."
                : "Select a service, eligible barber, date and start time to verify schedule availability."}
            </p>
          </div>
        </aside>
        <div className="sticky bottom-0 z-10 col-span-full flex justify-between gap-3 border-t border-border bg-background p-4 max-[640px]:-mx-4 max-[640px]:shadow-[0_-8px_24px_rgb(0_0_0_/_0.08)] min-[641px]:rounded-b-2xl">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              dialog ? requestClose() : requestNavigation(calendarHref)
            }
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Create appointment"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const fieldId = {
    "Customer name": "customer-name",
    "Customer email (optional)": "email",
    "Customer phone (optional)": "phone",
    Service: "service",
    Barber: "barber",
    "Start time": "time",
  }[label];
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-semibold">
      {label}
      {required ? " *" : ""}
      {children}
      {error && fieldId && (
        <span
          id={`field-error-${fieldId}`}
          className="text-destructive"
          role="alert"
        >
          {error}
        </span>
      )}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-border pb-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}
