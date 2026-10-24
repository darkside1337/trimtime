import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OwnerHome } from "@/features/shops/components/owner-home";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function OwnerPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <OwnerHomeContent />
    </Suspense>
  );
}

async function OwnerHomeContent() {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: shop.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const initialDate = `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
  return <OwnerHome shop={shop} initialDate={initialDate} />;
}
