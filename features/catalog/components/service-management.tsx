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
import { OwnerArchiveDialog } from "@/components/owner-archive-dialog";
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
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceView | null | undefined>(
    undefined,
  );
  const closeEditor = useCallback((open: boolean) => {
    if (!open) setEditing(undefined);
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
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div aria-label="Service filters" className="flex flex-wrap gap-2">
          {["All", "Offered", "Hidden", "Archived"].map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {value}
            </Button>
          ))}
        </div>
        <Button onClick={() => setEditing(null)}>Add service</Button>
      </div>
      {status && (
        <p role="status" className="mt-4">
          {status}
        </p>
      )}
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
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {visible.map((service) => (
            <article key={service.id} className="min-w-0 rounded-xl border p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-heading text-xl font-semibold">
                    {service.name}
                  </h2>
                  <p className="mt-2">
                    ${service.priceUsd} · {service.durationMinutes} min
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {service.archived
                      ? "Archived"
                      : service.offered
                        ? "Offered"
                        : "Hidden"}{" "}
                    · {service.barberIds.length} eligible barbers
                  </p>
                </div>
              </div>
              {!service.archived && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setEditing(service)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setPending(true);
                      void setServiceOfferedAction(service.id, !service.offered)
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
                        .finally(() => setPending(false));
                    }}
                  >
                    {service.offered ? "Hide service" : "Offer service"}
                  </Button>
                  <Button
                    variant="destructive"
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
          ))}
        </div>
      )}
      {editing !== undefined && (
        <ServiceDialog
          key={editing?.id ?? "new"}
          service={editing ?? undefined}
          open
          onOpenChange={closeEditor}
          barbers={activeBarbers}
        />
      )}
      {archiveTarget && (
        <OwnerArchiveDialog
          resourceType="service"
          resourceName={archiveTarget.name}
          error={archiveError}
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
                  setArchiveError(result.error.message);
                }
              })
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
  barbers,
}: {
  service?: ServiceView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbers: BarberView[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveServiceAction, null);
  const [dirty, setDirty] = useState(false);
  const [values, setValues] = useState({
    name: service?.name ?? "",
    priceUsd: service?.priceUsd ?? "",
    durationMinutes: service?.durationMinutes ?? "30",
    offered: service?.offered ?? true,
    barberIds: service?.barberIds ?? [],
  });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) {
      onOpenChange(false);
      router.refresh();
    } else if (state && !state.success && state.fieldErrors) {
      form.current
        ?.querySelector<HTMLElement>("[aria-invalid='true']")
        ?.focus();
    }
  }, [state, onOpenChange, router]);
  const errors = state && !state.success ? state.fieldErrors : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (
          !next &&
          (pending || (dirty && !window.confirm("Discard unsaved changes?")))
        )
          return;
        onOpenChange(next);
        if (!next) setDirty(false);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "Add service"}</DialogTitle>
          <DialogDescription>
            Price and duration are shared by every assigned barber.
          </DialogDescription>
        </DialogHeader>
        <form
          ref={form}
          action={action}
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
            error={errors?.name?.[0]}
          />
          <Field
            name="priceUsd"
            label="Price (USD)"
            value={values.priceUsd}
            onChange={(priceUsd) =>
              setValues((current) => ({ ...current, priceUsd }))
            }
            error={errors?.priceUsd?.[0]}
          />
          <Field
            name="durationMinutes"
            label="Duration in minutes"
            value={values.durationMinutes}
            onChange={(durationMinutes) =>
              setValues((current) => ({ ...current, durationMinutes }))
            }
            error={errors?.durationMinutes?.[0]}
          />
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name="offered"
              value="true"
              checked={values.offered}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  offered: event.currentTarget.checked,
                }))
              }
              className="size-4"
            />{" "}
            Offered to customers
          </label>
          <fieldset className="grid gap-2">
            <legend className="font-medium">Eligible barbers</legend>
            {barbers.length ? (
              barbers.map((barber) => (
                <label
                  key={barber.id}
                  className="flex min-h-11 items-center gap-3"
                >
                  <Checkbox
                    name="barberIds"
                    value={barber.id}
                    checked={values.barberIds.includes(barber.id)}
                    onCheckedChange={(checked) =>
                      setValues((current) => ({
                        ...current,
                        barberIds:
                          checked === true
                            ? [...current.barberIds, barber.id]
                            : current.barberIds.filter(
                                (id) => id !== barber.id,
                              ),
                      }))
                    }
                  />
                  <span>{barber.name}</span>
                </label>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No active barbers yet. You can save without assignments.
              </p>
            )}
          </fieldset>
          {state && !state.success && <p role="alert">{state.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  error,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
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
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
