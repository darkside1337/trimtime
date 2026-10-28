import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";
import { withE2eBudget } from "../support/e2e-budget";

it("releases an owned budget after setup fails and refuses an existing budget", async () => {
  const { pool } = await openTestDatabase();
  const day = "2098-01-01";
  await applyMigrations(pool, "db/migrations");
  const owner = randomUUID();
  let inserted = false;
  try {
    await expect(
      withE2eBudget(pool, day, async () => {
        throw new Error("setup failed");
      }),
    ).rejects.toThrow("setup failed");
    expect(
      (await pool.query("SELECT day FROM outbound_budget WHERE day=$1", [day]))
        .rowCount,
    ).toBe(0);
    await pool.query(
      "INSERT INTO outbound_budget (day,allocation_count) VALUES ($1,7)",
      [day],
    );
    inserted = true;
    await expect(withE2eBudget(pool, day, async () => owner)).rejects.toThrow(
      /already owned/,
    );
    expect(
      (
        await pool.query(
          "SELECT allocation_count FROM outbound_budget WHERE day=$1",
          [day],
        )
      ).rows[0].allocation_count,
    ).toBe(7);
  } finally {
    if (inserted)
      await pool.query(
        "DELETE FROM outbound_budget WHERE day=$1 AND allocation_count=7",
        [day],
      );
    await pool.end();
  }
});
