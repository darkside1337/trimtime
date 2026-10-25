import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("sign-in keeps the tablet action visible and supports skipping the introduction", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${ownerOrigin}/sign-in`);
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to sign in" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Welcome in." }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(google).toBeFocused();
  await captureState(page, "sign-in-tablet-fidelity", info);
});

test("Google sign-in announces connecting, failure and retry without provider traffic", async ({
  page,
}, info) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route(`${ownerOrigin}/api/auth/sign-in/social`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await pending;
      await route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", message: "Unavailable" },
      });
    } else {
      await route.abort("failed");
    }
  });
  await page.goto(`${ownerOrigin}/sign-in`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  try {
    await expect(
      page.getByRole("button", { name: "Connecting to Google…" }),
    ).toBeDisabled();
    await captureState(page, "sign-in-connecting", info);
  } finally {
    release();
  }
  const error = page
    .getByRole("alert")
    .filter({ hasText: "Google sign-in could not start." });
  await expect(error).toBeVisible();
  await captureState(page, "sign-in-failure", info);
  const retry = page.getByRole("button", { name: "Continue with Google" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(error).toBeVisible();
  await expect(retry).toBeEnabled();
  expect(attempts).toBe(2);
  await expect(page).toHaveURL(`${ownerOrigin}/sign-in`);
});

test("a cancelled provider callback returns a safe message and allows retry", async ({
  page,
}) => {
  await page.goto(
    `${ownerOrigin}/sign-in?error=access_denied&error_description=provider-detail`,
  );
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "Google sign-in was cancelled or could not be completed.",
      }),
  ).toBeVisible();
  await expect(page.getByText("provider-detail", { exact: true })).toHaveCount(
    0,
  );
  let attempted = false;
  await page.route(`${ownerOrigin}/api/auth/sign-in/social`, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    });
    attempted = true;
    await route.fulfill({
      status: 503,
      json: { code: "UNAVAILABLE", message: "Unavailable" },
    });
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Google sign-in could not start." }),
  ).toBeVisible();
  expect(attempted).toBe(true);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
});
