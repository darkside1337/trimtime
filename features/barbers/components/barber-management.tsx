"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { archiveBarberAction, saveBarberAction } from "../actions";
import type { BarberView, ServiceView } from "@/features/catalog/types";
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

export function BarberManagement({
  barbers,
  services,
}: {
  barbers: BarberView[];
  services: ServiceView[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("All");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<BarberView | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BarberView | null | undefined>(
    undefined,
  );
  const closeEditor = useCallback((open: boolean) => {
    if (!open) setEditing(undefined);
  }, []);
  const activeServices = services.filter((service) => !service.archived);
  const visible = barbers.filter(
    (barber) =>
      filter === "All" ||
      (filter === "Active" && !barber.archived) ||
      (filter === "Archived" && barber.archived),
  );
  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div aria-label="Barber filters" className="flex gap-2">
          {["All", "Active", "Archived"].map((value) => (
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
        <Button onClick={() => setEditing(null)}>Add barber</Button>
      </div>
      {status && (
        <p role="status" className="mt-4">
          {status}
        </p>
      )}
      {barbers.length === 0 ? (
        <p className="mt-8 rounded-xl border p-8">
          No barbers yet. Add a barber to set eligibility.
        </p>
      ) : visible.length === 0 ? (
        <div className="mt-8 rounded-xl border p-8">
          <p>No {filter.toLowerCase()} barbers.</p>
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
          {visible.map((barber) => (
            <article key={barber.id} className="rounded-xl border p-5">
              <h2 className="break-words font-heading text-xl font-semibold">
                {barber.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {barber.archived ? "Archived" : "Active"} ·{" "}
                {barber.serviceIds.length} eligible services
              </p>
              {!barber.archived && (
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" onClick={() => setEditing(barber)}>
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      setArchiveError(null);
                      setArchiveTarget(barber);
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
        <BarberDialog
          key={editing?.id ?? "new"}
          barber={editing ?? undefined}
          open
          onOpenChange={closeEditor}
          services={activeServices}
        />
      )}
      {archiveTarget && (
        <OwnerArchiveDialog
          resourceType="barber"
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
            void archiveBarberAction(archiveTarget.id)
              .then((result) => {
                if (result.success) {
                  setArchiveTarget(null);
                  setArchiveError(null);
                  setStatus("Barber archived.");
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

function BarberDialog({
  barber,
  open,
  onOpenChange,
  services,
}: {
  barber?: BarberView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceView[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveBarberAction, null);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState(barber?.name ?? "");
  const [serviceIds, setServiceIds] = useState(barber?.serviceIds ?? []);
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{barber ? "Edit barber" : "Add barber"}</DialogTitle>
          <DialogDescription>
            Choose the services this barber is eligible to provide.
          </DialogDescription>
        </DialogHeader>
        <form
          ref={form}
          action={action}
          noValidate
          onChange={() => setDirty(true)}
          className="grid gap-4"
        >
          {barber && <input type="hidden" name="id" value={barber.id} />}
          <div className="grid gap-2">
            <Label htmlFor="barber-name">Barber name</Label>
            <Input
              id="barber-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              aria-invalid={Boolean(errors?.name)}
              aria-describedby={errors?.name ? "barber-name-error" : undefined}
            />
            {errors?.name?.[0] && (
              <p id="barber-name-error" className="text-sm text-destructive">
                {errors.name[0]}
              </p>
            )}
          </div>
          <fieldset className="grid gap-2">
            <legend className="font-medium">Eligible services</legend>
            {services.length ? (
              services.map((service) => (
                <label
                  key={service.id}
                  className="flex min-h-11 items-center gap-3"
                >
                  <Checkbox
                    name="serviceIds"
                    value={service.id}
                    checked={serviceIds.includes(service.id)}
                    onCheckedChange={(checked) =>
                      setServiceIds((current) =>
                        checked === true
                          ? [...current, service.id]
                          : current.filter((id) => id !== service.id),
                      )
                    }
                  />
                  <span>
                    {service.name} · ${service.priceUsd} ·{" "}
                    {service.durationMinutes} min
                  </span>
                </label>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No active services yet. You can save without assignments.
              </p>
            )}
          </fieldset>
          {state && !state.success && <p role="alert">{state.error.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save barber"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
