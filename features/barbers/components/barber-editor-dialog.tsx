"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveBarberAction } from "../actions";
import type { BarberView, ServiceView } from "@/features/catalog/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { ActionResult } from "@/lib/action-result";

export function BarberEditorDialog({
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

export function sampleBarberSpecialty(name: string) {
  return (
    barberSpecialties.get(name) ??
    `${name} specializes in precision cuts and polished grooming styles.`
  );
}
