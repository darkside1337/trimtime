import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NEXT_PHASE !== "phase-production-build") {
  throw new Error("DATABASE_URL is required to use the application database.");
}

export const pool = new Pool({
  connectionString:
    connectionString ?? "postgresql://build:build@127.0.0.1:1/trimtime_build",
});
attachDatabasePool(pool);
export const db = drizzle(pool);
