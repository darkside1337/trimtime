"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AvailabilityOverview } from "../queries";

export function UpcomingSavedExceptions({
  exceptions,
  onEdit,
}: {
  exceptions: AvailabilityOverview["exceptions"];
  onEdit: (exception: AvailabilityOverview["exceptions"][number]) => void;
}) {
  const [filter, setFilter] = useState<"all" | "dates" | "blocks">("all");
  const filtered = exceptions.filter(
    (item) =>
      filter === "all" ||
      (filter === "blocks" && item.kind === "block") ||
      (filter === "dates" && item.kind !== "block"),
  );

  return (
    <section
      className="mt-5 rounded-2xl border border-border p-5 sm:p-7"
      aria-labelledby="upcoming-exceptions-title"
    >
      <h2
        id="upcoming-exceptions-title"
        className="font-heading text-xl font-bold"
      >
        Upcoming saved exceptions
      </h2>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter exceptions">
        {(
          [
            ["all", "All", exceptions.length],
            [
              "dates",
              "Date changes",
              exceptions.filter((item) => item.kind !== "block").length,
            ],
            [
              "blocks",
              "Time blocks",
              exceptions.filter((item) => item.kind === "block").length,
            ],
          ] as const
        ).map(([value, label, count]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? "default" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label} · {count}
          </Button>
        ))}
      </div>
      {filtered.length ? (
        <ul className="mt-4 grid gap-4 min-[1200px]:grid-cols-3">
          {filtered.map((exception) => (
            <li
              key={exception.id}
              className="flex min-w-0 flex-col items-start gap-4 rounded-xl border border-border bg-muted/30 p-4"
            >
              <div className="grid gap-2">
                <Badge variant="outline" className="w-fit">
                  {exception.kind === "block"
                    ? "Barber time block"
                    : exception.kind === "shop-date"
                      ? "Shop date"
                      : "Barber date"}
                </Badge>
                <p className="font-semibold">
                  {exception.title}
                  {exception.archived ? " · archived" : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {exception.date}
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {exception.detail}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEdit(exception)}
              >
                {exception.kind === "block" ? "View block" : "Edit date"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {exceptions.length
            ? "No saved exceptions match this filter."
            : "No future date exceptions or barber blocks are saved."}
        </p>
      )}
    </section>
  );
}
