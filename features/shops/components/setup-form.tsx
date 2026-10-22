"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createShopAction } from "../actions";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "./form-feedback";
import { ShopField } from "./shop-field";
export function SetupForm() {
  const [state, action, pending] = useActionState(createShopAction, null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [values, setValues] = useState({
    name: "",
    subdomain: "",
    timeZone: "America/New_York",
    publicContact: "",
    address: "",
  });
  const errors = state && !state.success ? state.fieldErrors : undefined;
  useEffect(() => {
    // Client navigation avoids the conflicting Host on Next's internal action redirect fetch.
    if (state?.success) router.replace("/");
  }, [state, router]);
  return (
    <form
      ref={form}
      action={action}
      aria-busy={pending}
      noValidate
      className="shop-setup grid gap-5"
    >
      <fieldset disabled={pending} className="grid min-w-0 gap-5 sm:grid-cols-2 sm:gap-6">
        {(
          [
            ["name", "Shop name"],
            ["address", "Address"],
            ["publicContact", "Public contact"],
            ["timeZone", "Time zone"],
            ["subdomain", "Subdomain"],
          ] as const
        ).map(([name, label]) => (
          <div key={name} className={name === "publicContact" || name === "timeZone" ? "min-w-0" : "min-w-0 sm:col-span-2"}><ShopField
            name={name}
            label={label}
            value={values[name]}
            onChange={(value) =>
              setValues((previous) => ({ ...previous, [name]: value }))
            }
            errors={errors?.[name]}
            multiline={name === "address"}
            placeholder={{ name: "Your shop name", address: "Your fictional street address", publicContact: "Phone number or email", timeZone: "America/New_York", subdomain: "your-shop" }[name]}
            description={{ name: undefined, address: undefined, publicContact: "How customers can reach the shop.", timeZone: "Use an IANA time zone, such as America/New_York or UTC. It locks when the first appointment is created.", subdomain: "Use 1–63 letters or numbers, with hyphens only between them." }[name]}
          /></div>
        ))}
      </fieldset>
      <div className="rounded-xl border border-border bg-muted px-4 py-3 text-sm [overflow-wrap:anywhere]"><p className="text-xs font-semibold">Illustrative booking address · not live</p><p>{values.subdomain.trim().toLowerCase() || "your-shop"}.trimtime.com</p></div>
      <div className="rounded-xl bg-secondary p-4 text-sm"><p className="mb-1 font-semibold">Choose carefully</p><p>This permanent address cannot be changed later.</p><p className="mt-1">Creating a draft does not open public booking.</p></div>
      <FormFeedback state={state} form={form} />
      <Button className="justify-self-end" type="submit" disabled={pending || state?.success}>
        {pending || state?.success ? "Saving…" : "Create draft shop"}
      </Button>
    </form>
  );
}
