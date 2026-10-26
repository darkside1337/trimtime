import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OwnerActivity } from "@/features/shops/components/owner-activity";
import { getOwnShop } from "@/features/shops/queries";
import { getOwnNotificationActivity } from "@/features/notifications/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function ActivityPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <ActivityContent />
    </Suspense>
  );
}

async function ActivityContent() {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  let activity = null;
  let loadFailed = false;
  try {
    const result = await getOwnNotificationActivity(context);
    if (result.success) activity = result.data;
    else loadFailed = true;
  } catch {
    loadFailed = true;
  }
  return (
    <OwnerActivity shop={shop} activity={activity} loadFailed={loadFailed} />
  );
}
