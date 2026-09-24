import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Address, Buyer, ParcelSpec, SenderSettings } from '../integrations/types';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum('user_role', ['admin', 'staff']);
export const marketplaceType = pgEnum('marketplace_type', ['shopify', 'allegro', 'empik']);
export const carrierType = pgEnum('carrier_type', ['inpost', 'allegro_shipping']);
export const orderStatus = pgEnum('order_status', [
  'new',
  'processing',
  'label_created',
  'shipped',
  'delivered',
  'on_hold',
  'cancelled',
]);
export const shipmentState = pgEnum('shipment_state', ['pending', 'created', 'failed', 'cancelled']);
export const labelFormat = pgEnum('label_format', ['pdf', 'zpl']);
export const labelSize = pgEnum('label_size', ['A4', 'A6']);

// ---------------------------------------------------------------- users

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('staff'),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  /** SHA-256 of the session token; the raw token only lives in the cookie. */
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- accounts

export interface MarketplaceSettings {
  /** Days of history to import on the first sync. */
  initialSyncDays?: number;
  /** Shopify: note-attribute keys that may hold a parcel locker code. */
  pickupPointKeys?: string[];
  /** Shopify: location whose inventory is kept in sync. */
  locationId?: string;
  /** Shopify: API version, e.g. "2026-07". */
  apiVersion?: string;
  /** Shopify: email the buyer when tracking is added. */
  notifyCustomer?: boolean;
  /** Empik: accept orders automatically when stock covers every line. */
  autoAccept?: boolean;
  /** Empik: carrier codes registered on the marketplace, keyed by our carrier. */
  carrierCodes?: Record<string, string>;
}

export const marketplaceAccounts = pgTable('marketplace_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: marketplaceType('type').notNull(),
  name: text('name').notNull(),
  /** AES-256-GCM encrypted JSON; see src/server/crypto.ts. */
  credentials: text('credentials'),
  settings: jsonb('settings').$type<MarketplaceSettings>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  syncCursor: text('sync_cursor'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  stockSyncEnabled: boolean('stock_sync_enabled').notNull().default(false),
  /** When true, stock pushes are only logged, never sent. */
  stockDryRun: boolean('stock_dry_run').notNull().default(true),
  createdAt: createdAt(),
});

export interface CarrierSettings {
  labelFormat?: 'pdf' | 'zpl';
  labelSize?: 'A4' | 'A6';
  /** InPost: "dispatch_order" (courier pickup) or "parcel_locker" (you drop parcels at a locker). */
  sendingMethod?: string;
  /** Allegro: bank account for cash on delivery payouts. */
  codIban?: string;
  codOwnerName?: string;
}

