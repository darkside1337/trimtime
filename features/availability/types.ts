export type MinuteRange = { start: number; end: number };

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
