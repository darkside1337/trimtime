"use client";

import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
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
import type { DraftRange } from "../schedule-draft";

export function BreakEditorDialog({
  open,
  rangeIndex,
  range,
  label,
  startInput,
  opener,
  onOpenChange,
  onChange,
  onSave,
}: {
  open: boolean;
  rangeIndex: number | null;
  range: DraftRange;
  label: string;
  startInput: RefObject<HTMLInputElement | null>;
  opener: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onChange: (range: DraftRange) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={startInput}
        finalFocus={opener}
        className="[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-foreground [&_button:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-foreground [&_input:focus-visible]:outline-offset-2"
      >
        <DialogHeader>
          <DialogTitle>
            {rangeIndex === null
              ? "Add a recurring break"
              : "Edit a recurring break"}
          </DialogTitle>
          <DialogDescription>
            Enter a break contained within this weekday&apos;s working hours.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-w-sm gap-2">
          <Label htmlFor="sample-break-label">Break label · sample</Label>
          <Input
            id="sample-break-label"
            value={label}
            readOnly
            aria-readonly="true"
            tabIndex={-1}
          />
          <p className="text-xs text-muted-foreground">
            Design preview; labels aren&apos;t saved.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="new-break-start">Break starts</Label>
            <Input
              id="new-break-start"
              value={range.start}
              ref={startInput}
              onChange={(event) =>
                onChange({ ...range, start: event.target.value })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-break-end">Break ends</Label>
            <Input
              id="new-break-end"
              value={range.end}
              onChange={(event) =>
                onChange({ ...range, end: event.target.value })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSave}>
            {rangeIndex === null ? "Add break" : "Save break"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
