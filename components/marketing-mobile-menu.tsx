"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingBookingDialog } from "./marketing-booking-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MarketingMobileMenu() {
  const [bookingOpen, setBookingOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Open navigation"
            >
              <Menu aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link href="#how-it-works" />}>
              Daily schedule
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="#customer-booking" />}>
              Customer booking
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="#faq" />}>
              FAQs
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBookingOpen(true)}>
              Try booking
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <MarketingBookingDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
      />
    </>
  );
}
