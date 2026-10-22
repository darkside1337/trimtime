import { execFileSync } from "node:child_process";
import { getTestDatabaseUrl } from "./test-database-url.mts";

const compose = [
  "compose",
  "--project-name",
  "trimtime-phase00",
  "-f",
  "compose.test.yml",
];
const image =
  "postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336";

function run(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function verifyTestContainer(allowStopped = false): void {
  const ids = run([...compose, "ps", "--all", "-q", "db"]);
  if (!ids) {
    throw new Error("Disposable PostgreSQL is missing; run pnpm db:test:up.");
  }

  const [container] = JSON.parse(run(["inspect", ids]));
  const labels = container?.Config?.Labels ?? {};
  const mapping = container?.HostConfig?.PortBindings?.["5432/tcp"]?.[0];
  const tmpfs = container?.HostConfig?.Tmpfs ?? {};
  const env = new Set(container?.Config?.Env ?? []);
  const isRunning = container?.State?.Status === "running";

  if (!isRunning && !allowStopped && container?.State?.Status === "exited") {
    throw new Error("Disposable PostgreSQL is stopped; run pnpm db:test:up.");
  }

  if (
    (allowStopped
      ? !["running", "exited"].includes(container?.State?.Status)
      : container?.State?.Status !== "running") ||
    labels["com.docker.compose.project"] !== "trimtime-phase00" ||
    labels["com.docker.compose.service"] !== "db" ||
    mapping?.HostIp !== "127.0.0.1" ||
    mapping?.HostPort !== "55432" ||
    container?.Config?.Image !== image ||
    Object.keys(tmpfs).length !== 1 ||
    !Object.hasOwn(tmpfs, "/var/lib/postgresql") ||
    !env.has("POSTGRES_USER=trimtime_test") ||
    !env.has("POSTGRES_PASSWORD=local_test_only") ||
    !env.has("POSTGRES_DB=trimtime_test") ||
    (isRunning && container?.State?.Health?.Status !== "healthy")
  ) {
    throw new Error(
      "Docker container does not match the owned disposable test database.",
    );
  }
}

export function verifyOwnedTestDatabase(): string {
  const url = getTestDatabaseUrl({
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  });
  verifyTestContainer();
  return url;
}
