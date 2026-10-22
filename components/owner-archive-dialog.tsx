"use client";

import { ArchiveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function OwnerArchiveDialog({
  resourceType,
  resourceName,
  error,
  pending,
  onOpenChange,
  onConfirm,
}: {
  resourceType: "service" | "barber";
  resourceName: string;
  error: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader className="pr-8">
          <span className="grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive-text">
            <ArchiveIcon aria-hidden="true" className="size-5" />
          </span>
          <DialogTitle className="text-lg">Archive {resourceType}?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{resourceName}</span>{" "}
            will move to your archived list and won’t be available for new
            bookings. Existing appointment history stays intact.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive-text"
          >
            {error}
          </p>
        )}
        <DialogFooter className="flex-col sm:flex-row">
          <Button
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 w-full sm:w-auto"
            disabled={pending}
            onClick={onConfirm}
          >
            <ArchiveIcon aria-hidden="true" />
            {pending ? "Archiving…" : `Archive ${resourceType}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
