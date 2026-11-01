import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerActivity } from "../components/owner-activity";

const shop = {
  id: "shop-id",
  name: "Juniper Barber",
  subdomain: "juniper",
  timeZone: "America/New_York",
  publicContact: "Call 202-555-0142",
  address: "123 Example Street",
  published: false,
};

describe("owner Activity read states", () => {
  it("distinguishes empty upcoming, change, and message records and unavailable reminders", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: { rows: [] },
        changes: { rows: [] },
        upcoming: [],
      }),
    );

    expect(markup).toContain("No upcoming confirmed bookings.");
    expect(markup).toContain("No appointment changes recorded for this shop.");
    expect(markup).toContain("No notification records yet for this shop.");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Reminders unavailable/);
    expect(markup).toContain("Reminders are not available in this phase.");
    expect(markup).not.toContain("Activity could not be loaded.");
  });

  it("renders read failure separately from successful empty reads", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: null,
        changes: null,
        upcoming: null,
        loadFailed: true,
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Activity could not be loaded. Try again later.");
    expect(markup).not.toContain("No upcoming confirmed bookings.");
    expect(markup).not.toContain(
      "No appointment changes recorded for this shop.",
    );
    expect(markup).not.toContain("No notification records yet for this shop.");
  });
});
