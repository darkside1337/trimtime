import { useCallback, useEffect, useRef, useState } from "react";
import { getOwnDateAvailabilityAction } from "../actions";
import type { DateAvailabilityView, ScheduleTarget } from "../types";

export function useDateAvailability() {
  const [data, setData] = useState<DateAvailabilityView | null>(null);
  const [loadedTarget, setLoadedTarget] =
    useState<ScheduleTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);

  useEffect(
    () => () => {
      requestVersion.current++;
    },
    [],
  );

  const load = useCallback(
    async (date: string, target: ScheduleTarget) => {
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
      setData(result.data);
      setLoadedTarget(target);
      return { data: result.data, state } as const;
    },
    [],
  );

  return { data, loadedTarget, loading, load };
}
