"use client";

import { useEffect } from "react";
import { useOwnerAppointmentDraft } from "../components/owner-calendar-context";

export function useAppointmentDismissal(modal = false) {
  const { requestClose, requestNavigation, setModalActive } =
    useOwnerAppointmentDraft();

  useEffect(() => {
    if (!modal) return;
    setModalActive(modal);
    return () => setModalActive(false);
  }, [modal, setModalActive]);

  return {
    requestClose,
    requestNavigation,
  };
}
