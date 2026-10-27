"use client";

import { useLinkStatus } from "next/link";
import { AppointmentLoading } from "./appointment-loading";

export function AppointmentLinkLoading() {
  const { pending } = useLinkStatus();
  return pending ? <AppointmentLoading /> : null;
}
