import { expect, ownerOrigin, test } from "./fixtures";

test("saved appointment opens in an intercepted dialog and direct navigation is standalone", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, appointment: true });
  const calendar = `${ownerOrigin}/?date=2026-11-02&view=day`;
  await page.goto(calendar);
  await page.setViewportSize({ width: 390, height: 760 });
  const calendarRegion = page.getByRole("region", { name: "Daily calendar" });
  const card = page.getByRole("link", {
    name: /Appointment: Fictional Guest, Saved Cut, Saved Barber/,
  });
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const scrollBeforeDialog = await page.evaluate(() => ({
    document: window.scrollY,
    calendar: document.querySelector('[aria-label="Daily calendar"]')
      ?.scrollTop,
  }));
  await card.click();
  await expect(page).toHaveURL(
    new RegExp(`/appointments/${owner.appointmentId}`),
  );
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toContainText("Fictional Guest");
  await expect(page.getByRole("dialog")).toContainText("No email provided");
  await expect(page.getByRole("dialog")).not.toContainText("ciphertext-");
  await expect(page.getByRole("link", { name: "Open full page" })).toHaveCount(
    0,
  );

  await page.goBack();
  await expect(page).toHaveURL(calendar);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: window.scrollY,
        calendar: document.querySelector('[aria-label="Daily calendar"]')
          ?.scrollTop,
      })),
    )
    .toEqual(scrollBeforeDialog);
  await expect(calendarRegion).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Saved Cut");
  await page.reload();
  await expect(page.getByRole("main")).toContainText("Fictional Guest");
  await expect(
    page.getByRole("link", { name: "Back to calendar" }),
  ).toBeVisible();
});

test("unknown appointment IDs use the generic not-found route", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(
    `${ownerOrigin}/appointments/80d2a60d-f48d-4c7e-96b4-8f293938b497`,
  );
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  await expect(
    page.getByText(/Fictional Guest|email|ciphertext-/i),
  ).toHaveCount(0);
});
