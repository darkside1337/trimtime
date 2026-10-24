"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createShopAction } from "../actions";
import { createShopSchema, subdomainAvailabilitySchema } from "../schemas";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "./form-feedback";
import { ShopField } from "./shop-field";

type SetupValues = {
  name: string;
  subdomain: string;
  timeZone: string;
  publicContact: string;
  address: string;
};
const fields: {
  [K in keyof SetupValues]: {
    label: string;
    placeholder: string;
    description?: string;
  };
} = {
  name: { label: "Shop name", placeholder: "Your shop name" },
  address: {
    label: "Shop address",
    placeholder: "Street address, city, state, ZIP",
  },
  publicContact: {
    label: "Public contact",
    placeholder: "Phone number or email",
    description: "How customers can reach the shop.",
  },
  timeZone: {
    label: "Shop time zone",
    placeholder: "America/New_York",
    description: "Use an IANA time zone. It locks after the first appointment.",
  },
  subdomain: {
    label: "Booking URL name",
    placeholder: "your-shop",
    description: "Choose the name for your shop’s permanent booking address.",
  },
};

export function SetupForm({
  publicOrigin,
  readiness,
}: {
  publicOrigin: string;
  readiness: ReactNode;
}) {
  const [state, action, pending] = useActionState(createShopAction, null);
  const form = useRef<HTMLFormElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const submitStarted = useRef(false);
  const router = useRouter();
  const [stage, setStage] = useState<"edit" | "review">("edit");
  const [dismissedServerState, setDismissedServerState] = useState(state);
  const [values, setValues] = useState<SetupValues>({
    name: "",
    subdomain: "",
    timeZone: "America/New_York",
    publicContact: "",
    address: "",
  });
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<keyof SetupValues, string[]>>
  >({});
  const serverErrorsActive = Boolean(
    state && !state.success && !pending && state !== dismissedServerState,
  );
  const visibleStage = serverErrorsActive ? "edit" : stage;
  const errors =
    serverErrorsActive && state && !state.success
      ? state.fieldErrors
      : clientErrors;

  useEffect(() => {
    if (state?.success) router.replace("/");
    else if (state) submitStarted.current = false;
  }, [state, router]);

  useEffect(() => {
    if (Object.keys(clientErrors).length)
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [clientErrors]);

  useEffect(() => {
    if (stage === "review" && !serverErrorsActive)
      reviewHeading.current?.focus();
  }, [stage, serverErrorsActive]);

  function reviewDetails() {
    setStage("edit");
    setClientErrors({});
    setDismissedServerState(state);
    const result = createShopSchema.safeParse(values);
    if (!result.success) {
      const nextErrors: Partial<Record<keyof SetupValues, string[]>> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof SetupValues;
        nextErrors[field] = [...(nextErrors[field] ?? []), issue.message];
      }
      setClientErrors(nextErrors);
      return;
    }
    setStage("review");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (visibleStage === "edit") {
      event.preventDefault();
      reviewDetails();
    } else if (submitStarted.current) {
      event.preventDefault();
    } else {
      submitStarted.current = true;
      setDismissedServerState(state);
    }
  }

  const parsedSubdomain = subdomainAvailabilitySchema.safeParse({
    subdomain: values.subdomain,
  });
  const bookingName = parsedSubdomain.success
    ? parsedSubdomain.data.subdomain
    : "your-shop";
  const bookingUrl = new URL(publicOrigin);
  bookingUrl.hostname = `${bookingName}.${bookingUrl.hostname}`;
  bookingUrl.pathname = "/";
  bookingUrl.search = "";
  bookingUrl.hash = "";
  const addressLabel = parsedSubdomain.success
    ? "Booking URL preview · not active; availability checked on creation"
    : "Example booking URL · enter a valid name to preview your address";

  return (
    <form
      ref={form}
      action={action}
      onSubmit={handleSubmit}
      aria-busy={pending}
      noValidate
      className="grid items-start gap-10 min-[901px]:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] min-[901px]:gap-16"
    >
      {visibleStage === "edit" ? (
        <>
          <section className="min-w-0" aria-labelledby="shop-details-heading">
            <h2
              id="shop-details-heading"
              className="font-heading text-2xl font-bold"
            >
              Shop details
            </h2>
            <p className="mt-2 mb-8 text-[15px] text-muted-foreground">
              Fields marked * are required to preview a draft.
            </p>
            <fieldset
              disabled={pending}
              className="grid min-w-0 gap-5 sm:grid-cols-2 sm:gap-6"
            >
              {(Object.keys(fields) as (keyof SetupValues)[]).map((name) => {
                const field = fields[name];
                const full =
                  name === "name" || name === "address" || name === "subdomain";
                return (
                  <div
                    key={name}
                    className={`min-w-0 ${full ? "sm:col-span-2" : ""}`}
                  >
                    <ShopField
                      name={name}
                      label={field.label}
                      value={values[name]}
                      onChange={(value) => {
                        setStage("edit");
                        setValues((previous) => ({
                          ...previous,
                          [name]: value,
                        }));
                        setClientErrors({});
                        setDismissedServerState(state);
                      }}
                      errors={errors?.[name]}
                      multiline={name === "address"}
                      placeholder={field.placeholder}
                      description={field.description}
                    />
                  </div>
                );
              })}
            </fieldset>
            <div className="mt-5 rounded-xl border border-border bg-muted px-4 py-3 text-sm [overflow-wrap:anywhere]">
              <p className="text-xs font-semibold">{addressLabel}</p>
              <p>{bookingUrl.toString()}</p>
            </div>
            <div className="mt-4 rounded-xl bg-secondary p-4 text-sm">
              <p className="mb-1 font-semibold">Choose carefully</p>
              <p>
                Your shop subdomain is permanent in v1. It cannot be renamed
                after creation.
              </p>
            </div>
            {serverErrorsActive ? (
              <FormFeedback state={state} form={form} />
            ) : null}
            <div className="mt-5 flex justify-end">
              <Button type="submit" disabled={pending}>
                Preview draft shop
              </Button>
            </div>
          </section>
          {readiness}
        </>
      ) : (
        <>
          {(Object.keys(values) as (keyof SetupValues)[]).map((name) => (
            <input key={name} type="hidden" name={name} value={values[name]} />
          ))}
          <section
            aria-labelledby="review-heading"
            className="min-w-0 min-[901px]:col-span-2"
          >
            <span className="inline-flex rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">
              Unpublished draft preview
            </span>
            <h2
              ref={reviewHeading}
              id="review-heading"
              tabIndex={-1}
              className="mt-5 font-heading text-2xl font-bold focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Your shop details
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Review your unsaved details. Creating the shop saves them as a
              private draft.
            </p>
            <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              {(
                [
                  ["Shop name", values.name],
                  ["Public contact", values.publicContact],
                  ["Shop address", values.address],
                  ["Shop time zone", values.timeZone],
                  ["Booking URL name", values.subdomain],
                  ["Booking URL preview", bookingUrl.toString()],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-lg border border-border bg-background p-3"
                >
                  <dt className="text-xs font-semibold text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-1 break-words whitespace-pre-wrap">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 rounded-xl bg-secondary p-4 text-sm">
              <p className="font-semibold">
                Next steps after creating the shop
              </p>
              <p className="mt-1">
                Public booking stays off until these steps are complete. The
                booking link and QR code are available after setup.
              </p>
            </div>
            <ul
              aria-label="Remaining setup steps"
              className="mt-4 grid gap-3 sm:grid-cols-3"
            >
              {[
                ["Add a service", "At least one active service"],
                [
                  "Assign a barber",
                  "An active barber eligible for that service",
                ],
                ["Set working hours", "Usable shop and barber hours"],
              ].map(([title, detail]) => (
                <li key={title} className="rounded-xl border border-border p-4">
                  <strong className="block text-sm">{title}</strong>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {detail}
                  </span>
                </li>
              ))}
            </ul>
            {serverErrorsActive ? (
              <div className="mt-4">
                <FormFeedback state={state} form={form} />
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStage("edit")}
                disabled={pending}
              >
                Edit details
              </Button>
              <Button type="submit" disabled={pending || state?.success}>
                {pending ? "Creating shop…" : "Create shop"}
              </Button>
            </div>
          </section>
        </>
      )}
    </form>
  );
}
