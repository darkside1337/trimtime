import { randomUUID } from "node:crypto";
import { captureState, expect, ownerOrigin, test } from "./fixtures";

test("catalog cards show named eligibility and the responsive reference grid", async ({
  page,
  context,
  owners,
  database,
}, info) => {
  const owner = await owners(context, { shop: true });
  for (const [index, name] of [
    "Classic cut",
    "Beard tidy",
    "Cut & beard",
  ].entries()) {
    const serviceId = randomUUID();
    const barberId = randomUUID();
    await database.pool.query(
      "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,$3,35.00,35)",
      [serviceId, owner.shopId, name],
    );
    await database.pool.query(
      "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,$3)",
      [barberId, owner.shopId, `Barber ${index + 1}`],
    );
    await database.pool.query(
      "INSERT INTO barber_services (shop_id,barber_id,service_id) VALUES ($1,$2,$3)",
      [owner.shopId, barberId, serviceId],
    );
    if (index === 0) {
      const week = Array.from({ length: 7 }, (_, day) =>
        day < 6
          ? {
              working: [{ start: 540, end: 1080 }],
              breaks: [{ start: 780, end: 810 }],
            }
          : { working: [], breaks: [] },
      );
      await database.pool.query(
        "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
        [owner.shopId, barberId, JSON.stringify(week)],
      );
    }
  }
  for (const route of ["services", "barbers"]) {
    await page.goto(`${ownerOrigin}/${route}`);
    const cards = page.locator("article");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().getByRole("list")).toContainText(
      route === "services" ? "Barber 1" : "Classic cut 35m $35.00",
    );
    if (route === "barbers") {
      await expect(cards.first()).toContainText(
        "Mon–Sat · 09:00–18:00 · Break 13:00–13:30",
      );
      await expect(cards.first()).toContainText("America/New_York");
      await expect(
        cards.first().getByRole("link", { name: "Edit hours" }),
      ).toHaveAttribute("href", "/availability");
    }
    const first = (await cards.nth(0).boundingBox())!;
    const second = (await cards.nth(1).boundingBox())!;
    if (page.viewportSize()!.width >= 1024) {
      expect(second.y).toBe(first.y);
      expect((await cards.nth(2).boundingBox())!.y).toBe(first.y);
    } else {
      expect(second.x).toBe(first.x);
      expect(second.y).toBeGreaterThan(first.y);
    }
    await captureState(page, `${route}-populated`, info);
  }
});
