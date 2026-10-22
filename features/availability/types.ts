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
