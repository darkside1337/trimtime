import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { OwnerActivity } from "@/features/notifications/components/owner-activity";
import { getOwnUpcomingBookings } from "@/features/bookings/queries";
import { getOwnShop } from "@/features/shops/queries";
import {
  getOwnBookingActivity,
  getOwnNotificationActivity,
} from "@/features/notifications/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function ActivityPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <ActivityContent />
    </Suspense>
  );
}

async function ActivityContent() {
  await connection();
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  let activity = null;
  let changes = null;
  let upcoming = null;
  let loadFailed = false;
  try {
    const [result, changeResult, upcomingResult] = await Promise.all([
      getOwnNotificationActivity(context),
      getOwnBookingActivity(context),
      getOwnUpcomingBookings(context),
    ]);
    if (result.success && changeResult.success && upcomingResult.success) {
      activity = result.data;
      changes = changeResult.data;
      upcoming = upcomingResult.data.appointments;
    } else loadFailed = true;
  } catch {
    loadFailed = true;
  }
  return (
    <OwnerActivity
      shop={shop}
      activity={activity}
      changes={changes}
      upcoming={upcoming}
      loadFailed={loadFailed}
    />
  );
}
