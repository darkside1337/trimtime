"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { classifyHost, hasOwnerOrigin } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import { archiveService, saveService, setServiceOffered } from "./mutations";
import type { ServiceView } from "./types";

function denied(): ActionResult<ServiceView> {
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
      ([key]) => !key.startsWith("$ACTION_") && key !== "barberIds",
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
}

export async function saveServiceAction(
  _previous: ActionResult<ServiceView> | null,
  formData: FormData,
) {
  const context = await authorize();
  if (!context) return denied();
  const result = await saveService(context, {
    ...fields(formData),
    offered: formData.get("offered") === "true",
    barberIds: formData.getAll("barberIds"),
  });
  if (result.success) refresh();
  return result;
}

export async function setServiceOfferedAction(
  id: string,
  offered: boolean,
): Promise<ActionResult<ServiceView>> {
  const context = await authorize();
  if (!context) return denied();
  const result = await setServiceOffered(context, { id, offered });
  if (result.success) refresh();
  return result;
}

export async function archiveServiceAction(
  id: string,
): Promise<ActionResult<ServiceView>> {
  const context = await authorize();
  if (!context) return denied();
  const result = await archiveService(context, id);
  if (result.success) refresh();
  return result;
}
