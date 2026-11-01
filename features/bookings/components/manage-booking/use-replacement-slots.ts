"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CustomerReplacementChoices,
  CustomerReplacementSlotsView,
} from "../../types";
import { getCustomerReplacementSlotsAction } from "../../actions";

type ReplacementSlot = CustomerReplacementSlotsView["slots"][number];

type SlotState = {
  queryKey: string | null;
  slots: ReplacementSlot[];
  loading: boolean;
  error: string | null;
};

/** Loads slots while making every earlier request ineligible immediately. */
export function useReplacementSlots({
  token,
  choices,
  serviceId,
  barberId,
  date,
  onServerNow,
}: {
  token: string;
  choices: CustomerReplacementChoices | null;
  serviceId: string;
  barberId: string;
  date: string;
  onServerNow: (serverNow: string, roundTripMs: number) => void;
}) {
  const requestId = useRef(0);
  const hasQuery = Boolean(choices && serviceId && barberId && date);
  const queryKey = hasQuery
    ? JSON.stringify([token, choices?.revision, serviceId, barberId, date])
    : null;
  const [state, setState] = useState<SlotState>({
    queryKey: null,
    slots: [],
    loading: false,
    error: null,
  });

  const invalidate = useCallback((loading = true) => {
    requestId.current += 1;
    setState({ queryKey: null, slots: [], loading, error: null });
  }, []);

  useEffect(() => {
    const reqId = ++requestId.current;
    if (!choices || !serviceId || !barberId || !date) {
      return;
    }

    let active = true;
    const startedAt = performance.now();
    getCustomerReplacementSlotsAction({
      token,
      expectedRevision: choices.revision,
      serviceId,
      barberId,
      date,
    })
      .then((result) => {
        if (!active || requestId.current !== reqId) return;
        if (result.success) {
          const roundTripMs = Math.max(0, performance.now() - startedAt);
          setState({
            queryKey,
            slots: result.data.slots,
            loading: false,
            error: null,
          });
          onServerNow(result.data.serverNow, roundTripMs);
        } else {
          setState({
            queryKey,
            slots: [],
            loading: false,
            error: result.error.message,
          });
        }
      })
      .catch(() => {
        if (!active || requestId.current !== reqId) return;
        setState({
          queryKey,
          slots: [],
          loading: false,
          error: "Could not load times. Please try again.",
        });
      });

    return () => {
      active = false;
    };
  }, [token, choices, serviceId, barberId, date, onServerNow, queryKey]);

  const settledForCurrentQuery = state.queryKey === queryKey;
  return {
    slots: settledForCurrentQuery ? state.slots : [],
    loading: hasQuery && (!settledForCurrentQuery || state.loading),
    error: settledForCurrentQuery ? state.error : null,
    invalidate,
  };
}
