import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  captureState,
  expect,
  openOwnerNavigation,
  ownerOrigin,
  test,
} from "./fixtures";

type DismissalMethod = "Close" | "Escape" | "outside click" | "Back";
const calendarUrl = `${ownerOrigin}/?date=2026-11-02&view=day`;

async function openNewAppointment(page: import("@playwright/test").Page) {
  await page.goto(calendarUrl);
  await page.getByRole("link", { name: "New appointment" }).click();
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toBeVisible();
}

async function dismissAppointment(
  page: import("@playwright/test").Page,
  method: DismissalMethod,
) {
  if (method === "Close")
    await page.getByRole("button", { name: "Close new appointment" }).click();
  if (method === "Escape") await page.keyboard.press("Escape");
  if (method === "outside click") await page.mouse.click(8, 8);
  if (method === "Back") await page.goBack();
}

async function fillDirtyAppointment(
  page: import("@playwright/test").Page,
  suffix: string,
) {
  await page.getByLabel("Customer name").fill(`Walk-in ${suffix}`);
  await page
    .getByLabel("Customer email (optional)")
    .fill(`walk-in-${suffix}@example.test`);
  await page.getByLabel("Customer phone (optional)").fill("+12025550142");
  await page
    .getByRole("checkbox", { name: /Customer explicitly opted in/ })
    .click();
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await page
    .getByRole("dialog", { name: "New appointment" })
    .locator("form select")
    .nth(1)
    .selectOption({ label: "Manual Barber" });
  await page.getByRole("textbox", { name: /^Date/ }).fill("2026-11-03");
  await page.getByLabel("Start time").fill("13:07");
}

async function capturePhase08State(
  page: import("@playwright/test").Page,
  state: string,
) {
  const info = test.info();
  await captureState(page, `${state}-${info.project.name}`, info);
  const directory = resolve("docs/reports/phase08-screenshots");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${state}-${info.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function captureDialogViewport(
  page: import("@playwright/test").Page,
  state: string,
) {
  const directory = resolve("docs/reports/phase08-screenshots");
  await mkdir(directory, { recursive: true });
  const info = test.info();
  await page.screenshot({
    path: resolve(
      directory,
      `${state}-${page.viewportSize()!.width}-${info.project.name}.png`,
    ),
    animations: "disabled",
  });
}

test("appointment overlay shows its loading skeleton while choices resolve", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, createSetup: true });
  let releaseResponse!: () => void;
  let markRequestHeld!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const requestHeld = new Promise<void>((resolve) => {
    markRequestHeld = resolve;
  });
  await page.route("**/appointments/new**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (route.request().headers()["next-router-prefetch"])
      return route.continue();
    markRequestHeld();
    await responseGate;
    await route.continue();
  });

  const prefetched = page.waitForResponse(
    (response) =>
      response.url().includes("/appointments/new") &&
      Boolean(response.request().headers()["next-router-prefetch"]),
  );
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await (await prefetched).finished();
  const click = page.getByRole("link", { name: "New appointment" }).click();
  try {
    await requestHeld;
    await expect(
      page.getByRole("status", { name: "Loading appointment form" }),
    ).toBeVisible();
    await captureDialogViewport(page, "appointment-loading");
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: "wait" });
  }
  await click;
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toBeVisible();
});

