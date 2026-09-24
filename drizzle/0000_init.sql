CREATE TABLE `carrier_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`credentials` text,
	`marketplace_account_id` text,
	`sender` text,
	`settings` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`marketplace_account_id`) REFERENCES `marketplace_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `job_locks` (
	`key` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `label_files` (
	`shipment_id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`size` text NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `marketplace_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`credentials` text,
	`settings` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sync_cursor` text,
	`last_synced_at` integer,
	`last_error` text,
	`stock_sync_enabled` integer DEFAULT false NOT NULL,
	`stock_dry_run` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`external_line_id` text NOT NULL,
	`sku` text,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` text NOT NULL,
	`external_product_id` text,
	`product_id` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_sku_idx` ON `order_items` (`sku`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`marketplace` text NOT NULL,
	`external_id` text NOT NULL,
	`external_number` text NOT NULL,
	`marketplace_status` text NOT NULL,
	`ready_to_ship` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`buyer` text NOT NULL,
	`shipping_address` text NOT NULL,
	`delivery_method_id` text,
	`delivery_method_name` text,
	`pickup_point_id` text,
	`cod_amount` text,
	`total_amount` text NOT NULL,
	`shipping_amount` text,
	`currency` text NOT NULL,
	`placed_at` integer NOT NULL,
	`paid_at` integer,
	`shipped_at` integer,
	`assignee_id` text,
	`tags` text NOT NULL,
	`revision` text,
	`stock_applied` integer DEFAULT false NOT NULL,
	`raw` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `marketplace_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_account_external_idx` ON `orders` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_placed_at_idx` ON `orders` (`placed_at`);--> statement-breakpoint
CREATE TABLE `package_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`length_cm` integer NOT NULL,
	`width_cm` integer NOT NULL,
	`height_cm` integer NOT NULL,
	`weight_kg` text NOT NULL,
	`inpost_template` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`product_id` text,
	`external_id` text NOT NULL,
	`sku` text,
	`title` text NOT NULL,
	`ref` text NOT NULL,
	`last_seen_qty` integer,
	`last_seen_at` integer,
	`last_pushed_qty` integer,
	`last_pushed_at` integer,
	`last_push_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `marketplace_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_listings_account_external_idx` ON `product_listings` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `product_listings_product_idx` ON `product_listings` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shipment_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text,
	`total` integer NOT NULL,
	`skipped` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`carrier_account_id` text NOT NULL,
	`carrier` text NOT NULL,
	`service` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`external_id` text,
	`command_id` text,
	`carrier_code` text,
	`tracking_number` text,
	`tracking_url` text,
	`parcel` text NOT NULL,
	`options` text NOT NULL,
	`label_format` text DEFAULT 'pdf' NOT NULL,
	`label_size` text DEFAULT 'A6' NOT NULL,
	`error` text,
	`poll_attempts` integer DEFAULT 0 NOT NULL,
	`tracking_pushed_at` integer,
	`tracking_push_error` text,
	`delivery_status` text,
	`delivered_at` integer,
	`batch_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carrier_account_id`) REFERENCES `carrier_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `shipment_batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_one_active_per_order` ON `shipments` (`order_id`) WHERE state in ('pending', 'created');--> statement-breakpoint
CREATE INDEX `shipments_batch_idx` ON `shipments` (`batch_id`);--> statement-breakpoint
CREATE INDEX `shipments_state_idx` ON `shipments` (`state`);--> statement-breakpoint
CREATE TABLE `shipping_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`conditions` text NOT NULL,
	`carrier_account_id` text NOT NULL,
	`service` text NOT NULL,
	`package_preset_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`carrier_account_id`) REFERENCES `carrier_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_preset_id`) REFERENCES `package_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`order_id` text,
	`user_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stock_movements_product_idx` ON `stock_movements` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`listing_id` text,
	`quantity` integer NOT NULL,
	`dry_run` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `marketplace_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `product_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_sync_log_created_idx` ON `stock_sync_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);