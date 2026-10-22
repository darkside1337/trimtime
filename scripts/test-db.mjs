import { execFileSync } from "node:child_process";
import {
  verifyOwnedTestDatabase,
  verifyTestContainer,
} from "../db/test-database.mts";

const compose = [
  "compose",
  "--project-name",
  "trimtime-phase00",
  "-f",
  "compose.test.yml",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

async function main() {
  const action = process.argv[2];
  if (action === "up") {
    run("docker", [...compose, "up", "--detach", "--wait"]);
    verifyTestContainer();
    console.log("Disposable PostgreSQL is ready.");
  } else if (action === "down") {
    const ids = run("docker", [...compose, "ps", "--all", "-q", "db"]);
    if (ids) verifyTestContainer(true);
    run("docker", [...compose, "down", "--remove-orphans"]);
    console.log("Disposable PostgreSQL was removed.");
  } else if (action === "stop") {
    verifyTestContainer();
    run("docker", [...compose, "stop", "db"]);
    console.log("Disposable PostgreSQL was stopped.");
  } else if (action === "verify" || action === "test") {
    verifyOwnedTestDatabase();
    console.log("Verified owned disposable PostgreSQL.");
    if (action === "test") {
      execFileSync(
        process.execPath,
        ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.database.config.mts"],
        { stdio: "inherit", env: process.env },
      );
    }
  } else {
    throw new Error("Usage: pnpm db:test:{up,stop,down} | pnpm test:db");
  }
}

if (process.argv[1]?.endsWith("scripts/test-db.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
