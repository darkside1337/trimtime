"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shop as styles } from "../shop-styles";
import { display, Hero, SiteHeader } from "./manage-booking-shell";

export function UnavailableManageBooking() {
  return (
    <main
      className={cn(
        styles.page,
        display.variable,
        "[--primary:#21734f] [--primary-foreground:#fff] [--radius-pill:2px]",
      )}
    >
      <div className={styles.noticeBar}>
        <span>Fictional shop · Real attention to detail</span>
        <span>Private booking link</span>
      </div>
      <SiteHeader name="TrimTime" />
      <Hero />
      <section
        className={`${styles.wrap} border-t-[3px] border-[#242424] py-10`}
      >
        <h2 className={styles.displayHeading}>Booking link unavailable</h2>
        <p className="mt-5 max-w-2xl text-[#72726e]">
          This link may be missing, invalid, expired, or unavailable. No booking
          details can be shown.
        </p>
        <Link
          className={buttonVariants({ variant: "outline", className: "mt-7" })}
          data-slot="button"
          data-size="default"
          data-variant="outline"
          href="/"
        >
          Back to the shop
        </Link>
      </section>
      <footer
        className={`${styles.footer} ${styles.wrap} mt-20 border-t border-[#e6e6e2]`}
      >
        <span className={styles.footerWordmark}>
          TrimTime<span className={styles.greenDot}>.</span>
        </span>
        <p className={styles.footerNote}>Keep private booking links private.</p>
      </footer>
    </main>
  );
}
