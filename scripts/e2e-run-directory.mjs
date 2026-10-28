import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function acquireE2eDirectory(dir) {
  try {
    await mkdir(dir);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `${dir} already exists: an E2E run may be active or interrupted. Check its owner before removing it.`,
      );
    throw error;
  }
  const token = `${process.pid} ${randomUUID()}`;
  await writeFile(join(dir, "owner"), token, { flag: "wx" });
  return async () => {
    if ((await readFile(join(dir, "owner"), "utf8")) !== token)
      throw new Error(`Cannot clean ${dir}: ownership changed.`);
    await rm(dir, { recursive: true });
  };
}
