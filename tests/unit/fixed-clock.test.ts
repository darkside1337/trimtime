import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("fixed browser-test clock preload", () => {
  it("fixes zero-argument dates while preserving explicit dates and timers", () => {
    const result = execFileSync(
      process.execPath,
      [
        `--import=${resolve("tests/support/fixed-clock.mjs")}`,
        "--input-type=module",
        "-e",
        "await new Promise((resolve) => setTimeout(resolve, 5)); process.stdout.write(JSON.stringify({ now: Date.now(), parsed: Date.parse('2026-10-31T12:00:00Z'), constructed: new Date().toISOString(), explicit: new Date('2000-01-01T00:00:00Z').toISOString(), callable: Date(), timer: true }))",
      ],
      { env: { ...process.env, TRIMTIME_E2E_NOW: "2026-10-31T12:00:00Z" } },
    );
    expect(JSON.parse(result.toString())).toMatchObject({
      now: Date.parse("2026-10-31T12:00:00Z"),
      parsed: Date.parse("2026-10-31T12:00:00Z"),
      constructed: "2026-10-31T12:00:00.000Z",
      explicit: "2000-01-01T00:00:00.000Z",
      timer: true,
    });
  });

  it("rejects invalid clock input", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [`--import=${resolve("tests/support/fixed-clock.mjs")}`, "--eval", ""],
        { env: { ...process.env, TRIMTIME_E2E_NOW: "not-a-time" } },
      ),
    ).toThrow();
  });
});
