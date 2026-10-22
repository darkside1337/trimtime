import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { ownerAuthOptions } from "@/server/auth-options";

export const auth = betterAuth({
  ...ownerAuthOptions,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
});
