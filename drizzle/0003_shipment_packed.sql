ALTER TABLE `shipments` ADD `packed_at` integer;--> statement-breakpoint
ALTER TABLE `shipments` ADD `packed_by` text REFERENCES users(id) ON DELETE set null;