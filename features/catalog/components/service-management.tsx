"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  archiveServiceAction,
  saveServiceAction,
  setServiceOfferedAction,
} from "../actions";
import type { ServiceView, BarberView } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClockIcon } from "lucide-react";
import type { ActionError, ActionResult } from "@/lib/action-result";
import { OwnerArchiveDialog } from "@/components/owner-archive-dialog";
import { BookingConflictList } from "@/components/booking-conflict-list";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function ServiceManagement({
  services,
  barbers,
}: {
  services: ServiceView[];
  barbers: BarberView[];
}) {
  const [filter, setFilter] = useState("All");
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ServiceView | null>(null);
  const [archiveError, setArchiveError] = useState<ActionError | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceView | null | undefined>(
    undefined,
  );
  const closeEditor = useCallback((open: boolean) => {
    if (!open) setEditing(undefined);
  }, []);
  const saved = useCallback(() => {
    setEditing(undefined);
    setStatus("Service details saved. The sample description was not saved.");
  }, []);
  const activeBarbers = barbers.filter((barber) => !barber.archived);
  const visible = services.filter(
    (service) =>
      filter === "All" ||
      (filter === "Offered" && !service.archived && service.offered) ||
      (filter === "Hidden" && !service.archived && !service.offered) ||
      (filter === "Archived" && service.archived),
  );
  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div
          aria-label="Service filters"
          className="grid grid-cols-2 gap-1 rounded-2xl border bg-muted p-1 min-[480px]:flex min-[480px]:rounded-full"
        >
          {["All", "Offered", "Hidden", "Archived"].map((value) => {
            const count =
              value === "All"
                ? services.length
                : value === "Offered"
                  ? services.filter((item) => !item.archived && item.offered)
                      .length
                  : value === "Hidden"
                    ? services.filter((item) => !item.archived && !item.offered)
                        .length
                    : services.filter((item) => item.archived).length;
            return (
              <Button
                key={value}
                type="button"
                variant="ghost"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className="rounded-full aria-pressed:bg-background aria-pressed:shadow-xs"
              >
                {value} ({count})
              </Button>
            );
          })}
        </div>
        <Button
          onClick={() => {
            setStatus("");
            setEditing(null);
          }}
        >
          Add service
        </Button>
      </div>
      <p
        role="status"
        aria-atomic="true"
        className={status ? "mt-4" : "sr-only"}
      >
        {status}
      </p>
      {services.length === 0 ? (
        <p className="mt-8 rounded-xl border p-8">
          No services yet. Add a service to start building your catalog.
        </p>
      ) : visible.length === 0 ? (
        <div className="mt-8 rounded-xl border p-8">
          <p>No {filter.toLowerCase()} services.</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setFilter("All")}
          >
            Return to All
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {visible.map((service) => {
            const eligibleBarbers = barbers.filter(
              (barber) =>
                !barber.archived && service.barberIds.includes(barber.id),
            );
            return (
              <article
                key={service.id}
                className="flex min-w-0 flex-col rounded-[20px] border p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 flex-1 break-words font-heading text-xl font-semibold">
                    {service.name}
                  </h2>
                  <Badge
                    variant={
                      service.archived
                        ? "outline"
                        : service.offered
                          ? "success"
                          : "warning"
                    }
                  >
                    {service.archived
                      ? "Archived"
                      : service.offered
                        ? "Offered"
                        : "Hidden"}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 tabular-nums">
                  <p className="min-w-0 break-all font-heading text-3xl font-bold">
                    ${service.priceUsd}
                  </p>
                  <Badge
                    variant="outline"
                    className="h-auto max-w-full whitespace-normal bg-muted py-1"
                  >
                    <ClockIcon aria-hidden="true" />
                    {service.durationMinutes} min
                  </Badge>
                </div>
                <div className="mt-4 min-h-12">
                  <p className="text-sm text-muted-foreground">
                    {sampleServiceDescription(service.name)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sample description · preview only
                  </p>
                </div>
                <div className="my-5 border-y py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {eligibleBarbers.length} eligible barbers
                  </p>
                  {eligibleBarbers.length ? (
                    <ul
                      aria-label="Eligible barbers"
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      {eligibleBarbers.map((barber) => (
                        <li key={barber.id} className="min-w-0 max-w-full">
                          <Badge
                            variant="outline"
                            className="h-auto max-w-full whitespace-normal break-words bg-muted py-1"
                          >
                            <span
                              aria-hidden="true"
                              className="grid size-4 shrink-0 place-items-center rounded-full border bg-background text-[10px] font-semibold"
                            >
                              {barber.name.trim().charAt(0).toUpperCase()}
                            </span>
                            {barber.name}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No eligible barbers.
                    </p>
                  )}
                </div>
                {!service.archived && (
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatus("");
                        setEditing(service);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setPending(true);
                        void setServiceOfferedAction(
                          service.id,
                          !service.offered,
                        )
                          .then((result) => {
                            setStatus(
                              result.success
                                ? service.offered
                                  ? "Service hidden."
                                  : "Service offered."
                                : result.error.message,
                            );
                            if (result.success) router.refresh();
                          })
                          .catch(() =>
                            setStatus(
                              "Could not confirm the update. Check your connection and try again.",
                            ),
                          )
                          .finally(() => setPending(false));
                      }}
                    >
                      {service.offered ? "Hide service" : "Offer service"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="ml-auto"
                      disabled={pending}
                      onClick={() => {
                        setArchiveError(null);
                        setArchiveTarget(service);
                      }}
                    >
                      Archive
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing !== undefined && (
        <ServiceDialog
          key={editing?.id ?? "new"}
          service={editing ?? undefined}
          open
          onOpenChange={closeEditor}
          onSaved={saved}
          barbers={activeBarbers}
          discardOpen={discardOpen}
          setDiscardOpen={setDiscardOpen}
        />
      )}
      {archiveTarget && (
        <OwnerArchiveDialog
          resourceType="service"
          resourceName={archiveTarget.name}
          error={archiveError?.message ?? null}
          bookingConflicts={archiveError?.bookingConflicts}
          pending={pending}
          onOpenChange={(open) => {
            if (!open && !pending) {
              setArchiveTarget(null);
              setArchiveError(null);
            }
          }}
          onConfirm={() => {
            setPending(true);
            void archiveServiceAction(archiveTarget.id)
              .then((result) => {
                if (result.success) {
                  setArchiveTarget(null);
                  setArchiveError(null);
                  setStatus("Service archived.");
                  router.refresh();
                } else {
                  setArchiveError(result.error);
                }
              })
              .catch(() =>
                setArchiveError({
                  message:
                    "Could not confirm the archive. Check your connection and try again.",
                }),
              )
              .finally(() => setPending(false));
          }}
        />
      )}
    </>
  );
}

function ServiceDialog({
  service,
  open,
  onOpenChange,
  onSaved,
  barbers,
  discardOpen,
  setDiscardOpen,
}: {
  service?: ServiceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  barbers: BarberView[];
  discardOpen: boolean;
  setDiscardOpen: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    ActionResult<ServiceView> | null,
    FormData
  >(async (previous, formData) => {
    try {
      return await saveServiceAction(previous, formData);
    } catch {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message:
            "Could not confirm the save. Your input is still here. Check your connection and try again.",
        },
      };
    }
  }, null);
  const [dirty, setDirty] = useState(false);
  const [values, setValues] = useState({
    name: service?.name ?? "",
    priceUsd: service?.priceUsd ?? "",
    durationMinutes: service?.durationMinutes ?? "30",
    offered: service?.offered ?? true,
    barberIds: service?.barberIds ?? [],
  });
  const [description, setDescription] = useState(
    service
      ? sampleServiceDescription(service.name)
      : "A polished finish with a consultation tailored to your style.",
  );
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) {
      onSaved();
      router.refresh();
    } else if (state && !state.success && state.fieldErrors) {
      form.current
        ?.querySelector<HTMLElement>("[aria-invalid='true']")
        ?.focus();
    }
  }, [state, onSaved, router]);
  const errors = state && !state.success ? state.fieldErrors : undefined;
  const requestClose = () => {
    if (pending) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
    setDirty(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader className="border-b pb-5">
          <DialogTitle className="text-xl">
            {service ? "Edit service" : "Add service"}
          </DialogTitle>
          <DialogDescription>
            Set a shared price and duration, choose eligible barbers, and
            control whether customers can book this service.
          </DialogDescription>
        </DialogHeader>
        <form
          ref={form}
          action={action}
          onReset={(event) => event.preventDefault()}
          noValidate
          onChange={() => setDirty(true)}
          className="grid gap-4"
        >
          {service && <input type="hidden" name="id" value={service.id} />}
          <Field
            name="name"
            label="Service name"
            value={values.name}
            onChange={(name) => setValues((current) => ({ ...current, name }))}
            hint="Shown to customers on the public booking page and manage links."
            error={errors?.name?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="priceUsd"
              label="Price (USD)"
              value={values.priceUsd}
              onChange={(priceUsd) =>
                setValues((current) => ({ ...current, priceUsd }))
              }
              hint="Shared price across all eligible barbers."
              error={errors?.priceUsd?.[0]}
            />
            <Field
              name="durationMinutes"
              label="Duration in minutes"
              value={values.durationMinutes}
              onChange={(durationMinutes) =>
                setValues((current) => ({ ...current, durationMinutes }))
              }
              hint="Whole minutes (min 30). No separate buffers."
              error={errors?.durationMinutes?.[0]}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="service-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (sample preview)
              </span>
            </Label>
            <Textarea
              id="service-description"
              value={description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setDirty(true);
              }}
              rows={3}
              className="min-h-20"
            />
            <p className="text-xs text-muted-foreground">
              Illustrative copy only. This description is not saved with the
              service.
            </p>
          </div>
          <fieldset className="grid gap-2">
            <legend className="font-medium">Eligible barbers</legend>
            <p className="text-sm text-muted-foreground">
              Choose every barber who can provide this service.
            </p>
            {barbers.length ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {barbers.map((barber) => (
                  <label
                    key={barber.id}
                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border bg-muted/50 p-3"
                  >
                    <Checkbox
                      name="barberIds"
                      value={barber.id}
                      checked={values.barberIds.includes(barber.id)}
                      onCheckedChange={(checked) => {
                        setValues((current) => ({
                          ...current,
                          barberIds:
                            checked === true
                              ? [...current.barberIds, barber.id]
                              : current.barberIds.filter(
                                  (id) => id !== barber.id,
                                ),
                        }));
                        setDirty(true);
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="grid size-5 shrink-0 place-items-center rounded-full border bg-background text-xs"
                    >
                      {barber.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 break-words">{barber.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active barbers yet. You can save without assignments.
              </p>
            )}
          </fieldset>
          <label className="flex min-h-12 flex-row-reverse items-center gap-3 rounded-xl border bg-muted/50 p-3">
            <Switch
              id="service-offered"
              name="offered"
              value="true"
              checked={values.offered}
              onCheckedChange={(offered) => {
                setValues((current) => ({ ...current, offered }));
                setDirty(true);
              }}
              aria-label="Offered to customers"
            />
            <span className="mr-auto grid gap-0.5">
              <span className="font-medium">Offered to customers</span>
              <span className="text-xs text-muted-foreground">
                When disabled, the service is hidden from public view but
                existing bookings remain valid.
              </span>
            </span>
          </label>
          {state && !state.success && (
            <>
              <p role="alert">{state.error.message}</p>
              <BookingConflictList
                conflicts={state.error.bookingConflicts ?? []}
              />
            </>
          )}
          <DialogFooter className="border-t pt-4 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={requestClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <OwnerDiscardDialog
        open={discardOpen}
        onKeepEditing={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false);
          setDirty(false);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  error,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
}) {
  const id = `service-${name}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const serviceDescriptions = new Map([
  [
    "Classic cut",
    "Full precision haircut with consultation, rinse, and styled finish.",
  ],
  [
    "Beard tidy",
    "Beard sculpting, clean neckline trim, and conditioning oil treatment.",
  ],
  [
    "Cut & beard",
    "Signature full haircut paired with hot towel beard shaping.",
  ],
]);

function sampleServiceDescription(name: string) {
  return (
    serviceDescriptions.get(name) ??
    `A polished ${name.toLowerCase()} with a consultation and a clean, finished look.`
  );
}
