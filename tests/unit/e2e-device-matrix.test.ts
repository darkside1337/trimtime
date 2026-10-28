import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

type ListedSuite = {
  specs?: {
    file: string;
    line: number;
    title: string;
    tests: { projectName: string }[];
  }[];
  suites?: ListedSuite[];
};

function listedTests(allDevices: boolean, emailMode = "") {
  const output = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "node_modules/@playwright/test/cli.js",
      "test",
      "--list",
      "--reporter=json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        TRIMTIME_E2E_EMAIL_MODE: emailMode,
        TRIMTIME_E2E_ALL_DEVICES: allDevices ? "1" : "0",
      },
    },
  );
  const result: Record<string, Set<string>> = {};
  function visit(suite: ListedSuite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        (result[test.projectName] ??= new Set()).add(
          `${spec.file}:${spec.line}:${spec.title}`,
        );
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of JSON.parse(output).suites) visit(suite);
  return result;
}

it("keeps every test on desktop and offers a focused, reversible device matrix", () => {
  const focused = listedTests(false);
  const full = listedTests(true);
  const mailpit = listedTests(false, "mailpit-double");
  const desktop = focused["desktop-chromium"];
  expect(desktop).toEqual(full["desktop-chromium"]);
  for (const name of ["tablet-chromium", "phone-chromium"]) {
    const selected = focused[name];
    expect(selected.size).toBeGreaterThan(10);
    expect(selected.size).toBeLessThan(desktop.size);
    expect(full[name]).toEqual(desktop);
    expect(mailpit[name]).toEqual(desktop);
    expect([...selected].every((item) => desktop.has(item))).toBe(true);
    for (const journey of [
      "public booking requires",
      "calendar shows the owner's",
      "owner creates a contactless",
      "shared owner navigation",
      "owner navigation opens and closes with touch",
    ]) {
      expect([...selected].some((item) => item.includes(journey))).toBe(true);
    }
  }
}, 30_000);
