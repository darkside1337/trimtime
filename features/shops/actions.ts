"use server";

import { headers } from "next/headers";
import type { ActionResult } from "@/lib/action-result";
import { hasOwnerOrigin, classifyHost } from "@/server/hosts";
import { readOwnerContext } from "@/server/owner-context";
import type { ShopView } from "./queries";
import { createShop, updateOwnShop } from "./mutations";

function denied(): ActionResult<ShopView> { return { success: false, error: { code: "UNAUTHENTICATED", message: "This action is only available from the owner app." } }; }

function formInput(formData: FormData) {
  // React adds action metadata; retain every application field for strict validation.
  return Object.fromEntries([...formData].filter(([key]) => !key.startsWith("$ACTION_")));
}

export async function createShopAction(_previous: ActionResult<ShopView> | null, formData: FormData) {
  const requestHeaders = await headers();
  if (classifyHost(requestHeaders) !== "owner" || !hasOwnerOrigin(requestHeaders)) return denied();
  return createShop(await readOwnerContext(requestHeaders), formInput(formData));
}

export async function updateShopAction(_previous: ActionResult<ShopView> | null, formData: FormData) {
  const requestHeaders = await headers();
  if (classifyHost(requestHeaders) !== "owner" || !hasOwnerOrigin(requestHeaders)) return denied();
  return updateOwnShop(await readOwnerContext(requestHeaders), formInput(formData));
}
