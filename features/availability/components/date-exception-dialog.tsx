"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AvailabilityData } from "../queries";

type ExceptionView = "date" | "block";

export function DateExceptionDialog({
  open,
  date,
  dialogDate,
  dialogTarget,
  exceptionView,
  hasLoadedSelection,
  busy,
  dirty,
  message,
  barbers,
  onSelectionChange,
  onLoad,
  onViewChange,
  onClose,
  children,
}: {
  open: boolean;
  date: string;
  dialogDate: string;
  dialogTarget: string;
  exceptionView: ExceptionView;
  hasLoadedSelection: boolean;
  busy: boolean;
  dirty: boolean;
  message: string;
  barbers: AvailabilityData["barbers"];
  onSelectionChange: (selection: { date: string; target: string }) => void;
  onLoad: () => void;
  onViewChange: (view: ExceptionView) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const activeBarbers = barbers.filter((barber) => !barber.archived);
  const selectedArchivedBarber = barbers.find(
    (barber) => barber.id === dialogTarget && barber.archived,
  );

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onClose();
  }

  function handleDateChange(event: ChangeEvent<HTMLInputElement>) {
    onSelectionChange({ date: event.target.value, target: dialogTarget });
  }

  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>) {
    onSelectionChange({ date: dialogDate, target: event.target.value });
  }

  function handleViewChange(event: ChangeEvent<HTMLSelectElement>) {
    onViewChange(event.target.value as ExceptionView);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-foreground [&_button:focus-visible]:outline-offset-2 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2">
        <DialogHeader>
          <DialogTitle>
            {hasLoadedSelection && date
              ? `Date availability · ${date}`
              : "Add a date override or block"}
          </DialogTitle>
          <DialogDescription>
            Choose a shop-local date and schedule to review saved exceptions or
            add a dated change. Closures, replacements, and blocks remain
            independent restrictions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="add-exception-date">Schedule day</Label>
            <Input
              id="add-exception-date"
              type="date"
              value={dialogDate}
              disabled={busy || dirty}
              onChange={handleDateChange}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-exception-target">Apply to</Label>
            <select
              id="add-exception-target"
              className="h-10 rounded-md border border-input bg-background px-3"
              value={dialogTarget}
              disabled={busy || dirty}
              onChange={handleTargetChange}
            >
              <option value="shop">Shop</option>
              {selectedArchivedBarber && (
                <option value={selectedArchivedBarber.id}>
                  {selectedArchivedBarber.name} · archived
                </option>
              )}
              {activeBarbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          disabled={busy || !dialogDate || dirty}
          onClick={onLoad}
        >
          {busy
            ? "Loading date…"
            : hasLoadedSelection
              ? "Reload date"
              : "Load date"}
        </Button>
        {hasLoadedSelection && date && (
          <div className="mt-5 grid max-w-sm gap-2">
            <Label htmlFor="exception-view">Exception type</Label>
            <select
              id="exception-view"
              className="h-10 rounded-md border border-input bg-background px-3"
              value={exceptionView}
              disabled={busy}
              onChange={handleViewChange}
            >
              <option value="date">Date settings</option>
              <option value="block">Barber time block</option>
            </select>
          </div>
        )}
        {children}
        <p aria-live="polite" className={message ? "mt-4 text-sm" : "sr-only"}>
          {message}
        </p>
        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
