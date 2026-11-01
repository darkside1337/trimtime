const MANAGE_LINK_LIFETIME_MS = 168 * 60 * 60_000;
const CUSTOMER_CHANGE_CUTOFF_MS = 12 * 60 * 60_000;

export function isCustomerManageLinkValid(
  endAt: Date,
  capabilityRevokedAt: Date | null,
  now: Date,
): boolean {
  return (
    capabilityRevokedAt === null &&
    now.getTime() < endAt.getTime() + MANAGE_LINK_LIFETIME_MS
  );
}

export function isCustomerChangeCutoffPassed(
  startAt: Date,
  now: Date,
): boolean {
  return startAt.getTime() - now.getTime() < CUSTOMER_CHANGE_CUTOFF_MS;
}
