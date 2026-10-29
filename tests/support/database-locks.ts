import type { Pool, PoolClient } from "pg";

/**
 * Support for concurrency tests that queue real requests behind a lock-owning
 * connection.
 *
 * The barrier is the connection that holds the shop row lock. A waiter only
 * counts when PostgreSQL reports it is blocked by that exact connection, so an
 * unrelated lock wait anywhere in the database can never satisfy the barrier.
 * The recursive query also follows wait chains, which covers a request that is
 * blocked by another queued request instead of by the barrier directly.
 */

export type RequestIdentity =
  | "replace"
  | "cancel"
  | "owner_move"
  | "owner_cancel"
  | "owner_create"
  | "public_booking"
  | "shop_edit"
  | string
  | RegExp;

export interface LockWaiter {
  pid: number;
  query: string;
  waitEventType: string | null;
  waitEvent: string | null;
  blockers: number[];
  depth: number;
}

export interface WaitForLockWaitersOptions {
  /** Upper bound for the whole poll, not a per-attempt delay. Default 5000ms. */
  timeoutMs?: number;
  /** Delay between observations. Default 10ms. */
  intervalMs?: number;
  /** Label included in timeout diagnostics. */
  description?: string;
}

export type LockOwningClient = Pick<PoolClient, "query">;
export type LockObserver = Pick<Pool, "query">;

const barrierPidCache = new WeakMap<object, number>();

/**
 * Matches the SQL a queued request is running against the request identity the
 * test expects. Identities mirror the statement shapes the booking mutations
 * actually send, so a barrier cannot be satisfied by a different request that
 * happens to be waiting on the same connection.
 */
export function matchesIdentity(
  query: string,
  identity: RequestIdentity,
): boolean {
  const normalized = query.toLowerCase();
  const locksShops = /for update/i.test(query);
  const ownerLocked =
    query.includes('"shops"."owner_id"') || query.includes('"owner_id" =');

  switch (identity) {
    case "replace":
      return (
        query.includes("s.time_zone") &&
        !query.includes('"shops"."owner_id"') &&
        locksShops
      );
    case "cancel":
      return (
        query.includes("owner_email") &&
        !query.includes("time_zone") &&
        locksShops
      );
    case "owner_move":
      return ownerLocked && locksShops;
    case "owner_cancel":
      return (
        ownerLocked &&
        !normalized.includes("time_zone") &&
        !normalized.includes("subdomain") &&
        locksShops
      );
    case "owner_create":
      return normalized.includes("subdomain") && locksShops;
    case "public_booking":
      return normalized.includes("published") && locksShops;
    case "shop_edit":
      return locksShops && /\bshops\b/.test(normalized);
    default:
      if (typeof identity === "string") return query.includes(identity);
      if (identity instanceof RegExp) return identity.test(query);
      return false;
  }
}

export async function resolveBarrierPid(
  barrier: LockOwningClient,
): Promise<number> {
  const cached = barrierPidCache.get(barrier);
  if (cached !== undefined) return cached;
  const result = await barrier.query("SELECT pg_backend_pid() AS pid");
  const pid = Number((result.rows[0] as { pid?: number } | undefined)?.pid);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error("Could not resolve the barrier backend PID.");
  barrierPidCache.set(barrier, pid);
  return pid;
}

async function readWaitersForBarrier(
  observer: LockObserver,
  barrierPid: number,
): Promise<LockWaiter[]> {
  const result = await observer.query(
    `WITH RECURSIVE lock_chain(pid, query, wait_event_type, wait_event, blockers, depth) AS (
      SELECT
        a.pid,
        a.query,
        a.wait_event_type,
        a.wait_event,
        pg_blocking_pids(a.pid) AS blockers,
        1 AS depth
      FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.pid <> $1
        AND $1 = ANY(pg_blocking_pids(a.pid))
      UNION
      SELECT
        a.pid,
        a.query,
        a.wait_event_type,
        a.wait_event,
        pg_blocking_pids(a.pid) AS blockers,
        lc.depth + 1 AS depth
      FROM pg_stat_activity a
      JOIN lock_chain lc ON lc.pid = ANY(pg_blocking_pids(a.pid))
      WHERE a.datname = current_database()
        AND a.pid <> $1
    )
    SELECT DISTINCT pid, query, wait_event_type, wait_event, blockers, depth
    FROM lock_chain
    ORDER BY depth ASC, pid ASC`,
    [barrierPid],
  );

  return (result.rows as Record<string, unknown>[]).map((row) => ({
    pid: Number(row.pid),
    query: String(row.query ?? ""),
    waitEventType: (row.wait_event_type as string | null) ?? null,
    waitEvent: (row.wait_event as string | null) ?? null,
    blockers: ((row.blockers as number[] | null) ?? []).map(Number),
    depth: Number(row.depth),
  }));
}

/**
 * Returns the lock waiters that are blocked, directly or transitively, by the
 * given barrier connection. Does not wait or assert.
 */