for (const entry of [
  { name: "New appointment", url: calendarUrl },
  { name: "+ Add at 00:00", url: calendarUrl },
  {
    name: "+ Add appointment",
    url: `${ownerOrigin}/?date=2026-11-02&view=week`,
  },
]) {
  test(`${entry.name} shows loading before an unavailable prefetch completes`, async ({
    page,
    context,
    owners,
  }) => {
    await owners(context, { shop: true, createSetup: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/appointments/new**", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(entry.url);
    const click = page
      .getByRole("link", { name: entry.name, exact: true })
      .first()
      .click();
    try {
      await expect(
        page.getByRole("status", { name: "Loading appointment form" }),
      ).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await click;
    await expect(
      page.getByRole("dialog", { name: "New appointment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Loading appointment form" }),
    ).toHaveCount(0);
  });
}

test("appointment overlay shows its saving state while the server action is pending", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  const dialog = page.getByRole("dialog", { name: "New appointment" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("Customer name").fill("Walk-through Guest");
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await dialog
    .locator("form select")
    .nth(1)
    .selectOption({ label: "Manual Barber" });
  await page.getByLabel("Start time").fill("13:07");

  let releaseAction!: () => void;
  let markActionHeld!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  const actionHeld = new Promise<void>((resolve) => {
    markActionHeld = resolve;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    markActionHeld();
    await actionGate;
    await route.continue();
  });

  const submit = page
    .getByRole("button", { name: "Create appointment" })
    .click();
  try {
    await actionHeld;
    await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
    await captureDialogViewport(page, "appointment-saving");
  } finally {
    releaseAction();
    await page.unrouteAll({ behavior: "wait" });
  }
  await submit;
  await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);
});

test("calendar shows the owner's saved schedule with URL-backed controls @device", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, name: "Calendar Test Shop" });
  await page.goto(`${ownerOrigin}/`);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Daily schedule" }),
  ).toBeVisible();
  await expect(page.getByText(/Sample appointments/i)).toHaveCount(0);
  await expect(page.getByText("No appointments in this range.")).toBeVisible();
  await expect(
    page.getByText(
      "Select a time to add an appointment. Availability is checked when you save.",
    ),
  ).toBeVisible();

  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/view=week/);
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Weekly calendar" }),
  ).toBeVisible();
});

test("calendar reads persisted records and owner barber filtering @device", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, {
    shop: true,
    appointment: true,
    published: true,
  });
  await page.goto(
    `${ownerOrigin}/?date=2026-11-02&view=day&barber=${owner.barberId}`,
  );
  await expect(
    page.getByRole("link", {
      name: /Appointment: Fictional Guest, Saved Cut/,
    }),
  ).toBeVisible();
  await expect(page.getByText("Shop published", { exact: true })).toBeVisible();
  await page.goto(
    `${ownerOrigin}/?date=2026-11-02&view=day&barber=00000000-0000-4000-8000-000000000000`,
  );
  await expect(page.getByRole("combobox", { name: "Barber" })).toHaveValue(
    "all",
  );
});

test("invalid shop timezone stays distinct from empty data and retry keeps the validated context", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const url = `${ownerOrigin}/?date=2026-11-09&view=week&barber=${owner.barberId}`;
  await page.goto(url);
  const { rows } = await database.pool.query(
    "SELECT time_zone FROM shops WHERE id = $1",
    [owner.shopId],
  );
  await database.pool.query("UPDATE shops SET time_zone = $1 WHERE id = $2", [
    "Invalid/Phase08",
    owner.shopId,
  ]);
  try {
    await page.goto(url);
    const alert = page.locator('main[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Calendar unavailable");
    await expect(alert).toBeInViewport();
    await expect(page.locator('main[role="alert"]')).not.toContainText(
      "No appointments",
    );
    await page.evaluate(() => document.fonts.ready);
    await captureDialogViewport(page, "calendar-read-error");
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      `/?date=2026-11-09&view=week&barber=${owner.barberId}`,
    );
  } finally {
    await database.pool.query("UPDATE shops SET time_zone = $1 WHERE id = $2", [
      rows[0].time_zone,
      owner.shopId,
    ]);
  }
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Barber" })).toHaveValue(
    owner.barberId!,
  );
});

test("archived historical barber and long saved names remain inspectable on a narrow screen", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, appointment: true });
  const customer =
    "Fictional Guest With A Deliberately Long Saved Name For Narrow Screens";
  const service =
    "A Saved Service Name That Is Long Enough To Exercise Wrapping";
  const barber = "An Archived Barber Label That Remains Available For History";
  await database.pool.query(
    "UPDATE bookings SET customer_name=$1,service_name=$2,barber_name=$3 WHERE id=$4 AND shop_id=$5",
    [customer, service, barber, owner.appointmentId, owner.shopId],
  );
  await database.pool.query(
    "UPDATE barbers SET name='Archived barber with a long current label',archived=true WHERE id=$1 AND shop_id=$2",
    [owner.barberId, owner.shopId],
  );
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  const card = page.getByRole("link", {
    name: `Appointment: ${customer}, ${service}, ${barber}`,
  });
  await expect(card).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Barber" })).toContainText(
    "Archived barber with a long current label (archived)",
  );
  await page
    .getByRole("combobox", { name: "Barber" })
    .selectOption({ value: owner.barberId! });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(card).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
  await card.click();
  const details = page.getByRole("dialog", { name: "Appointment details" });
  await expect(details).toContainText(customer);
  await expect(details).toContainText(service);
  await expect(details).toContainText(barber);
});

