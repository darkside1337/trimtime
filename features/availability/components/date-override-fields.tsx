"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DraftRange } from "../schedule-draft";

export type DateOverrideDraft = {
  working: DraftRange[];
  breaks: DraftRange[];
  closed: boolean;
  override: boolean;
};

export function DateOverrideFields({
  date,
  target,
  targetArchived,
  draft,
  busy,
  dirty,
  fieldErrors,
  onDraftChange,
  onOverrideChange,
  onSave,
  onReload,
}: {
  date: string;
  target: string;
  targetArchived: boolean;
  draft: DateOverrideDraft;
  busy: boolean;
  dirty: boolean;
  fieldErrors: Record<string, string>;
  onDraftChange: (draft: DateOverrideDraft) => void;
  onOverrideChange: (enabled: boolean) => void;
  onSave: () => void;
  onReload: () => void;
}) {
  function handleClosedChange(checked: boolean | "indeterminate") {
    onDraftChange({ ...draft, closed: checked === true });
  }

  if (targetArchived) {
    return (
      <p className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This barber is archived. Their dated schedule is read-only; retained
        time blocks below can still be removed.
      </p>
    );
  }

  return (
    <div className="mt-6 grid gap-3 border-t border-border pt-5">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.override}
          disabled={busy}
          onCheckedChange={(checked) => onOverrideChange(checked === true)}
        />
        Replace recurring hours and breaks
      </label>
      {draft.override && (
        <div className="grid gap-4">
          {(
            [
              [draft.working, "hours"],
              [draft.breaks, "break"],
            ] as const
          ).map(([ranges, group]) => {
            function handleAddRange() {
              onDraftChange({
                ...draft,
                [group === "hours" ? "working" : "breaks"]: [
                  ...ranges,
                  { start: "", end: "" },
                ],
              });
            }

            return (
              <div key={group} className="grid gap-3 sm:grid-cols-2">
                {ranges.map((range, index) => {
                  const startId = `dated-${group}-start-${index}`;
                  const endId = `dated-${group}-end-${index}`;
                  const update = (field: "start" | "end", value: string) => {
                    const updated = ranges.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [field]: value } : item,
                    );
                    onDraftChange({
                      ...draft,
                      [group === "hours" ? "working" : "breaks"]: updated,
                    });
                  };
                  function handleRemoveRange() {
                    onDraftChange({
                      ...draft,
                      [group === "hours" ? "working" : "breaks"]: ranges.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    });
                  }
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                    >
                      <div className="grid gap-2">
                        <Label htmlFor={startId}>
                          {group === "hours"
                            ? `Hours start${index ? ` ${index + 1}` : ""}`
                            : `Break start${index ? ` ${index + 1}` : ""}`}
                        </Label>
                        <Input
                          id={startId}
                          value={range.start}
                          placeholder="09:00"
                          disabled={busy}
                          aria-invalid={Boolean(fieldErrors[startId])}
                          aria-describedby={
                            fieldErrors[startId]
                              ? `${startId}-error`
                              : undefined
                          }
                          onChange={(event) =>
                            update("start", event.target.value)
                          }
                        />
                        {fieldErrors[startId] && (
                          <p
                            id={`${startId}-error`}
                            className="text-sm text-destructive"
                          >
                            {fieldErrors[startId]}
                          </p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={endId}>
                          {group === "hours"
                            ? `Hours end${index ? ` ${index + 1}` : ""} (24:00 allowed)`
                            : `Break end${index ? ` ${index + 1}` : ""} (24:00 allowed)`}
                        </Label>
                        <Input
                          id={endId}
                          value={range.end}
                          placeholder="17:00"
                          disabled={busy}
                          aria-invalid={Boolean(fieldErrors[endId])}
                          aria-describedby={
                            fieldErrors[endId] ? `${endId}-error` : undefined
                          }
                          onChange={(event) =>
                            update("end", event.target.value)
                          }
                        />
                        {fieldErrors[endId] && (
                          <p
                            id={`${endId}-error`}
                            className="text-sm text-destructive"
                          >
                            {fieldErrors[endId]}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Remove ${group} range ${index + 1}`}
                        onClick={handleRemoveRange}
                      >
                        Remove
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  disabled={busy}
                  onClick={handleAddRange}
                >
                  Add {group === "hours" ? "hours" : "break"} range
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.closed}
          disabled={busy}
          onCheckedChange={handleClosedChange}
        />
        {target === "shop"
          ? "Close the shop for this date"
          : "Mark this barber off for this date"}
      </label>
      <p className="text-sm text-muted-foreground">
        Saving replacement hours does not remove a closure, day off, or time
        block. Remove each restriction explicitly.
      </p>
      <div className="grid max-w-xl gap-2">
        <Label htmlFor="dated-reason-sample">Reason / notes · sample</Label>
        <Input
          id="dated-reason-sample"
          value="Holiday opening hours"
          readOnly
          aria-readonly="true"
        />
        <p className="text-xs text-muted-foreground">
          Design preview; date reasons are not saved.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !dirty} onClick={onSave}>
          Save date settings
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !date}
          onClick={onReload}
        >
          Reload saved state
        </Button>
      </div>
    </div>
  );
}
