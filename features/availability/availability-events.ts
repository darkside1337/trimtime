export const availabilityEventNames = {
  add: "trimtime:availability-add",
  edit: "trimtime:availability-edit",
  changed: "trimtime:availability-changed",
} as const;

export type AvailabilityEditDetail = {
  date: string;
  target: string;
  view?: "date" | "block";
};

function subscribe(
  target: EventTarget,
  name: string,
  listener: (event: Event) => void,
) {
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
}

function emit(target: EventTarget, name: string) {
  target.dispatchEvent(new Event(name));
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function emitAvailabilityAdd(target: EventTarget = window) {
  emit(target, availabilityEventNames.add);
}

export function subscribeAvailabilityAdd(
  listener: () => void,
  target: EventTarget = window,
) {
  return subscribe(target, availabilityEventNames.add, listener);
}

export function emitAvailabilityChanged(target: EventTarget = window) {
  emit(target, availabilityEventNames.changed);
}

export function subscribeAvailabilityChanged(
  listener: () => void,
  target: EventTarget = window,
) {
  return subscribe(target, availabilityEventNames.changed, listener);
}

export function emitAvailabilityEdit(
  detail: AvailabilityEditDetail,
  target: EventTarget = window,
) {
  target.dispatchEvent(
    new CustomEvent(availabilityEventNames.edit, { detail }),
  );
}

export function subscribeAvailabilityEdit(
  listener: (detail: AvailabilityEditDetail) => void,
  target: EventTarget = window,
) {
  return subscribe(target, availabilityEventNames.edit, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (
      !detail ||
      typeof detail !== "object" ||
      !("date" in detail) ||
      typeof detail.date !== "string" ||
      !isDate(detail.date) ||
      !("target" in detail) ||
      typeof detail.target !== "string" ||
      !detail.target ||
      ("view" in detail &&
        detail.view !== undefined &&
        detail.view !== "date" &&
        detail.view !== "block")
    ) {
      return;
    }
    listener(detail as AvailabilityEditDetail);
  });
}