test("calendar preserves the owner sign-in and setup guards", async ({
  page,
  context,
  owners,
}) => {
  await page.goto(`${ownerOrigin}/`);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
  await owners(context);
  await page.goto(`${ownerOrigin}/`);
  await expect(page).toHaveURL(`${ownerOrigin}/setup`);
});

test("calendar and both appointment dialogs fit the approved responsive widths", async ({
  page,
  context,
  owners,
}) => {
  test.setTimeout(90_000);
  await owners(context, { shop: true, appointment: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  for (const width of [1440, 901, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    if (width <= 900) {
      await openOwnerNavigation(page);
      await expect(
        page.getByRole("navigation", { name: "Owner navigation" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close navigation" }).click();
      await expect(
        page.getByRole("navigation", { name: "Owner navigation" }),
      ).toBeHidden();
    }
    await capturePhase08State(page, `calendar-${width}`);

    await page
      .getByRole("link", {
        name: new RegExp(
          `Appointment: Fictional Guest, Saved Cut, Saved Barber`,
        ),
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Appointment details" }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const detailsDialog = page.getByRole("dialog", {
      name: "Appointment details",
    });
    await captureDialogViewport(page, `details-dialog-top`);
    await detailsDialog.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      detailsDialog.getByRole("link", { name: "Back to calendar" }),
    ).toBeInViewport();
    await captureDialogViewport(page, `details-dialog-bottom`);
    await page
      .getByRole("button", { name: "Close appointment details" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Appointment details" }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: "New appointment" }).click();
    await expect(
      page.getByRole("dialog", { name: "New appointment" }),
    ).toBeVisible();
    await expect(page.getByLabel("Customer name")).toBeVisible();
    await expect(page.getByLabel("Start time")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const createDialog = page.getByRole("dialog", { name: "New appointment" });
    await expect(
      createDialog.getByRole("button", { name: "Cancel" }),
    ).toHaveCount(1);
    await captureDialogViewport(page, `create-dialog-top`);
    await createDialog.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      createDialog.getByRole("button", { name: "Create appointment" }),
    ).toBeInViewport();
    await expect(
      createDialog.getByRole("button", { name: "Cancel" }),
    ).toBeInViewport();
    await captureDialogViewport(page, `create-dialog-bottom`);
    await page.getByRole("button", { name: "Close new appointment" }).click();
    await expect(
      page.getByRole("dialog", { name: "New appointment" }),
    ).toHaveCount(0);
  }
});

test("new appointment preserves week and barber context through entry, cancel, and save @device", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const calendar = `${ownerOrigin}/?date=2026-11-09&view=week&barber=${owner.barberId}`;
  await page.goto(calendar);

  await page.getByRole("link", { name: "New appointment" }).click();
  await expect(page).toHaveURL(/returnDate=2026-11-09.*returnView=week/);
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Date/ })).toHaveValue(
    "2026-11-09",
  );
  const entryDialog = page.getByRole("dialog", { name: "New appointment" });
  await expect(
    entryDialog.getByRole("link", { name: "Open full page" }),
  ).toHaveCount(0);
  const { dateBox, timeBox } = await entryDialog.evaluate((dialog) => {
    const date = dialog.querySelector<HTMLInputElement>('input[name="date"]')!;
    const time = dialog.querySelector<HTMLInputElement>('input[name="time"]')!;
    const dateRect = date.getBoundingClientRect();
    const timeRect = time.getBoundingClientRect();
    return {
      dateBox: { y: dateRect.y, height: dateRect.height },
      timeBox: { y: timeRect.y, height: timeRect.height },
    };
  });
  if (page.viewportSize()!.width >= 521) {
    expect(Math.abs(dateBox.y - timeBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(dateBox.height - timeBox.height)).toBeLessThanOrEqual(1);
  } else {
    expect(dateBox.y + dateBox.height).toBeLessThan(timeBox.y);
  }
  await expect(entryDialog.locator("form select").nth(1)).toHaveValue(
    owner.barberId!,
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(calendar);

  const tuesday = page
    .getByRole("region", { name: "Weekly calendar" })
    .locator('section[aria-label^="Tuesday"]');
  await tuesday.getByRole("link", { name: "+ Add appointment" }).click();
  await expect(page.getByRole("textbox", { name: /^Date/ })).toHaveValue(
    "2026-11-10",
  );
  await expect(
    page
      .getByRole("dialog", { name: "New appointment" })
      .locator("form select")
      .nth(1),
  ).toHaveValue(owner.barberId!);
  await page.getByLabel("Customer name").fill("Context Guest");
  await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
  await page.getByLabel("Start time").fill("13:07");
  await expect(
    page
      .getByRole("dialog", { name: "New appointment" })
      .locator("form select")
      .nth(1),
  ).toHaveValue(owner.barberId!);
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(
    /\?date=2026-11-09&view=week&barber=[^&]+&created=/,
  );
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Barber" })).toHaveValue(
    owner.barberId!,
  );
});

test("new appointment stays standalone on direct request and refresh", async ({
  page,
  context,
  owners,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const url = `${ownerOrigin}/appointments/new?date=2026-11-10&time=13%3A07&barber=${owner.barberId}&returnDate=2026-11-09&returnView=week&returnBarber=${owner.barberId}`;
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "New appointment" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Date/ })).toHaveValue(
    "2026-11-10",
  );
  await expect(page.getByLabel("Start time")).toHaveValue("13:07");
  await expect(page.getByLabel(/^Barber/)).toHaveValue(owner.barberId!);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Start time")).toHaveValue("13:07");
  await page.getByLabel("Customer name").fill("Standalone Context Guest");
  await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(
    /\?date=2026-11-09&view=week&barber=[^&]+&created=/,
  );
});

test("owner can save an ongoing minute and a date beyond the public horizon", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  const now = new Date(process.env.TRIMTIME_E2E_NOW ?? "2026-10-31T12:00:00Z");
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now.getTime() - 10 * 60_000));
  const local = Object.fromEntries(
    localParts.map(({ type, value }) => [type, value]),
  );
  const ongoingDate = `${local.year}-${local.month}-${local.day}`;
  const ongoingTime = `${local.hour}:${local.minute}`;
  const farFuture = new Date(`${ongoingDate}T12:00:00Z`);
  farFuture.setUTCDate(farFuture.getUTCDate() + 45);
  const futureDate = farFuture.toISOString().slice(0, 10);
  for (const [date, time, name] of [
    [ongoingDate, ongoingTime, "Ongoing Walk-in"],
    [futureDate, "13:07", "Far Future Phone Booking"],
  ]) {
    await page.goto(`${ownerOrigin}/?date=${date}&view=day`);
    await page.getByRole("link", { name: "New appointment" }).click();
    await page.getByLabel("Customer name").fill(name);
    await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
    await page
      .getByRole("dialog")
      .locator("form select")
      .nth(1)
      .selectOption({ value: owner.barberId! });
    await page
      .getByRole("dialog")
      .locator('form input[name="date"]')
      .fill(date);
    await page.getByLabel("Start time").fill(time);
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);
  }
  const { rows } = await database.pool.query(
    "SELECT customer_name, start_at, end_at FROM bookings WHERE shop_id=$1 ORDER BY start_at",
    [owner.shopId],
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].customer_name).toBe("Ongoing Walk-in");
  expect(new Date(rows[0].start_at).getTime()).toBeLessThan(now.getTime());
  expect(new Date(rows[0].end_at).getTime()).toBeGreaterThan(now.getTime());
  expect(rows[1].customer_name).toBe("Far Future Phone Booking");
  expect(new Date(rows[1].start_at).getTime()).toBeGreaterThan(
    new Date(`${ongoingDate}T12:00:00Z`).getTime() + 30 * 24 * 60 * 60_000,
  );
});

