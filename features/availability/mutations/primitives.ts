import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { barbers } from "@/db/schema/catalog";
import type { ActionResult } from "@/lib/action-result";
import type { TimeBlockView } from "../types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type LockedShop = { id: string; timeZone: string };

async function findActiveBarber(
  tx: Transaction,
  shopId: string,
  barberId: string,
): Promise<{ id: string } | undefined> {
  const [barber] = await tx
    .select({ id: barbers.id })
    .from(barbers)
    .where(
      and(
        eq(barbers.id, barberId),
        eq(barbers.shopId, shopId),
        eq(barbers.archived, false),
      ),
    )
    .limit(1);
  return barber;
}

async function lockOwnerShop(
  tx: Transaction,
  userId: string,
): Promise<LockedShop | undefined> {
  const locked = await tx.execute(
    sql`SELECT id, time_zone FROM shops WHERE owner_id = ${userId} FOR UPDATE`,
  );
  const row = locked.rows[0] as { id: string; time_zone: string } | undefined;
  return row ? { id: row.id, timeZone: row.time_zone } : undefined;
}

function validationError<T>(
  error: z.ZodError,
  message: string,
): ActionResult<T> {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message,
    },
    fieldErrors: error.issues.reduce<Record<string, string[]>>(
      (errors, issue) => {
        const path = issue.path.join(".");
        if (path) (errors[path] ??= []).push(issue.message);
        return errors;
      },
      {},
    ),
  };
}

function blockValidationError(error: z.ZodError): ActionResult<TimeBlockView> {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Check the block date and times.",
    },
    fieldErrors: error.flatten().fieldErrors,
  };
}

function denied<T>(): ActionResult<T> {
  return {
    success: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Sign in to manage availability.",
    },
  };
}

export {
  denied,
  findActiveBarber,
  lockOwnerShop,
  validationError,
  blockValidationError,
};
export type { Transaction };
