"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { archiveServiceAction, setServiceOfferedAction } from "../actions";
import type { ServiceView, BarberView } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClockIcon } from "lucide-react";
import type { ActionError } from "@/lib/action-result";
import { OwnerArchiveDialog } from "@/components/owner-archive-dialog";
import {
  ServiceEditorDialog,
  sampleServiceDescription,
} from "./service-editor-dialog";

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
        <ServiceEditorDialog
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