test("a conflict keeps the form values and an interrupted response retries the same saved appointment", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await page.getByLabel("Customer name").fill("First Booking");
  await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
  await page
    .getByRole("dialog")
    .locator("form select")
    .nth(1)
    .selectOption({ value: owner.barberId! });
  await page
    .getByRole("dialog")
    .locator('form input[name="date"]')
    .fill("2026-11-03");
  await page.getByLabel("Start time").fill("13:07");
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);

  await page.goto(`${ownerOrigin}/?date=2026-11-03&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await page.getByLabel("Customer name").fill("Conflict Guest");
  await page
    .getByLabel("Customer email (optional)")
    .fill("conflict@example.test");
  await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
  await page
    .getByRole("dialog")
    .locator("form select")
    .nth(1)
    .selectOption({ value: owner.barberId! });
  await page
    .getByRole("dialog")
    .locator('form input[name="date"]')
    .fill("2026-11-03");
  await page.getByLabel("Start time").fill("13:07");
  await page.getByRole("button", { name: "Create appointment" }).click();
  const conflictAlert = page.getByRole("alert");
  await expect(conflictAlert).toContainText("time was just taken");
  await expect(conflictAlert).toBeInViewport();
  await captureDialogViewport(page, "appointment-conflict");
  await expect(page.getByLabel("Customer name")).toHaveValue("Conflict Guest");
  await expect(page.getByLabel("Customer email (optional)")).toHaveValue(
    "conflict@example.test",
  );
  await page.getByLabel("Start time").fill("14:07");

  let interrupted = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      !interrupted &&
      request.method() === "POST" &&
      request.headers()["next-action"]
    ) {
      interrupted = true;
      await route.fetch();
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Create appointment" }).click();
  const retryAlert = page.getByRole("alert");
  await expect(retryAlert).toContainText("response was interrupted");
  await expect(retryAlert).toBeInViewport();
  await expect(page.getByLabel("Customer name")).toHaveValue("Conflict Guest");
  await page.unrouteAll();
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);
  const { rows } = await database.pool.query(
    "SELECT count(*)::int AS count FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  expect(rows[0].count).toBe(2);
  const work = await database.pool.query(
    "SELECT count(*)::int AS count FROM notification_work w JOIN bookings b ON b.id=w.booking_id WHERE b.shop_id=$1",
    [owner.shopId],
  );
  expect(work.rows[0].count).toBe(2);
});

test("server validation feedback stays attached to its field and keeps the entered value", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await page.getByLabel("Customer name").fill("Validation Feedback Guest");
  await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
  await page
    .getByRole("dialog")
    .locator("form select")
    .nth(1)
    .selectOption({ value: owner.barberId! });
  await page
    .getByRole("dialog")
    .locator('form input[name="date"]')
    .fill("2026-11-03");
  await page.getByLabel("Start time").fill("13:07");
  let sentInvalidPayload = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      !sentInvalidPayload &&
      request.method() === "POST" &&
      request.headers()["next-action"]
    ) {
      const body = request.postDataBuffer()!.toString();
      expect(body).toContain("Validation Feedback Guest");
      sentInvalidPayload = true;
      const response = await route.fetch({
        postData: body.replace("Validation Feedback Guest", ""),
      });
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Create appointment" }).click();
  const customerName = page.getByLabel("Customer name");
  const fieldError = page.locator("#field-error-customer-name");
  await expect(fieldError).toBeVisible();
  await captureDialogViewport(page, "appointment-validation-error");
  await expect(customerName).toHaveAttribute("aria-invalid", "true");
  await expect(customerName).toHaveAttribute(
    "aria-describedby",
    "field-error-customer-name",
  );
  await expect(customerName).toBeFocused();
  await expect(customerName).toHaveValue("Validation Feedback Guest");
  const { rows } = await database.pool.query(
    "SELECT count(*)::int AS count FROM bookings WHERE shop_id=$1",
    [owner.shopId],
  );
  expect(rows[0].count).toBe(0);
});

test("appointment entry traps keyboard focus and respects reduced motion with a 3:1 focus ring @device", async ({
  page,
  context,
  owners,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  const dialog = page.getByRole("dialog", { name: "New appointment" });
  await expect(dialog).toBeVisible();
  const motion = await page
    .locator('[data-slot="dialog-overlay"]')
    .evaluate((element) => getComputedStyle(element).animationName);
  const popupMotion = await dialog.evaluate(
    (element) => getComputedStyle(element).animationName,
  );
  expect(motion).toBe("none");
  expect(popupMotion).toBe("none");

  const close = dialog.getByRole("button", { name: "Close new appointment" });
  for (let tab = 0; tab < 24; tab += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        dialog.evaluate((root) => root.contains(document.activeElement)),
      )
      .toBe(true);
    if (await close.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(close).toBeFocused();
  const colors = await close.evaluate((element) => {
    const style = getComputedStyle(element);
    const dialog = element.closest('[role="dialog"]')!;
    const channels = (color: string) =>
      color
        .match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
        ?.slice(1)
        .map(Number);
    return {
      outline: channels(style.outlineColor),
      background: channels(getComputedStyle(dialog).backgroundColor),
      width: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
    };
  });
  expect(colors.width).toBeGreaterThan(0);
  expect(colors.style).not.toBe("none");
  expect(colors.outline).toHaveLength(3);
  expect(colors.background).toHaveLength(3);
  const luminance = (channels: number[]) =>
    channels
      .map((channel) => channel / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const focusLuminance = luminance(colors.outline!);
  const surfaceLuminance = luminance(colors.background!);
  expect(
    (Math.max(focusLuminance, surfaceLuminance) + 0.05) /
      (Math.min(focusLuminance, surfaceLuminance) + 0.05),
  ).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(calendarUrl);
  await expect(
    page.getByRole("link", { name: "New appointment" }),
  ).toBeFocused();

  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole("link", { name: "New appointment" }).click();
  const phoneDialog = page.getByRole("dialog", { name: "New appointment" });
  await expect(phoneDialog).toBeVisible();
  for (let tab = 0; tab < 12; tab += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        phoneDialog.evaluate((root) => root.contains(document.activeElement)),
      )
      .toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(calendarUrl);
});

for (const change of [
  {
    field: "name",
    update: "UPDATE services SET name='Walk-in Cut Revised' WHERE id=$1",
    saved: "Walk-in Cut Revised",
  },
  {
    field: "price",
    update: "UPDATE services SET price_usd=30 WHERE id=$1",
    saved: "30",
  },
  {
    field: "duration",
    update: "UPDATE services SET duration_minutes=45 WHERE id=$1",
    saved: "45",
  },
]) {
  test(`changed service ${change.field} requires current review and a second submit`, async ({
    page,
    context,
    owners,
    database,
  }) => {
    const owner = await owners(context, { shop: true, createSetup: true });
    await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
    await page.getByRole("link", { name: "New appointment" }).click();
    await page.getByLabel("Customer name").fill(`Stale ${change.field} Guest`);
    await page.getByLabel(/^Service/).selectOption({ value: owner.serviceId! });
    await page
      .getByRole("dialog")
      .locator("form select")
      .nth(1)
      .selectOption({ value: owner.barberId! });
    await page
      .getByRole("dialog", { name: "New appointment" })
      .locator('form input[name="date"]')
      .fill("2026-11-03");
    await page.getByLabel("Start time").fill("13:07");
    await database.pool.query(change.update, [owner.serviceId]);

    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "service details changed",
    );
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM bookings WHERE shop_id=$1",
          [owner.shopId],
        )
      ).rows[0].count,
    ).toBe(0);
    await page
      .getByRole("button", { name: "Review current service details" })
      .click();
    if (change.field === "name")
      await expect(page.getByLabel(/^Service/)).toContainText(change.saved);
    else
      await expect(
        page.getByRole("complementary", { name: "Appointment summary" }),
      ).toContainText(change.saved);
    await expect(page.getByLabel("Customer name")).toHaveValue(
      `Stale ${change.field} Guest`,
    );
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);
    const bookingId = new URL(page.url()).searchParams.get("created");
    const { rows } = await database.pool.query(
      "SELECT service_name, service_price_usd::text, service_duration_minutes FROM bookings WHERE id=$1 AND shop_id=$2",
      [bookingId, owner.shopId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].service_name).toBe(
      change.field === "name" ? change.saved : "Walk-in Cut",
    );
    expect(Number(rows[0].service_price_usd)).toBe(
      change.field === "price" ? 30 : 25,
    );
    expect(rows[0].service_duration_minutes).toBe(
      change.field === "duration" ? 45 : 35,
    );
  });
}

test("all six owner navigation destinations remain reachable", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true });
  await page.goto(`${ownerOrigin}/`);
  for (const destination of [
    "Services",
    "Barbers",
    "Availability",
    "Activity",
    "Settings",
  ]) {
    await openOwnerNavigation(page);
    await page
      .getByRole("link", { name: destination, exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${destination.toLowerCase()}`));
    await expect(page.getByRole("main").first()).toContainText(/\S/);
  }
  await openOwnerNavigation(page);
  await page
    .getByRole("link", { name: "Calendar", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(`${ownerOrigin}/`);
});

