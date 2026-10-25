"use server";

import { headers } from "next/headers";
import type { ActionResult } from "@/lib/action-result";
import { resolvePublicRequest } from "@/server/public-request";
import { classifyHost, hasRequestOrigin } from "@/server/hosts";
import type {
  ManagedBookingView,
  PublicBookingInput,
  PublicBookingReceipt,
} from "./types";
import { createPublicBooking } from "./mutations";
import { getManagedBooking } from "./queries";
import { previewPublicSlots } from "@/features/shops/public-queries";

export async function getBookingSlotsAction(input: {
  serviceId: string;
  barberId: string;
  date: string;
}) {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "shop" ||
    !hasRequestOrigin(requestHeaders)
  )
    return null;
  return previewPublicSlots(requestHeaders, input);
}

export async function createPublicBookingAction(
  input: PublicBookingInput,
): Promise<ActionResult<PublicBookingReceipt>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "shop" ||
    !hasRequestOrigin(requestHeaders)
  )
    return {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "Booking is unavailable.",
      },
    };
  const context = await resolvePublicRequest(requestHeaders);
  return createPublicBooking(context, input);
}

export async function getManagedBookingAction(
  token: string,
): Promise<ActionResult<ManagedBookingView>> {
  const context = await resolvePublicRequest(await headers());
  return getManagedBooking(context, token);
}
