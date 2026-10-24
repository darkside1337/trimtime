"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ActionFieldErrors } from "@/lib/action-result";
import {
  days,
  draftDayMinutes,
  formatHours,
  type DraftWeek,
} from "../schedule-draft";

export function ScheduleEditor({
  week,
  onChange,
  disabled,
  onAddBreak,
  onEditBreak,
  fieldErrors,
}: {
  week: DraftWeek;
  onChange: (week: DraftWeek) => void;
  disabled: boolean;
  onAddBreak: (day: number, opener: HTMLButtonElement) => void;
  onEditBreak: (day: number, range: number, opener: HTMLButtonElement) => void;
  fieldErrors: ActionFieldErrors;
}) {
  function update(
    dayIndex: number,
    field: "working" | "breaks",
    rangeIndex: number,
    key: "start" | "end",
    value: string,
  ) {
    onChange(
      week.map((day, index) =>
        index !== dayIndex
          ? day
          : {
              ...day,
              [field]: day[field].map((range, i) =>
                i !== rangeIndex ? range : { ...range, [key]: value },
              ),
            },
      ),
    );
  }
  function remove(
    dayIndex: number,
    field: "working" | "breaks",
    rangeIndex: number,
  ) {
    onChange(
      week.map((day, index) =>
        index !== dayIndex
          ? day
          : { ...day, [field]: day[field].filter((_, i) => i !== rangeIndex) },
      ),
    );
  }
  function add(dayIndex: number, field: "working" | "breaks") {
    onChange(
      week.map((day, index) =>
        index !== dayIndex
          ? day
          : {
              ...day,
              [field]: [
                ...day[field],
                field === "working"
                  ? { start: "09:00", end: "17:00" }
                  : { start: "12:00", end: "13:00" },
              ],
            },
      ),
    );
  }
  function handleDayOpenChange(dayIndex: number, open: boolean) {
    onChange(
      week.map((item, index) =>
        index !== dayIndex
          ? item
          : open
            ? {
                working: [{ start: "09:00", end: "17:00" }],
                breaks: [],
              }
            : { working: [], breaks: [] },
      ),
    );
  }

  return (
    <div className="mt-6 grid gap-3">
      {week.map((day, dayIndex) => (
        <section
          key={days[dayIndex]}
          aria-labelledby={`day-${dayIndex}`}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 lg:grid-cols-[100px_minmax(0,1fr)]"
        >
          <div>
            <h3 id={`day-${dayIndex}`} className="font-semibold">
              {days[dayIndex]}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {day.working.length
                ? `Open · ${formatHours(draftDayMinutes(day))}`
                : "Scheduled off"}
            </p>
            {(dayIndex === 4 || dayIndex === 5) && (
              <Badge variant="secondary" className="mt-1 px-1.5 text-[10px]">
                {dayIndex === 4 ? "5 sample bookings" : "1 sample booking"}
              </Badge>
            )}
          </div>
          <div className="contents lg:grid lg:min-w-0 lg:gap-3 lg:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
            <Label className="flex min-h-11 items-center gap-2 lg:col-span-1">
              <Switch
                checked={day.working.length > 0}
                disabled={disabled}
                onCheckedChange={(open) => handleDayOpenChange(dayIndex, open)}
              />
              {day.working.length ? "Open" : "Closed"}
            </Label>
            <div className="col-span-2 grid min-w-0 gap-2 lg:col-span-1">
              {day.working.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add hours after opening this day.
                </p>
              ) : (
                day.working.map((range, rangeIndex) => (
                  <div
                    key={`work-${rangeIndex}`}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
                  >
                    <div className="grid gap-1">
                      <Label
                        className="sr-only"
                        htmlFor={`work-${dayIndex}-${rangeIndex}-start`}
                      >
                        Opens
                      </Label>
                      <Input
                        id={`work-${dayIndex}-${rangeIndex}-start`}
                        value={range.start}
                        onChange={(event) =>
                          update(
                            dayIndex,
                            "working",
                            rangeIndex,
                            "start",
                            event.target.value,
                          )
                        }
                        disabled={disabled}
                        inputMode="numeric"
                        placeholder="09:00"
                        aria-invalid={Boolean(
                          fieldErrors[
                            `week.${dayIndex}.working.${rangeIndex}.start`
                          ],
                        )}
                        aria-describedby={
                          fieldErrors[
                            `week.${dayIndex}.working.${rangeIndex}.start`
                          ]
                            ? `time-format-hint work-${dayIndex}-${rangeIndex}-start-error`
                            : "time-format-hint"
                        }
                      />
                      {fieldErrors[
                        `week.${dayIndex}.working.${rangeIndex}.start`
                      ]?.map((error) => (
                        <span
                          id={`work-${dayIndex}-${rangeIndex}-start-error`}
                          key={error}
                          className="text-xs text-destructive"
                        >
                          {error}
                        </span>
                      ))}
                    </div>
                    <div className="grid gap-1">
                      <Label
                        className="sr-only"
                        htmlFor={`work-${dayIndex}-${rangeIndex}-end`}
                      >
                        Closes
                      </Label>
                      <Input
                        id={`work-${dayIndex}-${rangeIndex}-end`}
                        value={range.end}
                        onChange={(event) =>
                          update(
                            dayIndex,
                            "working",
                            rangeIndex,
                            "end",
                            event.target.value,
                          )
                        }
                        disabled={disabled}
                        inputMode="numeric"
                        placeholder="17:00"
                        aria-invalid={Boolean(
                          fieldErrors[
                            `week.${dayIndex}.working.${rangeIndex}.end`
                          ],
                        )}
                        aria-describedby={
                          fieldErrors[
                            `week.${dayIndex}.working.${rangeIndex}.end`
                          ]
                            ? `time-format-hint work-${dayIndex}-${rangeIndex}-end-error`
                            : "time-format-hint"
                        }
                      />
                      {fieldErrors[
                        `week.${dayIndex}.working.${rangeIndex}.end`
                      ]?.map((error) => (
                        <span
                          id={`work-${dayIndex}-${rangeIndex}-end-error`}
                          key={error}
                          className="text-xs text-destructive"
                        >
                          {error}
                        </span>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => remove(dayIndex, "working", rangeIndex)}
                    >
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">Remove hours</span>
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="col-span-2 grid min-w-0 gap-2 lg:col-span-1">
              {day.breaks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {day.breaks.map((range, rangeIndex) => (
                    <div
                      key={`break-${rangeIndex}`}
                      className="flex items-center rounded-full bg-muted text-sm"
                    >
                      <Button
                        id={`break-${dayIndex}-${rangeIndex}`}
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-l-full px-3"
                        disabled={disabled}
                        aria-invalid={Boolean(
                          fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.start`
                          ] ||
                          fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.end`
                          ],
                        )}
                        aria-describedby={
                          fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.start`
                          ] ||
                          fieldErrors[
                            `week.${dayIndex}.breaks.${rangeIndex}.end`
                          ]
                            ? `break-${dayIndex}-${rangeIndex}-error`
                            : undefined
                        }
                        aria-label={`Edit ${days[dayIndex]} break ${range.start} to ${range.end}`}
                        onClick={(event) =>
                          onEditBreak(dayIndex, rangeIndex, event.currentTarget)
                        }
                      >
                        Break · {range.start}–{range.end}
                      </Button>
                      {(fieldErrors[
                        `week.${dayIndex}.breaks.${rangeIndex}.start`
                      ] ||
                        fieldErrors[
                          `week.${dayIndex}.breaks.${rangeIndex}.end`
                        ]) && (
                        <span
                          id={`break-${dayIndex}-${rangeIndex}-error`}
                          className="sr-only"
                        >
                          {[
                            ...(fieldErrors[
                              `week.${dayIndex}.breaks.${rangeIndex}.start`
                            ] ?? []),
                            ...(fieldErrors[
                              `week.${dayIndex}.breaks.${rangeIndex}.end`
                            ] ?? []),
                          ].join(" ")}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-r-full px-2"
                        disabled={disabled}
                        aria-label={`Remove ${days[dayIndex]} break ${range.start} to ${range.end}`}
                        onClick={() => remove(dayIndex, "breaks", rangeIndex)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => add(dayIndex, "working")}
                >
                  Add hours
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || day.working.length === 0}
                  onClick={(event) => onAddBreak(dayIndex, event.currentTarget)}
                >
                  Add break
                </Button>
              </div>
            </div>
          </div>
        </section>
      ))}
      <p id="time-format-hint" className="text-xs text-muted-foreground">
        Enter 24-hour times as HH:MM. Use 24:00 only for an end time. Adjacent
        ranges are allowed.
      </p>
    </div>
  );
}