export const carrierAccounts = pgTable('carrier_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: carrierType('type').notNull(),
  name: text('name').notNull(),
  credentials: text('credentials'),
  /** Allegro Delivery reuses the OAuth tokens of an Allegro marketplace account. */
  marketplaceAccountId: uuid('marketplace_account_id').references(() => marketplaceAccounts.id, {
    onDelete: 'set null',
  }),
  sender: jsonb('sender').$type<SenderSettings>(),
  settings: jsonb('settings').$type<CarrierSettings>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- orders

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    marketplace: marketplaceType('marketplace').notNull(),
    externalId: text('external_id').notNull(),
    externalNumber: text('external_number').notNull(),
    marketplaceStatus: text('marketplace_status').notNull(),
    readyToShip: boolean('ready_to_ship').notNull().default(true),
    status: orderStatus('status').notNull().default('new'),
    buyer: jsonb('buyer').$type<Buyer>().notNull(),
    shippingAddress: jsonb('shipping_address').$type<Address>().notNull(),
    deliveryMethodId: text('delivery_method_id'),
    deliveryMethodName: text('delivery_method_name'),
    pickupPointId: text('pickup_point_id'),
    codAmount: numeric('cod_amount', { precision: 12, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    shippingAmount: numeric('shipping_amount', { precision: 12, scale: 2 }),
    currency: text('currency').notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    revision: text('revision'),
    /** Stock was decremented for this order (and must be returned if it is cancelled). */
    stockApplied: boolean('stock_applied').notNull().default(false),
    raw: jsonb('raw'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_account_external_idx').on(t.accountId, t.externalId),
    index('orders_status_idx').on(t.status),
    index('orders_placed_at_idx').on(t.placedAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    externalLineId: text('external_line_id').notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    externalProductId: text('external_product_id'),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), index('order_items_sku_idx').on(t.sku)],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** status | note | sync | label | tracking | stock | error */
    type: text('type').notNull(),
    message: text('message').notNull(),
    data: jsonb('data'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------- shipping

export const packagePresets = pgTable('package_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  lengthCm: integer('length_cm').notNull(),
  widthCm: integer('width_cm').notNull(),
  heightCm: integer('height_cm').notNull(),
  weightKg: numeric('weight_kg', { precision: 6, scale: 2 }).notNull(),
  inpostTemplate: text('inpost_template'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});

export interface RuleConditions {
  marketplaces?: ('shopify' | 'allegro' | 'empik')[];
  /** Case-insensitive substring of the buyer's delivery method name. */
  deliveryMethodContains?: string;
  hasPickupPoint?: boolean;
  cod?: boolean;
}

export const shippingRules = pgTable('shipping_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Lower number wins. */
  priority: integer('priority').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions').$type<RuleConditions>().notNull().default({}),
  carrierAccountId: uuid('carrier_account_id')
    .notNull()
    .references(() => carrierAccounts.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  packagePresetId: uuid('package_preset_id').references(() => packagePresets.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const shipmentBatches = pgTable('shipment_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  total: integer('total').notNull(),
  /** Orders that could not be queued, with the reason. */
  skipped: jsonb('skipped').$type<{ orderId: string; reason: string }[]>().notNull().default([]),
  createdAt: createdAt(),
});

export interface ShipmentOptions {
  codAmount?: string | null;
  insuranceAmount?: string | null;
  pickupPointId?: string | null;
  reference?: string | null;
}

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrierAccountId: uuid('carrier_account_id')
      .notNull()
      .references(() => carrierAccounts.id),
    carrier: carrierType('carrier').notNull(),
    service: text('service').notNull(),
    state: shipmentState('state').notNull().default('pending'),
    /** Carrier's shipment id (InPost shipment id, Allegro shipmentId). */
    externalId: text('external_id'),
    /** Allegro create-command id, kept so a retry polls instead of creating twice. */
    commandId: text('command_id'),
    carrierCode: text('carrier_code'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    parcel: jsonb('parcel').$type<ParcelSpec>().notNull(),
    options: jsonb('options').$type<ShipmentOptions>().notNull().default({}),
    labelFormat: labelFormat('label_format').notNull().default('pdf'),
    labelSize: labelSize('label_size').notNull().default('A6'),
    error: text('error'),
    pollAttempts: integer('poll_attempts').notNull().default(0),
    trackingPushedAt: timestamp('tracking_pushed_at', { withTimezone: true }),
    trackingPushError: text('tracking_push_error'),
    deliveryStatus: text('delivery_status'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    batchId: uuid('batch_id').references(() => shipmentBatches.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one live shipment per order: a double click can't buy two labels.
    uniqueIndex('shipments_one_active_per_order')
      .on(t.orderId)
      .where(sql`state in ('pending', 'created')`),
    index('shipments_batch_idx').on(t.batchId),
    index('shipments_state_idx').on(t.state),
  ],
);

export const labelFiles = pgTable('label_files', {
  shipmentId: uuid('shipment_id')
    .primaryKey()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  format: labelFormat('format').notNull(),
  size: labelSize('size').notNull(),
  content: bytea('content').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- inventory

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  /** Master stock; every marketplace listing is set to this number. */
  stock: integer('stock').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productListings = pgTable(
  'product_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    externalId: text('external_id').notNull(),
    sku: text('sku'),
    title: text('title').notNull(),
    ref: jsonb('ref').$type<Record<string, string | number | null>>().notNull().default({}),
    /** Quantity the marketplace reported at the last import. */
    lastSeenQty: integer('last_seen_qty'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastPushedQty: integer('last_pushed_qty'),
    lastPushedAt: timestamp('last_pushed_at', { withTimezone: true }),
    lastPushError: text('last_push_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_listings_account_external_idx').on(t.accountId, t.externalId),
    index('product_listings_product_idx').on(t.productId),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    /** order | cancel | manual | import */
    reason: text('reason').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_product_idx').on(t.productId, t.createdAt)],
);

export const stockSyncLog = pgTable(
  'stock_sync_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').references(() => productListings.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    dryRun: boolean('dry_run').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_sync_log_created_idx').on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type MarketplaceAccount = typeof marketplaceAccounts.$inferSelect;
export type CarrierAccount = typeof carrierAccounts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type Shipment = typeof shipments.$inferSelect;
export type ShippingRule = typeof shippingRules.$inferSelect;
export type PackagePreset = typeof packagePresets.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductListing = typeof productListings.$inferSelect;
