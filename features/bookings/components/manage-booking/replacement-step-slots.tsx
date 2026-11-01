import { cn } from "@/lib/utils";
import type { CustomerReplacementSlotsView } from "../../types";

type ReplacementSlot = CustomerReplacementSlotsView["slots"][number];

export function ReplacementStepSlots({
  date,
  slots,
  loading,
  error,
  barberId,
  hasAvailableBarbers,
  startAt,
  onDateChange,
  onStartAtChange,
}: {
  date: string;
  slots: ReplacementSlot[];
  loading: boolean;
  error: string | null;
  barberId: string;
  hasAvailableBarbers: boolean;
  startAt: string;
  onDateChange: (date: string) => void;
  onStartAtChange: (startAt: string) => void;
}) {
  return (
    <>
      <label
        className="grid max-w-lg gap-2 text-sm font-semibold"
        htmlFor="replacement-date"
      >
        Choose a date
        <input
          className="min-h-11 rounded-[2px] border border-[#e6e6e2] px-3 font-normal"
          id="replacement-date"
          onChange={(event) => onDateChange(event.target.value)}
          type="date"
          value={date}
        />
      </label>

      <fieldset className="grid gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">
          4. Choose a start time
        </legend>
        {loading ? (
          <p className="text-xs text-[#72726e]">Loading times…</p>
        ) : error ? (
          <p className="text-xs text-[#9f2d20]" role="alert">
            {error}
          </p>
        ) : !date ? (
          <p className="text-xs text-[#72726e]">
            Choose a date to view available times.
          </p>
        ) : !barberId || !hasAvailableBarbers ? (
          <p className="text-xs text-[#72726e]">
            No barbers available for this service.
          </p>
        ) : slots.length === 0 ? (
          <p className="text-xs text-[#72726e]">
            No available times on this date.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => {
              const isAmbiguous =
                slots.filter(
                  (candidate) => candidate.localStart === slot.localStart,
                ).length > 1;
              const label = isAmbiguous
                ? `${slot.localStart} · UTC${slot.offset}`
                : slot.localStart;

              return (
                <label
                  className={cn(
                    "grid min-h-11 cursor-pointer place-items-center border border-[#e6e6e2] px-2 text-center text-xs",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                    startAt === slot.start &&
                      "border-[#21734f] bg-[#21734f] text-white",
                  )}
                  key={slot.start}
                >
                  <input
                    checked={startAt === slot.start}
                    className="sr-only"
                    name="replacement-start"
                    onChange={() => onStartAtChange(slot.start)}
                    type="radio"
                    value={slot.start}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
    </>
  );
}
