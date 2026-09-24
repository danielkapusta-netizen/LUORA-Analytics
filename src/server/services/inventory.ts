import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { getDb, type Tx } from '../db/client';
import {
  marketplaceAccounts,
  orderItems,
  orders,
  productListings,
  products,
  stockMovements,
  stockSyncLog,
} from '../db/schema';
import type { StockUpdate } from '../integrations/types';
import { enqueue, JOBS } from '../jobs/queue';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { logEvent } from './events';

/** Seconds to wait so a burst of orders becomes one stock push per account. */
const PUSH_DEBOUNCE_SECONDS = 30;

/** Takes stock for every matched line of an order. Returns true if any stock changed. */
export async function applyOrderStock(db: Tx, orderId: string): Promise<boolean> {
  // One row per product, in id order: parallel syncs then lock products in the
  // same order and can't deadlock each other.
  const lines = await db
    .select({ productId: orderItems.productId, quantity: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.productId)))
    .groupBy(orderItems.productId)
    .orderBy(asc(orderItems.productId));
  for (const line of lines) {
    await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${line.quantity}` })
      .where(eq(products.id, line.productId!));
    await db.insert(stockMovements).values({ productId: line.productId!, delta: -line.quantity, reason: 'order', orderId });
  }
  await db.update(orders).set({ stockApplied: true }).where(eq(orders.id, orderId));
  if (lines.length) await logEvent(db, orderId, 'stock', `Stock taken for ${lines.length} product(s)`);
  return lines.length > 0;
}

/** Returns the stock an order took (on cancellation). Returns true if any stock changed. */
export async function restockOrder(db: Tx, orderId: string): Promise<boolean> {
  const taken = await db
    .select({ productId: stockMovements.productId, delta: sql<number>`sum(${stockMovements.delta})::int` })
    .from(stockMovements)
    .where(eq(stockMovements.orderId, orderId))
    .groupBy(stockMovements.productId)
    .orderBy(asc(stockMovements.productId));
  let changed = false;
  for (const row of taken) {
    if (row.delta === 0) continue;
    await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${row.delta}` })
      .where(eq(products.id, row.productId));
    await db.insert(stockMovements).values({ productId: row.productId, delta: -row.delta, reason: 'cancel', orderId });
    changed = true;
  }
  await db.update(orders).set({ stockApplied: false }).where(eq(orders.id, orderId));
  if (changed) await logEvent(db, orderId, 'stock', 'Stock returned');
  return changed;
}

export async function adjustStock(input: {
  productId: string;
  mode: 'set' | 'add';
  value: number;
  userId: string;
  note?: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).for('update');
    if (!product) throw new Error('Product not found');
    const delta = input.mode === 'set' ? input.value - product.stock : input.value;
    if (delta === 0) return;
    await tx.update(products).set({ stock: product.stock + delta }).where(eq(products.id, product.id));
    await tx.insert(stockMovements).values({
      productId: product.id,
      delta,
      reason: 'manual',
      userId: input.userId,
      note: input.note || null,
    });
  });
  await scheduleStockPush();
}

/** Queues a (debounced) stock push for every account with stock sync switched on. */
export async function scheduleStockPush(): Promise<void> {
  const accounts = await getDb()
    .select({ id: marketplaceAccounts.id })
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.enabled, true), eq(marketplaceAccounts.stockSyncEnabled, true)));
  for (const account of accounts) {
    await enqueue(JOBS.stockPush, { accountId: account.id }, { debounceSeconds: PUSH_DEBOUNCE_SECONDS, singletonKey: account.id });
  }
}

/**
 * Reads every listing from the marketplace and links it to a product by SKU.
 * A SKU seen for the first time becomes a product whose stock starts at the listing's quantity.
 */
export async function importListings(accountId: string): Promise<{ listings: number; created: number; unmatched: number }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const adapter = getMarketplaceAdapter(account);
  let count = 0;
  let created = 0;
  let unmatched = 0;

  for await (const listing of adapter.listListings()) {
    count++;
    await db.transaction(async (tx) => {
      let productId: string | null = null;
      if (listing.sku) {
        const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.sku, listing.sku));
        if (product) productId = product.id;
        else {
          const [inserted] = await tx
            .insert(products)
            .values({ sku: listing.sku, name: listing.title, stock: Math.max(0, listing.quantity ?? 0) })
            .returning({ id: products.id });
          productId = inserted.id;
          created++;
          await tx.insert(stockMovements).values({ productId, delta: Math.max(0, listing.quantity ?? 0), reason: 'import' });
        }
      } else unmatched++;

      await tx
        .insert(productListings)
        .values({
          accountId,
          externalId: listing.externalId,
          sku: listing.sku,
          title: listing.title,
          ref: listing.ref,
          productId,
          lastSeenQty: listing.quantity,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [productListings.accountId, productListings.externalId],
          set: {
            sku: listing.sku,
            title: listing.title,
            ref: listing.ref,
            lastSeenQty: listing.quantity,
            lastSeenAt: new Date(),
            // Keep a manual link; only fill in a missing one.
            productId: sql`coalesce(${productListings.productId}, ${productId})`,
          },
        });
    });
  }

  // Link order lines that arrived before their product existed.
  await db.execute(sql`
    update order_items oi set product_id = p.id
    from products p
    where oi.product_id is null and oi.sku is not null and oi.sku = p.sku`);
  return { listings: count, created, unmatched };
}

export async function linkListing(listingId: string, productId: string | null): Promise<void> {
  await getDb().update(productListings).set({ productId }).where(eq(productListings.id, listingId));
  await scheduleStockPush();
}

