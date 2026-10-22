export type ActionFieldErrors = Record<string, string[]>;

export type ActionError = {
  message: string;
  code?: string;
};

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: ActionError; fieldErrors?: ActionFieldErrors };
