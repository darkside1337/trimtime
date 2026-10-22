"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { classifyHost, hasOwnerOrigin } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import {
  createTimeBlock,
  removeTimeBlock,
  saveBarberDateSchedule,
  saveBarberSchedule,
  saveShopDateSchedule,
  saveShopSchedule,
} from "./mutations";
import {
  getOwnSchedules,
  getOwnDateAvailability,
  previewOwnSlots,
  type AvailabilityData,
} from "./queries";
import type { ScheduleView } from "./types";
import type {
  DateScheduleView,
  TimeBlockView,
  DateAvailabilityView,
} from "./types";
import { blockBoundarySchema } from "./schemas";
import { getBlockBoundaryChoices } from "./block-times";

async function ownerContext() {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "owner" ||
    !hasOwnerOrigin(requestHeaders)
  )
    return null;
  return readOwnerContext(requestHeaders);
}

function denied<T>(): ActionResult<T> {
  return {
    success: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "This action is only available from the owner app.",
    },
  };
}

export async function saveShopScheduleAction(
  input: unknown,
): Promise<ActionResult<ScheduleView>> {
  const context = await ownerContext();
  if (!context) return denied();
  const result = await saveShopSchedule(context, input);
  if (result.success) revalidatePath("/owner/availability");
  return result;
}

export async function saveBarberScheduleAction(
  input: unknown,
): Promise<ActionResult<ScheduleView>> {
  const context = await ownerContext();
  if (!context) return denied();
  const result = await saveBarberSchedule(context, input);
  if (result.success) revalidatePath("/owner/availability");
  return result;
}

export async function previewOwnSlotsAction(input: unknown) {
  const context = await ownerContext();
  if (!context)
    return denied<{
      timeZone: string;
      date: string;
      slots: import("./types").Slot[];
    }>();
  return previewOwnSlots(context, input);
}

export async function getOwnDateAvailabilityAction(
  input: unknown,
): Promise<ActionResult<DateAvailabilityView>> {
  const context = await ownerContext();
  if (!context) return denied();
  return getOwnDateAvailability(context, input);
}

export async function saveShopDateScheduleAction(
  input: unknown,
): Promise<ActionResult<DateScheduleView>> {
  const context = await ownerContext();
  if (!context) return denied();
  const result = await saveShopDateSchedule(context, input);
  if (result.success) revalidatePath("/owner/availability");
  return result;
}

export async function saveBarberDateScheduleAction(
  input: unknown,
): Promise<ActionResult<DateScheduleView>> {
  const context = await ownerContext();
  if (!context) return denied();
  const result = await saveBarberDateSchedule(context, input);
  if (result.success) revalidatePath("/owner/availability");
  return result;
}

export async function createTimeBlockAction(
  input: unknown,
): Promise<ActionResult<TimeBlockView>> {
  const context = await ownerContext();
  if (!context) return denied();
  const result = await createTimeBlock(context, input);
  if (result.success) revalidatePath("/owner/availability");
  return result;
}

export async function removeTimeBlockAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const context = await ownerContext();
  if (!context) return denied();
  const result = await removeTimeBlock(context, input);
  if (result.success) revalidatePath("/owner/availability");
  return result;
}

export async function getBlockBoundaryChoicesAction(input: unknown) {
  const context = await ownerContext();
  if (!context) return denied<{ instant: string; offset: string }[]>();
  const parsed = blockBoundarySchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false as const,
      error: {
        code: "VALIDATION_ERROR",
        message: "Choose a valid date and time.",
      },
    };
  const availability = await getOwnSchedules(context);
  if (!availability)
    return {
      success: false as const,
      error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
    };
  try {
    return {
      success: true as const,
      data: getBlockBoundaryChoices({
        ...parsed.data,
        timeZone: availability.timeZone,
      }),
    };
  } catch {
    return {
      success: false as const,
      error: {
        code: "VALIDATION_ERROR",
        message: "That local time does not exist in the shop time zone.",
      },
    };
  }
}

export async function reloadOwnSchedulesAction(): Promise<AvailabilityData | null> {
  const context = await ownerContext();
  if (!context) return null;
  return getOwnSchedules(context);
}
