export type AuthoritativeServerClock = {
  serverTimeMs: number;
  recordedAtMonotonicMs: number;
  networkDelayMs: number;
};

export function checkCutoffWithin12Hours(
  slotIso: string,
  serverClock: AuthoritativeServerClock | null,
): boolean {
  const startMs = new Date(slotIso).getTime();
  if (Number.isNaN(startMs)) return false;

  const twelveHoursMs = 12 * 60 * 60_000;
  const candidates: number[] = [Date.now()];

  if (serverClock) {
    const elapsedMonotonic = Math.max(
      0,
      performance.now() - serverClock.recordedAtMonotonicMs,
    );
    const baseServerNowMs = serverClock.serverTimeMs + elapsedMonotonic;
    candidates.push(baseServerNowMs);
    candidates.push(baseServerNowMs + Math.max(0, serverClock.networkDelayMs));
  }

  return candidates.some((nowMs) => {
    const diff = startMs - nowMs;
    return diff > 0 && diff <= twelveHoursMs;
  });
}
