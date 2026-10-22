CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"name" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"duration_minutes" numeric NOT NULL,
	"offered" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "services_shop_id_id_key" UNIQUE("shop_id", "id"),
	CONSTRAINT "services_price_usd_check" CHECK ("services"."price_usd" >= 0 AND "services"."price_usd" < 'Infinity'::numeric AND scale("services"."price_usd") <= 2),
	CONSTRAINT "services_duration_minutes_check" CHECK ("services"."duration_minutes" >= 30 AND "services"."duration_minutes" < 'Infinity'::numeric AND "services"."duration_minutes" = trunc("services"."duration_minutes"))
);
--> statement-breakpoint
CREATE TABLE "barbers" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "barbers_shop_id_id_key" UNIQUE("shop_id", "id")
);
--> statement-breakpoint
CREATE TABLE "barber_services" (
	"shop_id" text NOT NULL,
	"barber_id" text NOT NULL,
	"service_id" text NOT NULL,
	CONSTRAINT "barber_services_pkey" PRIMARY KEY("shop_id", "barber_id", "service_id")
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_barber_fkey" FOREIGN KEY ("shop_id","barber_id") REFERENCES "public"."barbers"("shop_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_service_fkey" FOREIGN KEY ("shop_id","service_id") REFERENCES "public"."services"("shop_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "barber_services_service_idx" ON "barber_services" USING btree ("shop_id","service_id");
