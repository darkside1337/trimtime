import { beforeEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const mocks = vi.hoisted(() => ({ migrate: vi.fn(), drizzle: vi.fn() }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: mocks.migrate,
}));

import { applyMigrations } from "../../db/migrate.mts";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.drizzle.mockReturnValue({});
});

it("discards a connection if lock acquisition fails", async () => {
  const client = {
    query: vi.fn().mockRejectedValue(new Error("lock timeout")),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;

  await expect(applyMigrations(pool, "db/migrations")).rejects.toThrow(
    "lock timeout",
  );
  expect(mocks.migrate).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalledWith(true);
});

it("discards a connection if the advisory lock cannot be released", async () => {
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockRejectedValueOnce(new Error("unlock failed")),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;

  await expect(applyMigrations(pool, "db/migrations")).rejects.toThrow(
    "unlock failed",
  );
  expect(client.release).toHaveBeenCalledWith(true);
});
