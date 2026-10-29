"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { resolvePublicRequest } from "@/server/public-request";
import { classifyHost, hasOwnerOrigin, hasRequestOrigin } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import type {
  CustomerCancellationReceipt,
  CustomerReplacementChoices,
  CustomerReplacementReceipt,
  CustomerReplacementSlotsView,
  ManagedBookingView,
  PublicBookingInput,
  PublicBookingReceipt,
  OwnerBookingReceipt,
  OwnerChangeReceipt,
} from "./types";
import {
  cancelOwnerBooking,
  createOwnerBooking,
  createPublicBooking,
  moveOwnerBooking,
  replaceCustomerBooking,
} from "./mutations";
import { cancelCustomerBooking } from "./customer-mutations";
import {
  getCustomerReplacementChoices,
  getCustomerReplacementSlots,
  getManagedBooking,
} from "./queries";
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

export async function getCustomerReplacementChoicesAction(
  token: string,
): Promise<ActionResult<CustomerReplacementChoices>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "shop" ||
    !hasRequestOrigin(requestHeaders)
  )
    return {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
  const context = await resolvePublicRequest(requestHeaders);
  return getCustomerReplacementChoices(context, token);
}

export async function getCustomerReplacementSlotsAction(
  input: unknown,
): Promise<ActionResult<CustomerReplacementSlotsView>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "shop" ||
    !hasRequestOrigin(requestHeaders)
  )
    return {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
  const context = await resolvePublicRequest(requestHeaders);
  return getCustomerReplacementSlots(context, input);
}

function customerCancellationToken(input: unknown) {
  if (typeof input !== "object" || input === null || !("token" in input))
    return null;
  const token = (input as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function cancelCustomerBookingAction(
  input: unknown,
): Promise<ActionResult<CustomerCancellationReceipt>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "shop" ||
    !hasRequestOrigin(requestHeaders)
  )
    return {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
  const context = await resolvePublicRequest(requestHeaders);
  const result = await cancelCustomerBooking(context, input);
  if (result.success) {
    const { bookingId } = result.data;
    revalidatePath("/owner");
    revalidatePath(`/owner/appointments/${bookingId}`);
    revalidatePath("/owner/activity");
    const token = customerCancellationToken(input);
    if (token) revalidatePath(`/manage/${token}`);
    after(() =>
      dispatchInitialBookingNotifications(bookingId).catch(() => {
        console.error("Customer cancellation notification dispatch failed.", {
          bookingId,
        });
      }),
    );
  }
  return result;
}

export async function replaceCustomerBookingAction(
  input: unknown,
): Promise<ActionResult<CustomerReplacementReceipt>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "shop" ||
    !hasRequestOrigin(requestHeaders)
  )
    return {
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "This booking link is unavailable.",
      },
    };
  const context = await resolvePublicRequest(requestHeaders);
  const result = await replaceCustomerBooking(context, input);
  if (result.success) {
    const { bookingId } = result.data;
    revalidatePath("/owner");
    revalidatePath(`/owner/appointments/${bookingId}`);
    revalidatePath("/owner/activity");
    const token = customerCancellationToken(input);
    if (token) revalidatePath(`/manage/${token}`);
    after(() =>
      dispatchInitialBookingNotifications(bookingId).catch(() => {
        console.error("Customer replacement notification dispatch failed.", {
          bookingId,
        });
      }),
    );
  }
  return result;
}

export async function moveOwnerBookingAction(
  input: unknown,
): Promise<ActionResult<OwnerChangeReceipt>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "owner" ||
    !hasOwnerOrigin(requestHeaders)
  )
    return {
      success: false,
      error: { code: "UNAVAILABLE", message: "Appointment is unavailable." },
    };
  const result = await moveOwnerBooking(
    await readOwnerContext(requestHeaders),
    input,
  );
  if (result.success) {
    const { bookingId } = result.data;
    revalidatePath("/owner");
    revalidatePath(`/owner/appointments/${bookingId}`);
    revalidatePath("/owner/activity");
    after(() =>
      dispatchInitialBookingNotifications(bookingId).catch(() => {
        console.error("Booking update notification dispatch failed.", {
          bookingId,
        });
      }),
    );
  }
  return result;
}

export async function cancelOwnerBookingAction(
  input: unknown,
): Promise<ActionResult<OwnerChangeReceipt>> {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "owner" ||
    !hasOwnerOrigin(requestHeaders)
  )
    return {
      success: false,
      error: { code: "UNAVAILABLE", message: "Appointment is unavailable." },
    };
  const result = await cancelOwnerBooking(
    await readOwnerContext(requestHeaders),
    input,
  );
  if (result.success) {
    const { bookingId } = result.data;
    revalidatePath("/owner");
    revalidatePath(`/owner/appointments/${bookingId}`);
    revalidatePath("/owner/activity");
    after(() =>
      dispatchInitialBookingNotifications(bookingId).catch(() => {
        console.error("Booking cancellation notification dispatch failed.", {
          bookingId,
        });
      }),
    );
  }
  return result;
}