test("owner creates a contactless booking from the intercepted form and sees its saved detail @device", async ({
  page,
  context,
  owners,
  database,
}) => {
  const owner = await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await expect(page).toHaveURL(/\/appointments\/new\?date=2026-11-02/);
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toBeVisible();
  await page.getByLabel("Customer name").fill("Walk-in Guest");
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await page
    .getByRole("dialog")
    .locator("form select")
    .nth(1)
    .selectOption({ label: "Manual Barber" });
  await page.getByLabel("Start time").fill("13:07");
  await page.getByRole("button", { name: "Create appointment" }).click();
  await expect(page).toHaveURL(/created=[0-9a-f-]{36}/);
  const bookingId = new URL(page.url()).searchParams.get("created");
  expect(bookingId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(async () => {
      const { rows } = await database.pool.query(
        `SELECT w.status FROM notification_work w
       JOIN bookings b ON b.id=w.booking_id
       WHERE b.id=$1 AND b.shop_id=$2 AND w.kind='customer_confirmation' AND w.channel='email'`,
        [bookingId, owner.shopId],
      );
      return rows[0]?.status;
    })
    .toBe("skipped");
  const attempts = await database.pool.query(
    "SELECT count(*)::int AS count FROM notification_attempts a JOIN notification_work w ON w.id=a.work_id WHERE w.booking_id=$1",
    [bookingId],
  );
  expect(attempts.rows[0].count).toBe(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Appointment saved for" }),
  ).toContainText("No email was provided; no customer confirmation was sent.");
  await expect(
    page.getByRole("link", {
      name: /Appointment: Walk-in Guest, Walk-in Cut/,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Appointment: Walk-in Guest, Walk-in Cut/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Appointment details", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("No customer email was sent.")).toBeVisible();
  await expect(page.getByText(/private link/i)).toHaveCount(0);
});

test("dirty appointment dismissal keeps fields on Back and clears them after discard", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await page.getByLabel("Customer name").fill("Unsaved Guest");
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/appointments\/new\?/);
  await expect(page.getByLabel("Customer name")).toHaveValue("Unsaved Guest");
  await page.getByRole("button", { name: "Close new appointment" }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(`${ownerOrigin}/?date=2026-11-02&view=day`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await expect(page.getByLabel("Customer name")).toHaveValue("");
});

for (const method of ["Close", "Escape", "outside click", "Back"] as const) {
  test(`clean appointment dialog closes through ${method}`, async ({
    page,
    context,
    owners,
  }) => {
    await owners(context, { shop: true, createSetup: true });
    await openNewAppointment(page);
    await dismissAppointment(page, method);
    await expect(page).toHaveURL(calendarUrl);
    await expect(
      page.getByRole("dialog", { name: "New appointment" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toHaveCount(0);
  });
}

for (const method of ["Close", "Escape", "outside click", "Back"] as const) {
  for (const decision of ["Keep editing", "Discard changes"] as const) {
    test(`dirty appointment ${method} asks, then ${decision}`, async ({
      page,
      context,
      owners,
    }) => {
      await owners(context, { shop: true, createSetup: true });
      await openNewAppointment(page);
      await fillDirtyAppointment(
        page,
        `${method.replaceAll(" ", "-")}-${decision.replaceAll(" ", "-")}`,
      );
      await dismissAppointment(page, method);
      await expect(
        page.getByRole("dialog", { name: "Discard unsaved changes?" }),
      ).toBeVisible();
      if (method === "Close" && decision === "Keep editing")
        await capturePhase08State(page, "discard-dialog-desktop");
      if (method === "Close" && decision === "Keep editing")
        await captureDialogViewport(page, "discard-dialog-viewport");
      await page.getByRole("button", { name: decision }).click();
      await expect(
        page.getByRole("dialog", { name: "Discard unsaved changes?" }),
      ).toHaveCount(0);
      if (decision === "Keep editing") {
        await expect(page).toHaveURL(/\/appointments\/new\?/);
        await expect(page.getByLabel("Customer name")).toHaveValue(
          `Walk-in ${method.replaceAll(" ", "-")}-${decision.replaceAll(" ", "-")}`,
        );
        await expect(page.getByLabel("Customer email (optional)")).toHaveValue(
          `walk-in-${method.replaceAll(" ", "-")}-${decision.replaceAll(" ", "-")}@example.test`,
        );
        await expect(page.getByLabel("Customer phone (optional)")).toHaveValue(
          "+12025550142",
        );
        await expect(
          page.getByRole("checkbox", { name: /Customer explicitly opted in/ }),
        ).toBeChecked();
        await expect(page.getByRole("textbox", { name: /^Date/ })).toHaveValue(
          "2026-11-03",
        );
        await expect(page.getByLabel("Start time")).toHaveValue("13:07");
      } else {
        await expect(page).toHaveURL(calendarUrl);
        await page.getByRole("link", { name: "New appointment" }).click();
        await expect(page.getByLabel("Customer name")).toHaveValue("");
        await expect(page.getByLabel("Customer email (optional)")).toHaveValue(
          "",
        );
        await expect(page.getByLabel("Customer phone (optional)")).toHaveValue(
          "",
        );
        await expect(
          page.getByRole("checkbox", { name: /Customer explicitly opted in/ }),
        ).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: /^Date/ })).toHaveValue(
          "2026-11-02",
        );
      }
    });
  }
}

test("multiple browser Back attempts stay on the modal until discard, then Forward is clean", async ({
  page,
  context,
  owners,
}) => {
  await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/?date=2026-11-02&view=week&barber=all`);
  await page.getByRole("link", { name: "New appointment" }).click();
  await expect(
    page.getByRole("dialog", { name: "New appointment" }),
  ).toBeVisible();
  await page.getByLabel("Customer name").fill("History Guest");
  await page
    .getByLabel(/^Service/)
    .selectOption({ label: "Walk-in Cut · $25" });
  await page
    .getByLabel("Customer email (optional)")
    .fill("history@example.test");
  await page.getByLabel("Customer phone (optional)").fill("+12025550142");
  await page.getByLabel("Start time").fill("13:07");
  await page.goBack();
  await expect(page).toHaveURL(/\/appointments\/new\?/);
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/appointments\/new\?/);
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/appointments\/new\?/);
  await expect(page.getByLabel("Customer name")).toHaveValue("History Guest");
  await expect(page.getByLabel("Customer email (optional)")).toHaveValue(
    "history@example.test",
  );
  await expect(page.getByLabel("Customer phone (optional)")).toHaveValue(
    "+12025550142",
  );
  await expect(page.getByLabel("Start time")).toBeFocused();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(
    `${ownerOrigin}/?date=2026-11-02&view=week&barber=all`,
  );
  await page.goForward();
  await expect(page).toHaveURL(/\/appointments\/new\?/);
  await expect(page.getByLabel("Customer name")).toHaveValue("");
  await page.goBack();
  await expect(page).toHaveURL(
    `${ownerOrigin}/?date=2026-11-02&view=week&barber=all`,
  );
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toHaveCount(0);
});

test("sign-out clears a dirty standalone appointment before another owner signs in", async ({
  page,
  context,
  owners,
}) => {
  await page.addInitScript(() => {
    (
      window as Window & { phase08DocumentToken?: string }
    ).phase08DocumentToken = crypto.randomUUID();
  });
  await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/appointments/new?date=2026-11-02`);
  await page.getByLabel("Customer name").fill("Private Walk-in Draft");
  await page
    .getByLabel("Customer email (optional)")
    .fill("private-draft@example.test");
  const beforeSignOut = await page.evaluate(
    () =>
      (window as Window & { phase08DocumentToken?: string })
        .phase08DocumentToken,
  );
  if (page.viewportSize()!.width <= 900) await openOwnerNavigation(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  const afterSignOut = await page.evaluate(
    () =>
      (window as Window & { phase08DocumentToken?: string })
        .phase08DocumentToken,
  );
  expect(afterSignOut).not.toBe(beforeSignOut);

  await owners(context, { shop: true, createSetup: true });
  await page.goto(`${ownerOrigin}/appointments/new?date=2026-11-02`);
  await expect(page.getByLabel("Customer name")).toHaveValue("");
  await expect(page.getByLabel("Customer email (optional)")).toHaveValue("");
});
