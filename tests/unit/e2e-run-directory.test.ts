import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireE2eDirectory } from "../../scripts/e2e-run-directory.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

it("excludes concurrent runs and preserves an unowned stale directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "trimtime-run-test-"));
  roots.push(root);
  const dir = join(root, "run");
  const release = await acquireE2eDirectory(dir);
  await expect(acquireE2eDirectory(dir)).rejects.toThrow(/already exists/);
  await release();
  const stale = await acquireE2eDirectory(dir);
  await writeFile(join(dir, "owner"), "someone else");
  await expect(stale()).rejects.toThrow(/ownership/);
  expect(await readFile(join(dir, "owner"), "utf8")).toBe("someone else");
});
