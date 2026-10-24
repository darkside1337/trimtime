import { describe, expect, it, vi } from "vitest";
import {
  availabilityEventNames,
  emitAvailabilityAdd,
  emitAvailabilityChanged,
  emitAvailabilityEdit,
  subscribeAvailabilityAdd,
  subscribeAvailabilityChanged,
  subscribeAvailabilityEdit,
} from "../availability-events";

describe("availability events", () => {
  it("keeps the existing add and changed event names and removes listeners", () => {
    const target = new EventTarget();
    const onAdd = vi.fn();
    const onChanged = vi.fn();
    const unsubscribeAdd = subscribeAvailabilityAdd(onAdd, target);
    const unsubscribeChanged = subscribeAvailabilityChanged(onChanged, target);

    emitAvailabilityAdd(target);
    emitAvailabilityChanged(target);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();

    unsubscribeAdd();
    unsubscribeChanged();
    emitAvailabilityAdd(target);
    emitAvailabilityChanged(target);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(availabilityEventNames.add).toBe("trimtime:availability-add");
    expect(availabilityEventNames.changed).toBe(
      "trimtime:availability-changed",
    );
  });

  it("accepts the existing edit payload and ignores malformed external events", () => {
    const target = new EventTarget();
    const onEdit = vi.fn();
    const unsubscribe = subscribeAvailabilityEdit(onEdit, target);
    const detail = {
      date: "2026-11-02",
      target: "barber-1",
      view: "block" as const,
    };

    emitAvailabilityEdit(detail, target);
    target.dispatchEvent(
      new CustomEvent(availabilityEventNames.edit, {
        detail: { date: "tomorrow", target: "barber-1" },
      }),
    );
    target.dispatchEvent(
      new CustomEvent(availabilityEventNames.edit, {
        detail: { date: "2026-02-30", target: "barber-1" },
      }),
    );
    target.dispatchEvent(
      new CustomEvent(availabilityEventNames.edit, {
        detail: { date: "2026-11-02", target: "barber-1", view: "unknown" },
      }),
    );
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith(detail);

    unsubscribe();
    emitAvailabilityEdit(detail, target);
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
