"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function MarketingBookingDialog({
  children,
  className,
  open,
  onOpenChange,
}: {
  children?: React.ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children ? (
        <DialogTrigger
          render={<button type="button" className={className ?? ""} />}
        >
          {children}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <span className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
            Customer booking flow
          </span>
          <DialogTitle className="text-xl font-bold">
            Preview Customer Booking
          </DialogTitle>
          <DialogDescription>
            Review the fictional, account-free booking flow. This local preview
            creates no appointment and sends no real messages.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Stay on homepage
          </DialogClose>
          <DialogClose
            render={
              <Link
                href="#customer-booking"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-4 text-sm font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            }
          >
            View booking preview →
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
