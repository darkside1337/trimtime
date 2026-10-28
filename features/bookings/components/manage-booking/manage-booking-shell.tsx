"use client";

import { Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { shop as styles } from "../shop-styles";

export const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-shop-display",
  display: "swap",
});

export function SiteHeader({
  name,
  publicContact,
}: {
  name: string;
  publicContact?: string;
}) {
  return (
    <header
      className={cn(
        styles.wrap,
        "flex min-h-[92px] items-center justify-between gap-6 border-b border-[#242424] py-3 max-[767px]:min-h-[84px] max-[767px]:gap-3",
      )}
    >
      <Link className={styles.wordmark} href="/" aria-label={name}>
        {name}
        <span className={styles.greenDot}>.</span>
      </Link>
      <nav aria-label="Shop navigation" className={styles.siteNav}>
        <Link href="/">Back to the shop</Link>
        {publicContact ? <span>{publicContact}</span> : null}
      </nav>
    </header>
  );
}

export function Footer({ name }: { name: string }) {
  return (
    <footer
      className={`${styles.footer} ${styles.wrap} mt-20 border-t border-[#e6e6e2]`}
    >
      <span className={styles.footerWordmark}>
        {name}
        <span className={styles.greenDot}>.</span>
      </span>
      <p className={styles.footerNote}>
        Your booking link is private. Keep it that way.
      </p>
    </footer>
  );
}

export function Hero() {
  return (
    <section
      className={cn(
        styles.wrap,
        "flex items-end justify-between gap-8 py-12 max-[767px]:flex-col max-[767px]:items-start max-[767px]:gap-5 max-[767px]:py-8",
      )}
    >
      <h1 className="font-[family-name:var(--font-shop-display)] text-[88px] font-bold uppercase leading-[0.95] tracking-[-0.025em] max-[1024px]:text-[72px] max-[767px]:text-[48px]">
        Your chair.
        <br />
        Your plans<span className={styles.greenDot}>.</span>
      </h1>
      <p className="max-w-[26ch] text-sm leading-[1.8] text-[#72726e]">
        A fresh time, a change of plans.
        <br />
        Take care of it here.
      </p>
    </section>
  );
}
