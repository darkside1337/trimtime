import { useCallback, useEffect, useRef, useState } from "react";
import { getOwnDateAvailabilityAction } from "../actions";
import type { DateAvailabilityView, ScheduleTarget } from "../types";

export function useDateAvailability() {
  const [loaded, setLoaded] = useState<{
    date: string;
    target: ScheduleTarget;
    data: DateAvailabilityView;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);

  useEffect(
    () => () => {
      requestVersion.current++;
    },
    [],
  );

  const load = useCallback(async (date: string, target: ScheduleTarget) => {
    if (!date) return null;
    const version = ++requestVersion.current;
    setLoading(true);
    let result: Awaited<ReturnType<typeof getOwnDateAvailabilityAction>>;
    try {
      result = await getOwnDateAvailabilityAction({ date });
    } catch {
      if (version !== requestVersion.current) return null;
      setLoading(false);
      return {
        error: "Unable to load dated availability. Try again.",
      } as const;
    }
    if (version !== requestVersion.current) return null;
    setLoading(false);
    if (!result.success) return { error: result.error.message } as const;

    const state =
      target.kind === "shop"
        ? result.data.shop
        : result.data.barbers.find((barber) => barber.id === target.barberId)
            ?.schedule;
    setLoaded({ date, target, data: result.data });
    return { data: result.data, state } as const;
  }, []);

  return { loaded, loading, load };
}
