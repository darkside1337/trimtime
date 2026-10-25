import type { ReactNode } from "react";
import Link from "next/link";
import { TrimTimeLogo } from "./trimtime-logo";

export function OwnerPageHeader({
  children,
  homeHref = "/",
}: {
  children: ReactNode;
  homeHref?: string;
}) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex min-h-[76px] max-w-[1176px] items-center justify-between gap-5 px-5 md:min-h-24 md:px-7">
        <Link
          href={homeHref}
          className="inline-flex min-h-11 w-[152px] shrink-0 items-center md:w-[180px]"
        >
          <TrimTimeLogo arrangement="horizontal" width={180} />
        </Link>
        {children}
      </div>
    </header>
  );
}

export function OwnerPageFooter() {
  return (
    <footer className="border-t border-border py-5 text-[13px] text-muted-foreground md:py-6">
      <div className="mx-auto w-full max-w-[1176px] px-5 md:px-7">TrimTime</div>
    </footer>
  );
}
