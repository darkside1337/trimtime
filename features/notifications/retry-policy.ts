export function getNextRetryAt(input: {
  attemptNumber: number;
  reason: string | null;
  finishedAt: Date;
}): Date | null {
  if (input.reason !== "transient_rejection") return null;
  if (input.attemptNumber === 1) {
    return new Date(input.finishedAt.getTime() + 10 * 60 * 1000);
  }
  if (input.attemptNumber === 2) {
    return new Date(input.finishedAt.getTime() + 20 * 60 * 1000);
  }
  return null;
}
