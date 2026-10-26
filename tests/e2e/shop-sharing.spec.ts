import { readFile } from "node:fs/promises";
import jsQR from "jsqr";
import { test, expect, ownerOrigin, captureState } from "./fixtures";

test("the displayed QR encodes the canonical public URL and downloads as SVG", async ({
  page,
  context,
  owners,
}, info) => {
  const owner = await owners(context, { shop: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: ownerOrigin,
  });
  await page.goto(`${ownerOrigin}/settings`);
  const canonical = `http://${owner.subdomain}.localhost:3100/`;
  await expect(page.getByLabel("Public shop link")).toHaveValue(canonical);
  await expect(
    page.getByRole("link", { name: "Open public page" }),
  ).toHaveAttribute("href", canonical);
  const qr = await page
    .locator('img[alt^="QR code linking to"]')
    .evaluate(async (image) => {
      const img = image as HTMLImageElement;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("QR failed to load"));
        if (img.complete) resolve();
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(img, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      return {
        width: canvas.width,
        height: canvas.height,
        data: Array.from(pixels.data),
      };
    });
  const decoded = jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height);
  expect(decoded?.data).toBe(canonical);
  const download = page.getByRole("link", { name: "Download QR as SVG" });
  await expect(download).toHaveAttribute("download", "trimtime-shop.svg");
  await expect(download).toHaveAttribute(
    "href",
    /^data:image\/svg\+xml;base64,/,
  );
  const [savedQr] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);
  const downloadedSvg = await readFile((await savedQr.path())!, "utf8");
  const encodedSvg = Buffer.from(
    (await download.getAttribute("href"))!.split(",")[1]!,
    "base64",
  ).toString("utf8");
  expect(savedQr.suggestedFilename()).toBe("trimtime-shop.svg");
  expect(downloadedSvg).toContain("<svg");
  expect(downloadedSvg).toBe(encodedSvg);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status")).toHaveText("Shop link copied.");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(canonical);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Copy isn’t available here. Select the link above and copy it manually.",
  );
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if ([390, 768, 1440].includes(width))
      await captureState(page, `shop-sharing-${width}`, info);
  }
  await page.goto(decoded!.data);
  await expect(
    page.getByRole("heading", { name: "We’re taking a booking break." }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Online booking is paused. Existing appointments and their private links are still available.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Book a chair" })).toHaveCount(0);
});
