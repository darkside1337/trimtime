"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetClose,
} from "./ui/sheet";
import {
  CalendarDays,
  Clock3,
  Menu,
  Scissors,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { OwnerSignOut } from "./owner-auth-controls";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const destinations = [
  { key: "today", label: "Today", href: "/", icon: CalendarDays },
  { key: "services", label: "Services", href: "/services", icon: Scissors },
  { key: "barbers", label: "Barbers", href: "/barbers", icon: UserRound },
  {
    key: "availability",
    label: "Availability",
    href: "/availability",
    icon: Clock3,
  },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
] as const;

export function OwnerManagementNav({ shopName }: { shopName: string }) {
  const segment = useSelectedLayoutSegment();
  const current =
    destinations.find(({ key }) => key === segment)?.key ?? "today";
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 901px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <>
      <div className="hidden min-[901px]:flex min-[901px]:items-center min-[901px]:gap-2">
        <nav aria-label="Owner navigation" className="flex gap-2 text-sm">
          {destinations.map(({ key, label, href }) => (
            <Link
              key={key}
              href={href}
              aria-current={current === key ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-md px-3 underline-offset-4 hover:underline aria-[current=page]:bg-secondary aria-[current=page]:font-semibold"
            >
              {label}
            </Link>
          ))}
        </nav>
        <OwnerSignOut />
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="size-11 rounded-full min-[901px]:hidden"
            />
          }
          aria-label="Open navigation"
        >
          <Menu aria-hidden="true" />
        </SheetTrigger>
        <SheetContent
          className="w-[min(340px,calc(100vw-32px))] max-w-none gap-0 rounded-l-[var(--radius-surface)] rounded-r-none border-l border-border bg-background text-foreground shadow-[var(--shadow-floating)] data-[side=right]:h-dvh data-[side=right]:max-h-dvh data-[side=right]:data-starting-style:translate-x-full data-[side=right]:data-ending-style:translate-x-full data-starting-style:opacity-100 data-ending-style:opacity-100"
          showCloseButton={false}
          initialFocus={closeButton}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
            <SheetTitle className="font-heading text-lg tracking-tight">
              Navigation
            </SheetTitle>
            <SheetClose
              ref={closeButton}
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11 rounded-full"
                />
              }
              aria-label="Close navigation"
            >
              <X aria-hidden="true" />
            </SheetClose>
          </div>
          <nav
            aria-label="Owner navigation"
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-5"
          >
            {destinations.map(({ key, label, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={current === key ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold no-underline hover:bg-muted aria-[current=page]:bg-secondary",
                  key === "settings" &&
                    "relative mt-3 before:absolute before:inset-x-0 before:-top-[7px] before:border-t before:border-border",
                )}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted px-5 py-4">
            <strong className="min-w-0 flex-1 break-words text-[13px]">
              {shopName}
            </strong>
            <OwnerSignOut />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
