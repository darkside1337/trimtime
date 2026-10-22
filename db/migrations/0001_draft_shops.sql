CREATE TABLE "shops" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "subdomain" text NOT NULL,
  "time_zone" text NOT NULL,
  "public_contact" text NOT NULL,
  "address" text NOT NULL,
  "published" boolean NOT NULL DEFAULT false,
  "time_zone_locked_at" timestamp,
  CONSTRAINT "shops_owner_id_key" UNIQUE ("owner_id"),
  CONSTRAINT "shops_subdomain_key" UNIQUE ("subdomain"),
  CONSTRAINT "shops_subdomain_check" CHECK (
    "subdomain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    AND "subdomain" NOT IN ('app', 'www', 'api', 'admin')
  )
);