/** Listings whose marketplace quantity differs from the master stock. */
export function pendingUpdatesFor(
  rows: { listingId: string; externalId: string; sku: string | null; ref: Record<string, string | number | null>; stock: number; lastPushedQty: number | null }[],
): (StockUpdate & { listingId: string })[] {
  return rows
    .filter((r) => r.lastPushedQty !== Math.max(0, r.stock))
    .map((r) => ({ listingId: r.listingId, externalId: r.externalId, sku: r.sku, ref: r.ref, quantity: Math.max(0, r.stock) }));
}

/** Sends master stock to one marketplace account (or only logs it in dry-run mode). */
export async function runStockPush(accountId: string): Promise<{ pushed: number; dryRun: boolean }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  if (!account.stockSyncEnabled || !account.enabled) return { pushed: 0, dryRun: account.stockDryRun };

  const rows = await db
    .select({
      listingId: productListings.id,
      externalId: productListings.externalId,
      sku: productListings.sku,
      ref: productListings.ref,
      stock: products.stock,
      lastPushedQty: productListings.lastPushedQty,
    })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    .where(eq(productListings.accountId, accountId))
    .orderBy(asc(productListings.id));
  const updates = pendingUpdatesFor(rows);
  if (updates.length === 0) return { pushed: 0, dryRun: account.stockDryRun };

  if (account.stockDryRun) {
    // Nothing is sent, so the same difference would be logged on every push; only log changes.
    const lastLogged = await db.execute<{ listing_id: string; quantity: number }>(sql`
      select distinct on (listing_id) listing_id, quantity from stock_sync_log
      where account_id = ${accountId} and dry_run order by listing_id, created_at desc`);
    const previous = new Map([...lastLogged].map((r) => [r.listing_id, r.quantity]));
    const fresh = updates.filter((u) => previous.get(u.listingId) !== u.quantity);
    if (fresh.length) {
      await db.insert(stockSyncLog).values(fresh.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: true, ok: true })));
    }
    return { pushed: fresh.length, dryRun: true };
  }

  try {
    await getMarketplaceAdapter(account).setStock(updates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(productListings)
      .set({ lastPushError: message })
      .where(inArray(productListings.id, updates.map((u) => u.listingId)));
    await db.insert(stockSyncLog).values(
      updates.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: false, ok: false, error: message })),
    );
    throw err;
  }

  const now = new Date();
  for (const u of updates) {
    await db
      .update(productListings)
      .set({ lastPushedQty: u.quantity, lastPushedAt: now, lastPushError: null })
      .where(eq(productListings.id, u.listingId));
  }
  await db.insert(stockSyncLog).values(
    updates.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: false, ok: true })),
  );
  return { pushed: updates.length, dryRun: false };
}

/** Nightly: re-reads listing quantities so the inventory page can show drift. */
export async function runReconcile(): Promise<void> {
  const accounts = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.enabled, true), eq(marketplaceAccounts.stockSyncEnabled, true)));
  for (const account of accounts) {
    try {
      await importListings(account.id);
    } catch (err) {
      console.error(`[reconcile] ${account.name}:`, err);
    }
  }
}

/** Does master stock cover every matched line of the order? Unmatched lines count as covered. */
export async function stockCoversOrder(db: Tx, orderId: string): Promise<boolean> {
  const rows = await db
    .select({ stock: products.stock })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId));
  // Stock was already taken when the order was imported, so it only has to stay non-negative.
  return rows.every((r) => r.stock >= 0);
}

export async function listProductsWithListings() {
  const db = getDb();
  const productRows = await db.select().from(products).orderBy(asc(products.sku));
  const listingRows = await db
    .select({
      id: productListings.id,
      productId: productListings.productId,
      accountId: productListings.accountId,
      externalId: productListings.externalId,
      sku: productListings.sku,
      title: productListings.title,
      lastSeenQty: productListings.lastSeenQty,
      lastSeenAt: productListings.lastSeenAt,
      lastPushedQty: productListings.lastPushedQty,
      lastPushedAt: productListings.lastPushedAt,
      lastPushError: productListings.lastPushError,
    })
    .from(productListings)
    .orderBy(asc(productListings.title));
  return { products: productRows, listings: listingRows };
}

/** What the marketplace most likely shows now: our last push, unless an import read it later. */
export function marketplaceQuantity(l: { lastSeenQty: number | null; lastSeenAt: Date | null; lastPushedQty: number | null; lastPushedAt: Date | null }): number | null {
  if (l.lastPushedAt && l.lastPushedQty !== null && (!l.lastSeenAt || l.lastPushedAt >= l.lastSeenAt)) return l.lastPushedQty;
  return l.lastSeenQty;
}

export async function unmatchedListings() {
  return getDb()
    .select()
    .from(productListings)
    .where(or(isNull(productListings.productId), isNull(productListings.sku)))
    .orderBy(asc(productListings.title));
}

export async function recentStockLog(limit = 50) {
  return getDb()
    .select({
      id: stockSyncLog.id,
      accountName: marketplaceAccounts.name,
      title: productListings.title,
      quantity: stockSyncLog.quantity,
      dryRun: stockSyncLog.dryRun,
      ok: stockSyncLog.ok,
      error: stockSyncLog.error,
      createdAt: stockSyncLog.createdAt,
    })
    .from(stockSyncLog)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, stockSyncLog.accountId))
    .leftJoin(productListings, eq(productListings.id, stockSyncLog.listingId))
    .orderBy(sql`${stockSyncLog.createdAt} desc`)
    .limit(limit);
}
