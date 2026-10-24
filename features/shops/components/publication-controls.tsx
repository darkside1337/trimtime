"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setShopPublicationAction } from "../actions";
import type { PublicationReadiness } from "../queries";

export function PublicationControls({
  published,
  readiness,
}: {
  published: boolean;
  readiness: PublicationReadiness;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  function save(next: boolean) {
    setFeedback("");
    startTransition(async () => {
      try {
        const result = await setShopPublicationAction({
          published: next,
          expectedPublished: published,
        });
        if (!result.success) {
          setFeedback(result.error.message);
          return;
        }
        setDialogOpen(false);
        router.refresh();
      } catch {
        setFeedback(
          "Connection lost. Refresh publication status to check whether the change saved.",
        );
      }
    });
  }

  const refreshNeeded =
    feedback.includes("another tab") ||
    feedback.includes("Refresh publication status");
  function refreshStatus() {
    setFeedback("");
    router.refresh();
  }
  const feedbackView = feedback ? (
    <div className="grid justify-items-start gap-2">
      <p
        aria-live="polite"
        role="alert"
        className="text-sm text-destructive-text"
      >
        {feedback}
      </p>
      {refreshNeeded && (
        <Button type="button" variant="link" onClick={refreshStatus}>
          Refresh publication status
        </Button>
      )}
    </div>
  ) : null;

  return (
    <section
      aria-labelledby="publication-heading"
      className="owner-settings-card"
    >
      <header className="owner-settings-card-header">
        <h2 id="publication-heading">Publication &amp; booking readiness</h2>
        <p>Control access to your public shop preview.</p>
      </header>
      <div className="rounded-xl border border-border bg-muted p-4">
        <p className="text-sm font-semibold">
          {published
            ? "Published · Public preview available"
            : "Unpublished draft · Public page is paused"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {published
            ? "Anyone with the link can view current services and eligible starts."
            : "Your saved shop details and schedules stay available to you."}
        </p>
      </div>
      <div className="grid gap-3">
        <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          Before you publish
        </p>
        <ul className="grid gap-3 text-xs">
          {[
            [
              "shop details",
              "Shop details",
              "Name, address, public contact and time zone.",
            ],
            [
              "an offered service",
              "Services",
              "At least one active service offered publicly.",
            ],
            [
              "an active barber assigned to a service",
              "Staff assigned",
              "An active barber assigned to an offered service.",
            ],
            [
              "shared recurring hours with a complete 15-minute-grid start",
              "Usable hours",
              "A complete appointment fits the shared recurring hours.",
            ],
          ].map(([key, label, description]) => {
            const missing = readiness.missing.includes(key!);
            const Icon = missing ? Circle : CheckCircle2;
            return (
              <li key={key} className="flex items-start gap-2">
                <Icon
                  className={
                    missing
                      ? "mt-0.5 size-4 shrink-0 text-muted-foreground"
                      : "mt-0.5 size-4 shrink-0 text-[var(--success)]"
                  }
                  aria-hidden="true"
                />
                <span>
                  <strong>{label}: </strong>
                  {description}
                  <span className="sr-only">
                    {missing ? " Incomplete." : " Complete."}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {readiness.ready ? (
        <p className="text-sm">
          Your shop meets the minimum setup for publication.
        </p>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm">Complete these items before publishing:</p>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {readiness.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <nav
            aria-label="Complete shop setup"
            className="flex flex-wrap gap-3 text-sm underline underline-offset-4"
          >
            <a href="/services">Services</a>
            <a href="/barbers">Barbers</a>
            <a href="/availability">Availability</a>
          </nav>
        </div>
      )}
      {published ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button type="button" variant="outline" disabled={pending} />
            }
          >
            Unpublish shop
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Unpublish this shop?</DialogTitle>
              <DialogDescription>
                The public page will show that the shop is paused. Your shop
                details and schedules will remain saved.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setDialogOpen(false)}
              >
                Keep published
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => save(false)}
              >
                {pending ? "Saving…" : "Unpublish"}
              </Button>
            </DialogFooter>
            {feedbackView}
          </DialogContent>
        </Dialog>
      ) : (
        <Button
          type="button"
          disabled={!readiness.ready || pending}
          onClick={() => save(true)}
        >
          {pending ? "Publishing…" : "Publish shop"}
        </Button>
      )}
      {(!published || !dialogOpen) && feedbackView}
      <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        Unpublishing pauses the public page and preserves your shop details and
        schedules. Booking submission is not available yet.
      </p>
    </section>
  );
}
