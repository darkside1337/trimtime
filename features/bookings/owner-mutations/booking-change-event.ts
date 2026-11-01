export type BookingChangeEvent = {
  id: string;
  kind: "move" | "cancel" | "restore" | "attendance";
  appliedRevision: number;
  committedAt: Date;
  afterSnapshot: Record<string, unknown>;
};

export function bookingChangeEvent(row: {
  id: string;
  kind: string;
  appliedRevision: number;
  committedAt: Date;
  afterSnapshot: unknown;
}): BookingChangeEvent {
  return {
    id: row.id,
    kind: row.kind as BookingChangeEvent["kind"],
    appliedRevision: row.appliedRevision,
    committedAt: row.committedAt,
    afterSnapshot: row.afterSnapshot as Record<string, unknown>,
  };
}
