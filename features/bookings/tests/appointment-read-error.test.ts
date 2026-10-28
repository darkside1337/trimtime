import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OwnerAppointmentView } from "../types";

const appointment: OwnerAppointmentView = {
  id: "b4ea1dde-63b4-4ab9-a891-55c446f71ac8",
  revision: 1,
  status: "confirmed",
  startAt: "2027-01-19T13:07:00.000Z",
  endAt: "2027-01-19T13:42:00.000Z",
  service: {
    id: "service-1",
    name: "Walk-in Cut",
    priceUsd: "25",
    durationMinutes: 35,
  },
  barber: { id: "barber-1", name: "Sam", archived: false },
  customer: {
    name: "Journey Guest",
    email: null,
    phone: null,
    whatsappOptIn: false,
  },
  shop: {
    name: "Juniper Barber",
    publicContact: "Call",
    address: "123 Example Street",
    timeZone: "America/New_York",
  },
  notifications: {
    email: { status: "unavailable", reason: null, updatedAt: null },
  },
};

describe("appointment action read errors", () => {
  it("keeps appointment details visible and offers a retry when action choices fail", async () => {
    process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
    vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("not found");
      },
      redirect: (href: string) => {
        throw new Error(`redirect:${href}`);
      },
    }));
    vi.doMock(resolve(process.cwd(), "server/owner-context.ts"), () => ({
      readOwnerContext: async () => ({ userId: "owner" }),
    }));
    vi.doMock(resolve(process.cwd(), "features/bookings/queries.ts"), () => ({
      getOwnAppointment: async () => ({ success: true, data: appointment }),
      getOwnAppointmentMoveChoices: async () => ({
        success: false,
        error: {
          code: "UNAVAILABLE",
          message: "Appointment choices could not be loaded. Try again.",
        },
      }),
    }));
    vi.doMock(
      resolve(
        process.cwd(),
        "features/bookings/components/appointment-operations.tsx",
      ),
      () => ({
        AppointmentCalendarBackLink: ({ href }: { href: string }) =>
          createElement("a", { href }, "Back to calendar"),
        AppointmentOperations: () =>
          createElement("button", null, "Move appointment"),
      }),
    );

    const { default: AppointmentPage } =
      await import("../../../app/owner/(management)/(calendar)/appointments/[appointmentId]/page");
    const html = await render(
      createElement(AppointmentPage, {
        params: Promise.resolve({ appointmentId: appointment.id }),
        searchParams: Promise.resolve({
          date: "2027-01-19",
          view: "week",
          barber: "barber&1",
        }),
      }),
    );

    expect(html).toContain("Journey Guest");
    expect(html).toContain("Walk-in Cut");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Appointment actions could not be loaded");
    expect(html).toContain("Try again");
    expect(html).toContain(
      `href="/appointments/${appointment.id}?date=2027-01-19&amp;view=week&amp;barber=barber%261"`,
    );
  });
});

function render(element: ReactElement) {
  return new Promise<string>((resolve, reject) => {
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        const body = new PassThrough();
        let html = "";
        body.on("data", (chunk) => (html += chunk.toString()));
        body.on("end", () => resolve(html));
        stream.pipe(body);
      },
      onError: reject,
    });
  });
}
