import { useEffect, type RefObject } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { ShopView } from "../queries";

export function FormFeedback({ state, form, successMessage }: {
  state: ActionResult<ShopView> | null; form: RefObject<HTMLFormElement | null>; successMessage?: string;
}) {
  useEffect(() => {
    if (state && !state.success) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
    }
  }, [state, form]);
  if (!state) return null;
  if (state.success) return successMessage ? <p role="status">{successMessage}</p> : null;
  return <p role="alert" tabIndex={-1} className="text-sm text-destructive-text">{state.error.message}</p>;
}
