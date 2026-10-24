"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { Check, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { updateShopAction } from "../actions";
import type { ShopView } from "../queries";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormFeedback } from "./form-feedback";
import { ShopField } from "./shop-field";

export function SettingsForm({
  shop,
  timeZoneLocked,
  owner,
  publication,
  sharing,
}: {
  shop: ShopView;
  timeZoneLocked: boolean;
  owner: { name: string; email: string };
  publication: ReactNode;
  sharing: ReactNode;
}) {
  const [saved, setSaved] = useState(shop);
  const [state, action, pending] = useActionState(
    async (previous: ActionResult<ShopView> | null, formData: FormData) => {
      const result = await updateShopAction(previous, formData);
      if (result.success) setSaved(result.data);
      return result;
    },
    null,
  );
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({
    name: shop.name,
    publicContact: shop.publicContact,
    timeZone: shop.timeZone,
  });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [feedbackHidden, setFeedbackHidden] = useState(false);
  const dirty =
    values.name.trim() !== saved.name ||
    values.publicContact.trim() !== saved.publicContact ||
    values.timeZone !== saved.timeZone;
  const errors =
    state && !state.success && !feedbackHidden ? state.fieldErrors : undefined;

  return (
    <form
      ref={form}
      action={action}
      onSubmit={() => setFeedbackHidden(false)}
      aria-busy={pending}
      noValidate
      className="grid gap-6"
    >
      <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-6">
          <section
            className="owner-settings-card"
            aria-labelledby="profile-heading"
          >
            <header className="owner-settings-card-header">
              <h2 id="profile-heading">Shop profile &amp; address</h2>
              <p>Public details shown on your shop page.</p>
            </header>
            <fieldset disabled={pending} className="grid min-w-0 gap-5">
              <ShopField
                name="name"
                label="Shop name"
                value={values.name}
                errors={errors?.name}
                description="The name customers see on your public shop page."
                onChange={(name) =>
                  setValues((previous) => ({ ...previous, name }))
                }
              />
              <ShopField
                name="publicContact"
                label="Public contact"
                value={values.publicContact}
                errors={errors?.publicContact}
                description="A phone number, email address, or another way to reach your shop."
                onChange={(publicContact) =>
                  setValues((previous) => ({ ...previous, publicContact }))
                }
              />
              <div className="grid gap-2">
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  value={shop.address}
                  readOnly
                  aria-describedby="address-description"
                />
                <p
                  id="address-description"
                  className="text-xs text-muted-foreground"
                >
                  Read-only. Address editing is not available here.
                </p>
              </div>
            </fieldset>
          </section>
          <section
            className="owner-settings-card"
            aria-labelledby="identifiers-heading"
          >
            <header className="owner-settings-card-header">
              <h2 id="identifiers-heading">Shop identifiers and time zone</h2>
              <p>Your permanent shop address and scheduling time zone.</p>
            </header>
            <div className="grid gap-5">
              <div className="grid min-w-0 gap-3 rounded-xl border border-border bg-muted p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="subdomain">Subdomain</Label>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                    <LockKeyhole className="size-3" aria-hidden="true" />
                    Permanent in v1
                  </span>
                </div>
                <Input
                  id="subdomain"
                  value={shop.subdomain}
                  readOnly
                  aria-describedby="subdomain-description"
                />
                <p
                  id="subdomain-description"
                  className="text-xs text-muted-foreground"
                >
                  Read-only. Your permanent shop address cannot be changed.
                </p>
              </div>
              <fieldset
                disabled={pending}
                className="grid gap-3 rounded-xl border border-border bg-muted p-4"
              >
                {timeZoneLocked ? (
                  <div className="grid gap-2">
                    <Label htmlFor="timeZone">Time zone</Label>
                    <Input
                      id="timeZone"
                      name="timeZone"
                      value={values.timeZone}
                      readOnly
                      aria-describedby="timeZone-description"
                    />
                  </div>
                ) : (
                  <ShopField
                    name="timeZone"
                    label="Time zone"
                    value={values.timeZone}
                    errors={errors?.timeZone}
                    onChange={(timeZone) =>
                      setValues((previous) => ({ ...previous, timeZone }))
                    }
                  />
                )}
                <p
                  id="timeZone-description"
                  className="text-xs text-muted-foreground"
                >
                  {timeZoneLocked
                    ? "Permanently locked after the first appointment, even if appointments are later deleted."
                    : "You can change this before the first appointment. It locks permanently after that, even if appointments are later deleted."}
                </p>
              </fieldset>
            </div>
          </section>
          {publication}
        </div>
        <div className="grid min-w-0 gap-6">
          {sharing}
          <section
            className="owner-settings-card"
            aria-labelledby="identity-heading"
          >
            <header className="owner-settings-card-header">
              <h2 id="identity-heading">Owner identity</h2>
              <p>The Google account that manages this shop.</p>
            </header>
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-muted p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 text-xs text-muted-foreground">
                <strong className="block break-words text-sm text-foreground">
                  {owner.name}
                </strong>
                <span className="block break-all">{owner.email}</span>
                <span className="mt-1 inline-flex items-center gap-1">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  Google OAuth · Shop owner
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-surface)] border border-border bg-background p-5">
        <div className="grid gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Check className="size-4" aria-hidden="true" />
            {pending
              ? "Saving your settings…"
              : dirty
                ? "Unsaved modifications"
                : "All settings saved"}
          </span>
          <FormFeedback
            state={feedbackHidden || (dirty && state?.success) ? null : state}
            form={form}
            successMessage="Settings saved."
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || pending}
            onClick={() => setDiscardOpen(true)}
          >
            Discard
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </footer>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your saved shop details will stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setValues({
                  name: saved.name,
                  publicContact: saved.publicContact,
                  timeZone: saved.timeZone,
                });
                setFeedbackHidden(true);
                setDiscardOpen(false);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
