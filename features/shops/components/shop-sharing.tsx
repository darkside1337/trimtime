"use client";

import { useState } from "react";
import Image from "next/image";
import { Copy, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrimTimeLogo } from "@/components/trimtime-logo";

export function ShopSharing({ url, qrData, qrAvailable, shopName, address }: {
  url: string;
  qrData: string;
  qrAvailable: boolean;
  shopName: string;
  address: string;
}) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setFeedback("Shop link copied.");
    } catch {
      setFeedback("Copy isn’t available here. Select the link above and copy it manually.");
    }
  }
  return <>
    <section aria-labelledby="sharing-heading" className="owner-settings-card">
      <header className="owner-settings-card-header">
        <h2 id="sharing-heading">Shop booking link</h2>
        <p>Share this permanent link with customers or add it to your social bio.</p>
      </header>
      <label className="grid min-w-0 gap-2 text-xs font-medium">
        Public shop link
        <Input aria-label="Public shop link" readOnly value={url}
          onFocus={(event) => event.currentTarget.select()} />
      </label>
      <div className="grid gap-2">
        <Button type="button" onClick={copy}><Copy data-icon="inline-start" />Copy link</Button>
        <a href={url} target="_blank" rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-semibold hover:bg-muted">
          <ExternalLink className="size-4" aria-hidden="true" />Open public page
        </a>
      </div>
      {feedback && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{feedback}</p>}
    </section>
    <section aria-labelledby="qr-heading" className="owner-settings-card">
      <header className="owner-settings-card-header">
        <h2 id="qr-heading">Scannable shop QR code</h2>
        <p>A ready-to-share code for your counter or customers. The link opens your published or paused shop page.</p>
      </header>
      {qrAvailable ? <>
        <div className="rounded-xl border border-border bg-muted p-4">
          <div className="mx-auto grid w-full max-w-[260px] justify-items-center gap-3 rounded-xl border border-border bg-background px-4 py-6 text-center shadow-sm">
            <TrimTimeLogo arrangement="horizontal" width={100} />
            <strong className="max-w-full break-words font-heading text-lg">{shopName}</strong>
            <span className="text-[11px] text-muted-foreground">Scan to view this shop</span>
            <Image src={qrData} width={220} height={220}
              alt={`QR code linking to ${url}`} className="h-auto w-full max-w-[220px] border border-border bg-white p-2" unoptimized />
            <div className="grid max-w-full gap-1 text-[11px] text-muted-foreground">
              <p className="break-words">{address}</p>
              <p className="break-all font-semibold">{url}</p>
            </div>
          </div>
        </div>
        <a download="trimtime-shop.svg" href={qrData}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-semibold hover:bg-muted">
          <Download className="size-4" aria-hidden="true" />Download QR as SVG
        </a>
      </> : <p role="status" className="text-sm text-muted-foreground">The QR code is temporarily unavailable. The public link remains ready to copy or open.</p>}
    </section>
  </>;
}
