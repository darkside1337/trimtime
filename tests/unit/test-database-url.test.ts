import { describe, expect, it } from "vitest";
import { getTestDatabaseUrl } from "../../db/test-database-url.mts";

const safeUrl =
  "postgresql://trimtime_test:local_test_only@127.0.0.1:55432/trimtime_test";

describe("getTestDatabaseUrl", () => {
  it("requires an explicit test URL even when an application URL exists", () => {
    expect(() =>
      getTestDatabaseUrl({ DATABASE_URL: safeUrl }),
    ).toThrow(/TEST_DATABASE_URL is required/);
  });

  it("accepts only the disposable loopback database URL", () => {
    expect(getTestDatabaseUrl({ TEST_DATABASE_URL: safeUrl })).toBe(safeUrl);
    expect(() =>
      getTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://shared/db" }),
    ).toThrow(/must point to the disposable local database/);
  });
});
