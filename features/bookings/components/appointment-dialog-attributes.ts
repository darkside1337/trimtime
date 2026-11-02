export const OWNER_APPOINTMENT_DIALOG_ATTRIBUTE =
  "data-owner-appointment-dialog";

export const OWNER_APPOINTMENT_ENTRY_DIALOG_ATTRIBUTES = {
  [OWNER_APPOINTMENT_DIALOG_ATTRIBUTE]: "entry",
} as const;

export const OWNER_APPOINTMENT_DETAILS_DIALOG_ATTRIBUTES = {
  [OWNER_APPOINTMENT_DIALOG_ATTRIBUTE]: "details",
} as const;

export const OWNER_APPOINTMENT_DIALOG_SELECTOR = `[role="dialog"][data-open][${OWNER_APPOINTMENT_DIALOG_ATTRIBUTE}]`;

/**
 * The history guard only needs an accessible intercepted appointment layer.
 * Ignore portals hidden by Next.js Activity or made inert by a pending modal
 * so focus/URL restoration does not target a stale dialog copy.
 */
export function findVisibleOwnerAppointmentDialog(
  dialogs: Iterable<HTMLElement>,
): HTMLElement | undefined {
  for (const dialog of dialogs) {
    const portal = dialog.closest<HTMLElement>("[data-base-ui-portal]");
    if (!portal?.hasAttribute("aria-hidden") && !portal?.hasAttribute("inert"))
      return dialog;
  }
  return undefined;
}
