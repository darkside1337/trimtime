"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AvailabilityData } from "../queries";
import type { DateAvailabilityView } from "../types";
import { displayBlockInstant } from "../date-editor";
import type { useTimeBlockDraft } from "../hooks/use-time-block-draft";

type BlockDraft = ReturnType<typeof useTimeBlockDraft>;

function TimeBoundaryField({
  id,
  label,
  value,
  choices,
  instant,
  end = false,
  busy,
  dirty,
  draft,
}: {
  id: "block-start" | "block-end";
  label: string;
  value: string;
  choices: BlockDraft["startChoices"];
  instant: string;
  end?: boolean;
  busy: boolean;
  dirty: boolean;
  draft: BlockDraft;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={end ? "10:15" : "10:00"}
        disabled={busy}
        onChange={(event) => draft.changeBoundary(event.target.value, end)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={busy || dirty}
        onClick={() => void draft.resolveBoundary(value, end)}
      >
        Resolve {end ? "end" : "start"}
      </Button>
      {choices.length > 1 && (
        <select
          aria-label={`${end ? "End" : "Start"} UTC offset`}
          className="h-10 rounded-md border border-input bg-background px-3"
          value={instant}
          onChange={(event) =>
            (end ? draft.setEndInstant : draft.setStartInstant)(
              event.target.value,
            )
          }
        >
          <option value="">Choose UTC offset</option>
          {choices.map((choice) => (
            <option key={choice.instant} value={choice.instant}>
              {choice.offset}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function BarberTimeBlockEditor({
  date,
  target,
  targetArchived,
  barbers,
  data,
  blockBarberId,
  onBlockBarberChange,
  busy,
  dirty,
  draft,
  onSave,
  onReload,
  onRemove,
}: {
  date: string;
  target: string;
  targetArchived: boolean;
  barbers: AvailabilityData["barbers"];
  data: DateAvailabilityView;
  blockBarberId: string;
  onBlockBarberChange: (id: string) => void;
  busy: boolean;
  dirty: boolean;
  draft: BlockDraft;
  onSave: () => void;
  onReload: () => void;
  onRemove: (id: string) => void;
}) {
  const activeBarbers = barbers.filter((barber) => !barber.archived);

  return (
    <div className="mt-6 grid gap-3 border-t border-border pt-5">
      <h3 className="font-semibold">Add a barber time block</h3>
      <p className="text-sm text-muted-foreground">
        Blocks are individual-barber restrictions. They can be set outside
        working hours and remain at the same UTC instants if the shop time zone
        changes.
      </p>
      {targetArchived ? (
        <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          New blocks require an active barber. Existing blocks for this archived
          barber remain available to remove below.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TimeBoundaryField
              id="block-start"
              label="Start (shop local time)"
              value={draft.start}
              choices={draft.startChoices}
              instant={draft.startInstant}
              busy={busy}
              dirty={dirty}
              draft={draft}
            />
            <TimeBoundaryField
              id="block-end"
              label="End (shop local time, 24:00 allowed)"
              value={draft.end}
              choices={draft.endChoices}
              instant={draft.endInstant}
              end
              busy={busy}
              dirty={dirty}
              draft={draft}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="block-note">Note (optional)</Label>
            <Input
              id="block-note"
              value={draft.note}
              disabled={busy}
              onChange={(event) => draft.setNote(event.target.value)}
            />
          </div>
          {target === "shop" && (
            <div className="grid max-w-sm gap-2">
              <Label htmlFor="block-barber">Barber for this time block</Label>
              <select
                id="block-barber"
                className="h-10 rounded-md border border-input bg-background px-3"
                value={blockBarberId}
                disabled={busy}
                onChange={(event) => onBlockBarberChange(event.target.value)}
              >
                <option value="">Choose an active barber</option>
                {activeBarbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            type="button"
            className="w-fit"
            disabled={busy || dirty || (target === "shop" && !blockBarberId)}
            onClick={onSave}
          >
            Save time block
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={busy || !date}
        onClick={onReload}
      >
        Reload saved state
      </Button>
      {data.blocks.map((block) => {
        const barber = barbers.find((item) => item.id === block.barberId);
        return (
          <div
            key={block.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
          >
            <span>
              {barber?.name ?? "Barber"}
              {barber?.archived && " · archived"}:{" "}
              {displayBlockInstant(block.start, data.timeZone)} –{" "}
              {displayBlockInstant(block.end, data.timeZone)}
              {block.note ? ` · ${block.note}` : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || dirty}
              onClick={() => onRemove(block.id)}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </div>
  );
}
