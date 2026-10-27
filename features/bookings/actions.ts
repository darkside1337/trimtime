"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { resolvePublicRequest } from "@/server/public-request";
import { classifyHost, hasOwnerOrigin, hasRequestOrigin } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import type {
  ManagedBookingView,
  PublicBookingInput,
  PublicBookingReceipt,
  OwnerBookingReceipt,
} from "./types";
import { createOwnerBooking, createPublicBooking } from "./mutations";
import { getManagedBooking } from "./queries";
import { previewPublicSlots } from "@/features/shops/public-queries";
import { dispatchInitialBookingNotifications } from "@/features/notifications/dispatch";

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
  const result = await createPublicBooking(context, input);
  if (result.success) {
    const { bookingId } = result.data;
    revalidatePath("/owner");
    revalidatePath("/owner/activity");
    after(() =>
      dispatchInitialBookingNotifications(bookingId).catch(() => {
        console.error("Booking notification dispatch failed.", { bookingId });
      }),
    );
  }
  return result;
}

export async function createOwnerBookingAction(
  input: unknown,
): Promise<ActionResult<OwnerBookingReceipt>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "owner" ||
    !hasOwnerOrigin(requestHeaders)
  )
    return {
      success: false,
      error: { code: "UNAVAILABLE", message: "Appointment is unavailable." },
    };
  const result = await createOwnerBooking(
    await readOwnerContext(requestHeaders),
    input,
  );
  if (result.success) {
    const { bookingId } = result.data;
    revalidatePath("/owner");
    revalidatePath("/owner/activity");
    after(() =>
      dispatchInitialBookingNotifications(bookingId).catch(() => {
        console.error("Booking notification dispatch failed.", { bookingId });
      }),
    );
  }
  return result;
}

export async function getManagedBookingAction(
  token: string,
): Promise<ActionResult<ManagedBookingView>> {
  const context = await resolvePublicRequest(await headers());
  return getManagedBooking(context, token);
}
