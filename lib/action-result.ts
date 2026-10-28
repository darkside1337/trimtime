export type ActionFieldErrors = Record<string, string[]>;

export type BookingConflict = {
  bookingId: string;
  customerName: string;
  serviceName: string;
  barberName: string;
  startAt: string;
  endAt: string;
};

export type ActionError = {
  message: string;
  code?: string;
  bookingConflicts?: BookingConflict[];
};

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: ActionError; fieldErrors?: ActionFieldErrors };
