import { expect, openOwnerNavigation, ownerOrigin, test } from "./fixtures";

test("owner routes render without unstable session timestamps", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("unstable value `new Date()`")
    ) {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto(ownerOrigin);
  for (const route of [
    { name: "Services", path: "/services", heading: "Services management" },
    {
      name: "Availability",
      path: "/availability",
      heading: "Shop and barber availability",
    },
    {
      name: "Activity",
      path: "/activity",
      heading: "Booking activity & message status",
    },
    {
      name: "Settings",
      path: "/settings",
      heading: "Shop settings & public link",
    },
    {
      name: "Barbers",
      path: "/barbers",
      heading: "Barber profiles and service assignments",
    },
  ]) {
    await openOwnerNavigation(page);
    await page
      .getByRole("navigation", { name: "Owner navigation" })
      .getByRole("link", { name: route.name, exact: true })
      .click();
    await expect(page).toHaveURL(`${ownerOrigin}${route.path}`);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
  }

  expect(runtimeErrors).toEqual([]);

  await context.clearCookies();
  await page.goto(`${ownerOrigin}/availability`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
  expect(runtimeErrors).toEqual([]);
});
