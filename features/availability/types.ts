export type MinuteRange = { start: number; end: number };

export type ScheduleTarget =
  { kind: "shop" } | { kind: "barber"; barberId: string };

export type Section = "shop" | "barber" | "dates";

export function isSameTarget(a: ScheduleTarget, b: ScheduleTarget) {
  return (
    a.kind === b.kind &&
    (a.kind === "shop" || (b.kind === "barber" && a.barberId === b.barberId))
  );
}

export function scheduleTargetFromValue(value: string): ScheduleTarget {
  return value === "shop"
    ? { kind: "shop" }
    : { kind: "barber", barberId: value };
}

export function scheduleTargetValue(target: ScheduleTarget) {
  return target.kind === "shop" ? "shop" : target.barberId;
}

export function barberIdForTarget(
  target: ScheduleTarget,
  activeBarbers: readonly { id: string }[],
) {
  return target.kind === "barber" &&
    activeBarbers.some((barber) => barber.id === target.barberId)
    ? target.barberId
    : "";
}

export type DaySchedule = {
  working: MinuteRange[];
  breaks: MinuteRange[];
};

export type WeeklySchedule = DaySchedule[];

export type ScheduleView = {
  week: WeeklySchedule;
  revision: number;
};

export type Slot = {
  start: string;
  end: string;
  localStart: string;
  offset: string;
};

export type OccupiedInterval = { start: string; end: string };

export type DateScheduleView = {
  override: DaySchedule | null;
  closed: boolean;
  revision: number;
};
export type TimeBlockView = OccupiedInterval & {
  id: string;
  barberId: string;
  note: string;
};
export type DateAvailabilityView = {
  date: string;
  timeZone: string;
  shop: DateScheduleView;
  barbers: {
    id: string;
    name: string;
    archived: boolean;
    schedule: DateScheduleView;
  }[];
  blocks: TimeBlockView[];
};
