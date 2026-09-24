CREATE TYPE "public"."carrier_type" AS ENUM('inpost', 'allegro_shipping');--> statement-breakpoint
CREATE TYPE "public"."label_format" AS ENUM('pdf', 'zpl');--> statement-breakpoint
CREATE TYPE "public"."label_size" AS ENUM('A4', 'A6');--> statement-breakpoint
CREATE TYPE "public"."marketplace_type" AS ENUM('shopify', 'allegro', 'empik');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'processing', 'label_created', 'shipped', 'delivered', 'on_hold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shipment_state" AS ENUM('pending', 'created', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'staff');--> statement-breakpoint
CREATE TABLE "carrier_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "carrier_type" NOT NULL,
	"name" text NOT NULL,
	"credentials" text,
	"marketplace_account_id" uuid,
	"sender" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_files" (
	"shipment_id" uuid PRIMARY KEY NOT NULL,
	"format" "label_format" NOT NULL,
	"size" "label_size" NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "marketplace_type" NOT NULL,
	"name" text NOT NULL,
	"credentials" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"stock_sync_enabled" boolean DEFAULT false NOT NULL,
	"stock_dry_run" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"external_line_id" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"external_product_id" text,
	"product_id" uuid
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"marketplace" "marketplace_type" NOT NULL,
	"external_id" text NOT NULL,
	"external_number" text NOT NULL,
	"marketplace_status" text NOT NULL,
	"ready_to_ship" boolean DEFAULT true NOT NULL,
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"buyer" jsonb NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"delivery_method_id" text,
	"delivery_method_name" text,
	"pickup_point_id" text,
	"cod_amount" numeric(12, 2),
	"total_amount" numeric(12, 2) NOT NULL,
	"shipping_amount" numeric(12, 2),
	"currency" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"assignee_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"revision" text,
	"stock_applied" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"length_cm" integer NOT NULL,
	"width_cm" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"weight_kg" numeric(6, 2) NOT NULL,
	"inpost_template" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"product_id" uuid,
	"external_id" text NOT NULL,
	"sku" text,
	"title" text NOT NULL,
	"ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_qty" integer,
	"last_seen_at" timestamp with time zone,
	"last_pushed_qty" integer,
	"last_pushed_at" timestamp with time zone,
	"last_push_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid,
	"total" integer NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"carrier" "carrier_type" NOT NULL,
	"service" text NOT NULL,
	"state" "shipment_state" DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"command_id" text,
	"carrier_code" text,
	"tracking_number" text,
	"tracking_url" text,
	"parcel" jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"label_format" "label_format" DEFAULT 'pdf' NOT NULL,
	"label_size" "label_size" DEFAULT 'A6' NOT NULL,
	"error" text,
	"poll_attempts" integer DEFAULT 0 NOT NULL,
	"tracking_pushed_at" timestamp with time zone,
	"tracking_push_error" text,
	"delivery_status" text,
	"delivered_at" timestamp with time zone,
	"batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"carrier_account_id" uuid NOT NULL,
	"service" text NOT NULL,
	"package_preset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"order_id" uuid,
	"user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"listing_id" uuid,
	"quantity" integer NOT NULL,
	"dry_run" boolean NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "carrier_accounts_marketplace_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("marketplace_account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_files" ADD CONSTRAINT "label_files_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_batches" ADD CONSTRAINT "shipment_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_batch_id_shipment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."shipment_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_package_preset_id_package_presets_id_fk" FOREIGN KEY ("package_preset_id") REFERENCES "public"."package_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_sync_log" ADD CONSTRAINT "stock_sync_log_account_id_marketplace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."marketplace_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_sync_log" ADD CONSTRAINT "stock_sync_log_listing_id_product_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."product_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_account_external_idx" ON "orders" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_placed_at_idx" ON "orders" USING btree ("placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_listings_account_external_idx" ON "product_listings" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "product_listings_product_idx" ON "product_listings" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_one_active_per_order" ON "shipments" USING btree ("order_id") WHERE state in ('pending', 'created');--> statement-breakpoint
CREATE INDEX "shipments_batch_idx" ON "shipments" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "shipments_state_idx" ON "shipments" USING btree ("state");--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_sync_log_created_idx" ON "stock_sync_log" USING btree ("created_at");