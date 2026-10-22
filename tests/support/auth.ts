import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { ownerAuthOptions } from "@/server/auth-options";

export const testAuth = betterAuth({
  ...ownerAuthOptions,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  plugins: [testUtils()],
});
