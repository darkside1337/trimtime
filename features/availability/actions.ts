"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { classifyHost, hasOwnerOrigin } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import { saveBarberSchedule, saveShopSchedule } from "./mutations";
import {
  getOwnSchedules,
  previewOwnSlots,
  type AvailabilityData,
} from "./queries";
import type { ScheduleView } from "./types";

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

export async function reloadOwnSchedulesAction(): Promise<AvailabilityData | null> {
  const context = await ownerContext();
  if (!context) return null;
  return getOwnSchedules(context);
}
