"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { classifyHost, hasOwnerOrigin } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import { archiveBarber, saveBarber } from "./mutations";
import type { BarberView } from "@/features/catalog/types";

function denied(): ActionResult<BarberView> {
  return {
    success: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "This action is only available from the owner app.",
    },
  };
}
function fields(formData: FormData) {
  return Object.fromEntries(
    [...formData].filter(
      ([key]) => !key.startsWith("$ACTION_") && key !== "serviceIds",
    ),
  );
}
async function authorize() {
  const requestHeaders = await headers();
  if (
    classifyHost(requestHeaders) !== "owner" ||
    !hasOwnerOrigin(requestHeaders)
  )
    return null;
  return readOwnerContext(requestHeaders);
}
function refresh() {
  revalidatePath("/owner/services");
  revalidatePath("/owner/barbers");
  revalidatePath("/owner/availability");
}

export async function saveBarberAction(
  _previous: ActionResult<BarberView> | null,
  formData: FormData,
) {
  const context = await authorize();
  if (!context) return denied();
  const result = await saveBarber(context, {
    ...fields(formData),
    serviceIds: formData.getAll("serviceIds"),
  });
  if (result.success) refresh();
  return result;
}

export async function archiveBarberAction(
  id: string,
): Promise<ActionResult<BarberView>> {
  const context = await authorize();
  if (!context) return denied();
  const result = await archiveBarber(context, id);
  if (result.success) refresh();
  return result;
}
