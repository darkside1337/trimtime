import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import {
  ManageBooking,
  UnavailableManageBooking,
} from "@/features/bookings/components/manage-booking";
import { getManagedBooking } from "@/features/bookings/queries";
import { resolvePublicRequest } from "@/server/public-request";

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export default function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <ManageBookingContent params={params} />
    </Suspense>
  );
}

async function ManageBookingContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, requestHeaders] = await Promise.all([params, headers()]);
  const context = await resolvePublicRequest(requestHeaders);
  const result = await getManagedBooking(context, token);
  if (!result.success) return <UnavailableManageBooking />;
  return <ManageBooking booking={result.data} past={result.data.past} />;
}
