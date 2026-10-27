"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { archiveBarberAction, saveBarberAction } from "../actions";
import type { BarberView, ServiceView } from "@/features/catalog/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ActionResult } from "@/lib/action-result";
import { OwnerArchiveDialog } from "@/components/owner-archive-dialog";
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
import { PencilIcon } from "lucide-react";
import type { AvailabilityData } from "@/features/availability/queries";
import type { WeeklySchedule } from "@/features/availability/types";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function BarberManagement({
  barbers,
  services,
  schedules,
  timeZone,
}: {
  barbers: BarberView[];
  services: ServiceView[];
  schedules: AvailabilityData["barbers"];
  timeZone: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("All");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<BarberView | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [sampleActive, setSampleActive] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        barbers.map((barber) => [barber.id, !barber.archived]),
      ),
  );
  const [editing, setEditing] = useState<BarberView | null | undefined>(
    undefined,
  );
  const closeEditor = useCallback((open: boolean) => {
    if (!open) setEditing(undefined);
  }, []);
  const saved = useCallback(() => {
    setEditing(undefined);
    setStatus(
      "Barber name and service assignments saved. Sample specialty and active status were not saved.",
    );
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
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div
          aria-label="Barber filters"
          className="flex w-full flex-wrap gap-1 rounded-full border bg-muted p-1 min-[901px]:w-auto"
        >
          {["All", "Active", "Archived"].map((value) => {
            const count =
              value === "All"
                ? barbers.length
                : value === "Active"
                  ? barbers.filter((item) => !item.archived).length
                  : barbers.filter((item) => item.archived).length;
            return (
              <Button
                key={value}
                type="button"
                variant="ghost"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className="flex-1 rounded-full aria-pressed:bg-background aria-pressed:shadow-xs min-[901px]:flex-none"
              >
                {value} ({count})
              </Button>
            );
          })}
        </div>
        <Button
          className="w-full min-[901px]:w-auto"
          onClick={() => {
            setStatus("");
            setEditing(null);
          }}
        >
          Add barber
        </Button>
      </div>
      <p
        role="status"
        aria-atomic="true"
        className={status ? "mt-4" : "sr-only"}
      >
        {status}
      </p>
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
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {visible.map((barber) => {
            const assignedServiceCount = services.filter((service) =>
              barber.serviceIds.includes(service.id),
            ).length;
            return (
              <article
                key={barber.id}
                className="flex min-w-0 flex-col rounded-[20px] border p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-12 shrink-0 place-items-center rounded-full border bg-muted font-heading text-lg font-semibold"
                    >
                      {barber.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h2 className="break-words font-heading text-xl font-semibold">
                        {barber.name}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {barber.archived
                          ? "Archived profile"
                          : "No separate staff login or access"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      barber.archived
                        ? "outline"
                        : (sampleActive[barber.id] ?? true)
                          ? "success"
                          : "warning"
                    }
                  >
                    {barber.archived
                      ? "Archived"
                      : `${(sampleActive[barber.id] ?? true) ? "Active" : "Inactive"} · sample`}
                  </Badge>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {sampleBarberSpecialty(barber.name)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sample specialty · preview only
                </p>
                <div className="mt-4 rounded-xl border bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Shift &amp; working hours
                    </p>
                    {barber.archived ? (
                      <p className="text-xs text-muted-foreground">
                        Archived schedules are read-only
                      </p>
                    ) : (
                      <Link
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                        data-slot="button"
                        data-size="sm"
                        data-variant="outline"
                        href="/availability"
                      >
                        <PencilIcon data-icon="inline-start" />
                        Edit hours
                      </Link>
                    )}
                  </div>
                  <p className="mt-2 font-medium">
                    {scheduleSummary(
                      schedules.find((item) => item.id === barber.id)?.schedule
                        .week,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Recurring schedule · {timeZone}. Availability edits require
                    selecting this barber.
                  </p>
                </div>
                <div className="my-4 border-y py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Qualified services{" "}
                    <span className="float-right normal-case tracking-normal">
                      {assignedServiceCount} of {services.length} assigned
                    </span>
                  </p>
                  {assignedServiceCount ? (
                    <ul
                      aria-label="Eligible services"
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      {services
                        .filter((service) =>
                          barber.serviceIds.includes(service.id),
                        )
                        .map((service) => (
                          <li key={service.id} className="min-w-0 max-w-full">
                            <Badge
                              variant="outline"
                              className="h-auto max-w-full whitespace-normal break-words bg-muted py-1 tabular-nums"
                            >
                              {service.name}{" "}
                              <span className="text-muted-foreground">
                                {service.durationMinutes}m
                              </span>{" "}
                              ${service.priceUsd}
                            </Badge>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No eligible services.
                    </p>
                  )}
                </div>
                {!barber.archived && (
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatus("");
                        setEditing(barber);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={`${(sampleActive[barber.id] ?? true) ? "Deactivate" : "Activate"} sample`}
                      onClick={() =>
                        setSampleActive((current) => ({
                          ...current,
                          [barber.id]: !(current[barber.id] ?? true),
                        }))
                      }
                    >
                      {(sampleActive[barber.id] ?? true)
                        ? "Deactivate"
                        : "Activate"}{" "}
                    </Button>
                    <Button
                      variant="destructive"
                      className="ml-auto"
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
            );
          })}
        </div>
      )}
      {editing !== undefined && (
        <BarberDialog
          key={editing?.id ?? "new"}
          barber={editing ?? undefined}
          open
          onOpenChange={closeEditor}
          onSaved={saved}
          services={activeServices}
          discardOpen={discardOpen}
          setDiscardOpen={setDiscardOpen}
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
              .catch(() =>
                setArchiveError(
                  "Could not confirm the archive. Check your connection and try again.",
                ),
              )
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
  onSaved,
  services,
  discardOpen,
  setDiscardOpen,
}: {
  barber?: BarberView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  services: ServiceView[];
  discardOpen: boolean;
  setDiscardOpen: (open: boolean) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    ActionResult<BarberView> | null,
    FormData
  >(async (previous, formData) => {
    try {
      return await saveBarberAction(previous, formData);
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
  const [name, setName] = useState(barber?.name ?? "");
  const [serviceIds, setServiceIds] = useState(barber?.serviceIds ?? []);
  const [specialty, setSpecialty] = useState(
    barber
      ? sampleBarberSpecialty(barber.name)
      : "Specializes in precision cuts and polished grooming styles.",
  );
  const [activePreview, setActivePreview] = useState(!barber?.archived);
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
            {barber ? "Edit barber" : "Add barber"}
          </DialogTitle>
          <DialogDescription>
            Set this barber’s qualifications. Specialty and independent active
            status are sample previews and are not saved.
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
            <p className="text-xs text-muted-foreground">
              Shown on the public booking page and calendar view.
            </p>
            {errors?.name?.[0] && (
              <p id="barber-name-error" className="text-sm text-destructive">
                {errors.name[0]}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="barber-specialty">
              Specialty{" "}
              <span className="font-normal text-muted-foreground">
                (sample preview)
              </span>
            </Label>
            <Textarea
              id="barber-specialty"
              value={specialty}
              onChange={(event) => {
                setSpecialty(event.currentTarget.value);
                setDirty(true);
              }}
              rows={2}
              className="min-h-16"
            />
            <p className="text-xs text-muted-foreground">
              Illustrative profile copy only. This specialty is not saved.
            </p>
          </div>
          <fieldset className="grid gap-2">
            <legend className="font-medium">Eligible services</legend>
            <p className="text-sm text-muted-foreground">
              Select the haircut and grooming services this barber is qualified
              to perform. Prices and durations remain shared shop-wide.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setServiceIds(services.map((service) => service.id));
                  setDirty(true);
                }}
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setServiceIds([]);
                  setDirty(true);
                }}
              >
                Clear all
              </Button>
            </div>
            {services.length ? (
              services.map((service) => (
                <label
                  key={service.id}
                  className="flex min-h-11 items-center gap-3 rounded-xl border p-3"
                >
                  <Checkbox
                    name="serviceIds"
                    value={service.id}
                    checked={serviceIds.includes(service.id)}
                    onCheckedChange={(checked) => {
                      setServiceIds((current) =>
                        checked === true
                          ? [...current, service.id]
                          : current.filter((id) => id !== service.id),
                      );
                      setDirty(true);
                    }}
                  />
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{service.name}</span>
                    <span className="text-muted-foreground">
                      ${service.priceUsd} · {service.durationMinutes} min
                    </span>
                    <Badge variant={service.offered ? "success" : "warning"}>
                      {service.offered ? "Offered" : "Hidden"}
                    </Badge>
                  </span>
                </label>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No active services yet. You can save without assignments.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Qualified for {serviceIds.length} of {services.length} services
            </p>
          </fieldset>
          <label className="flex min-h-12 flex-row-reverse items-center gap-3 rounded-xl border bg-muted/50 p-3">
            <Switch
              aria-label="Active status sample preview"
              checked={activePreview}
              onCheckedChange={(checked) => {
                setActivePreview(checked);
                setDirty(true);
              }}
            />
            <span className="mr-auto grid gap-0.5">
              <span className="font-medium">
                Active status · sample preview
              </span>
              <span className="text-xs text-muted-foreground">
                Independent activation is illustrative and does not affect
                booking eligibility.
              </span>
            </span>
          </label>
          {state && !state.success && <p role="alert">{state.error.message}</p>}
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
              {pending ? "Saving…" : "Save barber"}
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

const barberSpecialties = new Map([
  [
    "Amal",
    "Master barber specializing in classic scissor work, fades, and hot-towel beard shaping.",
  ],
  ["Youssef", "Senior stylist specializing in modern precision tapers."],
  [
    "Leila",
    "Detail-focused specialist in tailored haircuts, skin fades, and clean beard sculpting.",
  ],
]);

function sampleBarberSpecialty(name: string) {
  return (
    barberSpecialties.get(name) ??
    `${name} specializes in precision cuts and polished grooming styles.`
  );
}

function scheduleSummary(week?: WeeklySchedule) {
  if (!week?.some((day) => day.working.length))
    return "No recurring hours saved";
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const time = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const keys = week.map((day) => JSON.stringify(day));
  const groups: string[] = [];
  for (let index = 0; index < week.length;) {
    if (!week[index]!.working.length) {
      index++;
      continue;
    }
    let end = index;
    while (end + 1 < week.length && keys[end + 1] === keys[index]) end++;
    const day = week[index]!;
    const ranges = (items: { start: number; end: number }[]) =>
      items
        .map(({ start, end: finish }) => `${time(start)}–${time(finish)}`)
        .join(", ");
    groups.push(
      `${index === end ? dayNames[index] : `${dayNames[index]}–${dayNames[end]}`} · ${ranges(day.working)}${day.breaks.length ? ` · Break ${ranges(day.breaks)}` : ""}`,
    );
    index = end + 1;
  }
  return groups.join(" · ");
}
