"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RemoveBlockDialog({
  open,
  busy,
  canRemove,
  message,
  onOpenChange,
  onKeepBlock,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  canRemove: boolean;
  message: string;
  onOpenChange: (open: boolean) => void;
  onKeepBlock: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this barber time block?</DialogTitle>
          <DialogDescription>
            The saved block will stop restricting this barber&apos;s
            availability. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onKeepBlock}
          >
            Keep block
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !canRemove}
            onClick={onConfirm}
          >
            {busy ? "Removing…" : "Remove block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