export async function readLockWaiters(
  observer: LockObserver,
  barrier: LockOwningClient,
): Promise<LockWaiter[]> {
  const barrierPid = await resolveBarrierPid(barrier);
  return readWaitersForBarrier(observer, barrierPid);
}

function describeWaiter(waiter: LockWaiter): string {
  const query = waiter.query.replace(/\s+/g, " ").trim();
  return [
    `pid=${waiter.pid}`,
    `depth=${waiter.depth}`,
    `wait=${waiter.waitEventType ?? "none"}/${waiter.waitEvent ?? "none"}`,
    `blockers=[${waiter.blockers.join(",")}]`,
    `query="${query.length > 400 ? `${query.slice(0, 400)}…` : query}"`,
  ].join(" ");
}

async function describeUnrelatedWaiters(
  observer: LockObserver,
  barrierPid: number,
  waiters: LockWaiter[],
): Promise<string[]> {
  const observed = new Set(waiters.map((waiter) => waiter.pid));
  const result = await observer.query(
    `SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers, query
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND pid <> $1
       AND wait_event_type = 'Lock'`,
    [barrierPid],
  );
  return (result.rows as Record<string, unknown>[])
    .filter((row) => !observed.has(Number(row.pid)))
    .map((row) =>
      describeWaiter({
        pid: Number(row.pid),
        query: String(row.query ?? ""),
        waitEventType: (row.wait_event_type as string | null) ?? null,
        waitEvent: (row.wait_event as string | null) ?? null,
        blockers: ((row.blockers as number[] | null) ?? []).map(Number),
        depth: -1,
      }),
    );
}

/**
 * Waits until exactly/at-least `expected` Lock waiters are blocked by the
 * barrier, optionally requiring a multiset of request identities.
 *
 * - `expected === 0` means "no waiter is blocked by this barrier".
 * - Throws a diagnostic error after the bounded timeout.
 */
export async function waitForLockWaiters(
  observer: LockObserver,
  barrier: LockOwningClient,
  expected: number,
  expectedIdentities?: RequestIdentity[],
  options: WaitForLockWaitersOptions = {},
): Promise<LockWaiter[]> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 10;
  const maxAttempts = 500;
  const description = options.description ?? "lock barrier";
  const barrierPid = await resolveBarrierPid(barrier);
  const deadline = performance.now() + timeoutMs;

  let waiters: LockWaiter[] = [];
  let attempt = 0;

  while (attempt < maxAttempts && performance.now() <= deadline) {
    attempt += 1;
    waiters = await readWaitersForBarrier(observer, barrierPid);
    const lockWaiters = waiters.filter(
      (waiter) => waiter.waitEventType === "Lock",
    );

    if (expected === 0) {
      if (lockWaiters.length === 0) return lockWaiters;
    } else if (lockWaiters.length >= expected) {
      if (!expectedIdentities || expectedIdentities.length === 0)
        return lockWaiters;
      const remaining = [...lockWaiters];
      const allMatched = expectedIdentities.every((identity) => {
        const index = remaining.findIndex((waiter) =>
          matchesIdentity(waiter.query, identity),
        );
        if (index === -1) return false;
        remaining.splice(index, 1);
        return true;
      });
      if (allMatched) return lockWaiters;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const unrelated = await describeUnrelatedWaiters(
    observer,
    barrierPid,
    waiters,
  ).catch(() => [] as string[]);
  const details = [
    `Timed out after ${timeoutMs}ms (${attempt} checks) waiting for ${expected} lock waiter(s) on ${description}.`,
    `Barrier PID: ${barrierPid}.`,
    `Expected identities: ${expectedIdentities?.length ? expectedIdentities.map(String).join(", ") : "any"}.`,
    `Observed barrier waiters: ${
      waiters.length
        ? `\n  - ${waiters.map(describeWaiter).join("\n  - ")}`
        : "none"
    }`,
    `Other lock waiters in this database (not blocked by the barrier): ${
      unrelated.length ? `\n  - ${unrelated.join("\n  - ")}` : "none"
    }`,
  ];
  throw new Error(details.join("\n"));
}

/** Waits until no lock waiter remains blocked by the barrier. */
export async function waitForLockCleanup(
  observer: LockObserver,
  barrier: LockOwningClient,
  options: WaitForLockWaitersOptions = {},
): Promise<LockWaiter[]> {
  return waitForLockWaiters(observer, barrier, 0, undefined, {
    description: "barrier cleanup",
    ...options,
  });
}

/**
 * Waits until the request queued behind `lock` is observed as blocked by that
 * exact connection and matches the expected request identity.
 */
export async function waitForBlockedRequest(
  observer: LockObserver,
  lock: LockOwningClient,
  identity: RequestIdentity,
  options: WaitForLockWaitersOptions = {},
): Promise<LockWaiter[]> {
  return waitForLockWaiters(observer, lock, 1, [identity], {
    description: `request ${String(identity)}`,
    ...options,
  });
}
