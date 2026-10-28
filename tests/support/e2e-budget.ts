import type { Pool } from "pg";

export async function withE2eBudget<T>(
  pool: Pool,
  day: string,
  run: () => Promise<T>,
): Promise<T> {
  const inserted = await pool.query(
    "INSERT INTO outbound_budget (day, allocation_count) VALUES ($1, 0) ON CONFLICT DO NOTHING RETURNING day",
    [day],
  );
  if (!inserted.rowCount)
    throw new Error(`E2E budget day ${day} is already owned.`);
  try {
    return await run();
  } finally {
    const deleted = await pool.query(
      "DELETE FROM outbound_budget WHERE day=$1 AND NOT EXISTS (SELECT 1 FROM notification_attempts WHERE budget_day=$1)",
      [day],
    );
    if (!deleted.rowCount)
      throw new Error(
        `E2E budget day ${day} still has attempts; inspect it before cleanup.`,
      );
  }
}
