"use client";
import { useActionState, useRef, useState } from "react";
import { updateShopAction } from "../actions";
import type { ShopView } from "../queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormFeedback } from "./form-feedback";
import { ShopField } from "./shop-field";

export function SettingsForm({ shop }: { shop: ShopView }) {
  const [state, action, pending] = useActionState(updateShopAction, null);
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: shop.name, publicContact: shop.publicContact, timeZone: shop.timeZone });
  const errors = state && !state.success ? state.fieldErrors : undefined;
  return <form ref={form} action={action} aria-busy={pending} noValidate className="grid gap-5">
    <fieldset disabled={pending} className="grid min-w-0 gap-5">
      {([["name", "Shop name"], ["publicContact", "Public contact"], ["timeZone", "Time zone"]] as const).map(([name, label]) => (
        <ShopField key={name} name={name} label={label} value={values[name]} errors={errors?.[name]}
          onChange={(value) => setValues((previous) => ({ ...previous, [name]: value }))} />
      ))}
      <div className="grid gap-2 rounded-xl border border-border bg-muted p-4"><Label htmlFor="subdomain">Subdomain</Label><Input id="subdomain" value={shop.subdomain} readOnly aria-describedby="subdomain-description" /><p id="subdomain-description" className="text-sm text-muted-foreground">Read-only. Your permanent shop address cannot be changed.</p></div>
      <div className="grid gap-2 rounded-xl border border-border bg-muted p-4"><Label htmlFor="address">Address</Label><Textarea id="address" value={shop.address} readOnly aria-describedby="address-description" /><p id="address-description" className="text-sm text-muted-foreground">Read-only. Address editing is not available here.</p></div>
    </fieldset>
    <FormFeedback state={state} form={form} successMessage="Settings saved." />
    <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
  </form>;
}
