import {
  expect,
  captureState,
  marketingOrigin,
  openOwnerNavigation,
  ownerOrigin,
  test,
} from "./fixtures";

test("owner Activity shows a real empty state for a shop without notification records", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, name: "Preview Test Shop" });
  await page.goto(`${ownerOrigin}/activity`);

  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  await expect(
    page.getByText("Live notification records", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No notification records yet for this shop."),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Preview Test Shop", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("America/New_York", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("96.4% accepted", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Sample · accepted", { exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await captureState(page, `phase07-activity-empty-${width}`, test.info());
  }
});

test("calendar and Activity controls remain local preview state", async ({
  page,
  context,
  owners,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, "__storageWrites", { value: writes });
    const proto = Storage.prototype;
    const setItem = proto.setItem;
    const removeItem = proto.removeItem;
    const clear = proto.clear;
    proto.setItem = function (key, value) {
      writes.push(`${this === localStorage ? "local" : "session"}:setItem`);
      setItem.call(this, key, value);
    };
    proto.removeItem = function (key) {
      writes.push(`${this === localStorage ? "local" : "session"}:removeItem`);
      removeItem.call(this, key);
    };
    proto.clear = function () {
      writes.push(`${this === localStorage ? "local" : "session"}:clear`);
      clear.call(this);
    };
  });
  const mutations: string[] = [];
  const storageWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      mutations.push(request.method());
    }
  });
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/`);
  const date = page.locator("[aria-live=polite]").first();
  const initialDate = await date.textContent();
  await page.getByRole("button", { name: "Next date" }).click();
  await expect(date).not.toHaveText(initialDate ?? "");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Barber" }).click();
  await page.getByRole("option", { name: "Amal", exact: true }).click();
  const sampleAppointment = page.getByRole("button", {
    name: /Sample appointment: Samir Bensaid/,
  });
  await sampleAppointment.click();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toContainText("Sample");
  await expect(
    page.getByRole("button", { name: "Preview mark completed" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Preview mark no-show" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Preview move" }).click();
  await page.getByRole("button", { name: "Preview new time" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "No schedule changed",
  );
  await page.getByRole("button", { name: "Back to details" }).click();
  await page.getByRole("button", { name: "Preview cancellation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Preview cancellation" })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "schedule are unchanged",
  );

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeHidden();
  const pastAppointment = page.getByRole("button", {
    name: /Sample appointment: Nadia Benali/,
  });
  await pastAppointment.click();
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toContainText("Past, unmarked");
  await expect(page.getByRole("button", { name: "Preview move" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Preview cancellation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Preview mark completed" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "state and schedule are unchanged",
  );
  await page.getByRole("button", { name: "Preview mark no-show" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "state and schedule are unchanged",
  );
  storageWrites.push(
    ...(await page.evaluate(
      () =>
        (window as unknown as Window & { __storageWrites: string[] })
          .__storageWrites,
    )),
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Appointment details" }),
  ).toBeHidden();
  await expect(pastAppointment).toBeFocused();
  await page.getByRole("button", { name: "New appointment" }).click();
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toContainText("not saved");
  await expect(
    page.getByText("Duration: 30 minutes", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Customer name").fill("Sample only");
  await page.getByRole("button", { name: "Preview appointment" }).click();
  await expect(page.locator("#preview-appointment-status")).toContainText(
    "no appointment was created",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  storageWrites.push(
    ...(await page.evaluate(
      () =>
        (window as unknown as Window & { __storageWrites: string[] })
          .__storageWrites,
    )),
  );
  await openOwnerNavigation(page);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Booking activity & message status" }),
  ).toBeVisible();
  await expect(
    page.getByText("No notification records yet for this shop."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resend unavailable" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Export unavailable" }),
  ).toBeDisabled();
  await page.getByLabel("Search activity").fill("no matches");
  await expect(
    page.getByText("No notification records yet for this shop."),
  ).toBeVisible();
  storageWrites.push(
    ...(await page.evaluate(
      () =>
        (window as unknown as Window & { __storageWrites: string[] })
          .__storageWrites,
    )),
  );
  expect(mutations).toEqual([]);
  expect(storageWrites).toEqual([]);
});

test("Activity requires an owner", async ({ page }) => {
  await page.goto(`${ownerOrigin}/activity`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
});

test("Activity requires a shop for a signed-in owner", async ({
  page,
  context,
  owners,
}) => {
  await owners(context);
  await page.goto(`${ownerOrigin}/activity`);
  await expect(page).toHaveURL(`${ownerOrigin}/setup`);
});

test("design-system section navigation fits a 390px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${marketingOrigin}/design-system`);
  const nav = page.getByRole("navigation", { name: "Page sections" });
  await expect(nav.getByRole("link", { name: "Components" })).toBeVisible();
  expect(
    await nav.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(await nav.evaluate((element) => element.clientWidth));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
