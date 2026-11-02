import { describe, expect, it } from "vitest";
import {
  OWNER_APPOINTMENT_DETAILS_DIALOG_ATTRIBUTES,
  OWNER_APPOINTMENT_DIALOG_ATTRIBUTE,
  OWNER_APPOINTMENT_DIALOG_SELECTOR,
  OWNER_APPOINTMENT_ENTRY_DIALOG_ATTRIBUTES,
  findVisibleOwnerAppointmentDialog,
} from "../components/appointment-dialog-attributes";

function dialog(portal: { hasAttribute: (name: string) => boolean } | null) {
  return {
    closest: (selector: string) =>
      selector === "[data-base-ui-portal]" ? portal : null,
  } as unknown as HTMLElement;
}

describe("owner appointment dialog markers", () => {
  it("uses a stable marker for both intercepted appointment dialogs", () => {
    expect(
      OWNER_APPOINTMENT_ENTRY_DIALOG_ATTRIBUTES[
        OWNER_APPOINTMENT_DIALOG_ATTRIBUTE
      ],
    ).toBe("entry");
    expect(
      OWNER_APPOINTMENT_DETAILS_DIALOG_ATTRIBUTES[
        OWNER_APPOINTMENT_DIALOG_ATTRIBUTE
      ],
    ).toBe("details");
    expect(OWNER_APPOINTMENT_DIALOG_SELECTOR).toContain(
      `[${OWNER_APPOINTMENT_DIALOG_ATTRIBUTE}]`,
    );
    expect(OWNER_APPOINTMENT_DIALOG_SELECTOR).not.toContain("New appointment");
    expect(OWNER_APPOINTMENT_DIALOG_SELECTOR).not.toContain(
      "Appointment details",
    );
  });

  it("keeps visible/non-inert portal filtering", () => {
    const hidden = dialog({
      hasAttribute: (name) => name === "aria-hidden",
    });
    const inert = dialog({ hasAttribute: (name) => name === "inert" });
    const visible = dialog({ hasAttribute: () => false });

    expect(findVisibleOwnerAppointmentDialog([hidden, inert, visible])).toBe(
      visible,
    );
    expect(findVisibleOwnerAppointmentDialog([hidden, inert])).toBeUndefined();
  });

  it("accepts a dialog outside a portal", () => {
    const outsidePortal = dialog(null);

    expect(findVisibleOwnerAppointmentDialog([outsidePortal])).toBe(
      outsidePortal,
    );
  });
});
