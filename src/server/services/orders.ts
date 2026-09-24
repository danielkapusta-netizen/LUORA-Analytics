import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { getDb, type Tx } from '../db/client';
import {
  marketplaceAccounts,
  orderEvents,
  orderItems,
  orders,
  products,
  shipments,
  users,
  type MarketplaceAccount,
  type Order,
  type OrderStatus,
} from '../db/schema';
import type { MarketplaceAdapter } from '../integrations/marketplaces/types';
import type { Address, NormalizedOrder, OrderRef } from '../integrations/types';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { logEvent } from './events';
import { applyOrderStock, scheduleStockPush, stockCoversOrder } from './inventory';
import { changeStatus } from './workflow';

const MAX_ROUNDS_PER_SYNC = 20;

export interface SyncSummary {
  created: number;
  updated: number;
}

/** Pulls new and changed orders for one marketplace account. */
export async function syncAccount(accountId: string): Promise<SyncSummary> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  if (!account.enabled) return { created: 0, updated: 0 };

  const summary: SyncSummary = { created: 0, updated: 0 };
  try {
    const adapter = getMarketplaceAdapter(account);
    let cursor = account.syncCursor;
    for (let round = 0; round < MAX_ROUNDS_PER_SYNC; round++) {
      const result = await adapter.syncOrders(cursor);
      const stored = await upsertOrders(account, result.orders);
      summary.created += stored.created;
      summary.updated += stored.updated;
      // Only move the cursor once the orders are safely stored.
      cursor = result.nextCursor;
      await db.update(marketplaceAccounts).set({ syncCursor: cursor }).where(eq(marketplaceAccounts.id, account.id));
      if (stored.newOrderIds.length && account.settings.autoAccept && adapter.acceptOrder) {
        await autoAccept(account, adapter, stored.newOrderIds);
      }
      if (!result.hasMore) break;
    }
    await db
      .update(marketplaceAccounts)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(marketplaceAccounts.id, account.id));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(marketplaceAccounts).set({ lastError: message }).where(eq(marketplaceAccounts.id, account.id));
    throw err;
  }
}

function initialStatus(n: NormalizedOrder): OrderStatus {
  if (n.cancelled) return 'cancelled';
  if (n.fulfilled) return 'shipped';
  return 'new';
}

/** Statuses in which the buyer's data may still be refreshed from the marketplace. */
const EDITABLE: OrderStatus[] = ['new', 'processing', 'on_hold'];

export async function upsertOrders(
  account: Pick<MarketplaceAccount, 'id' | 'type' | 'name'>,
  incoming: NormalizedOrder[],
): Promise<SyncSummary & { newOrderIds: string[] }> {
  const db = getDb();
  const newOrderIds: string[] = [];
  let updated = 0;
  let stockChanged = false;

  for (const n of incoming) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.accountId, account.id), eq(orders.externalId, n.externalId)))
        .for('update');

      if (!existing) {
        const [created] = await tx
          .insert(orders)
          .values({
            accountId: account.id,
            marketplace: account.type,
            externalId: n.externalId,
            externalNumber: n.externalNumber,
            marketplaceStatus: n.marketplaceStatus,
            readyToShip: n.readyToShip,
            status: initialStatus(n),
            buyer: n.buyer,
            shippingAddress: n.shippingAddress,
            deliveryMethodId: n.deliveryMethodId ?? null,
            deliveryMethodName: n.deliveryMethodName ?? null,
            pickupPointId: n.pickupPointId ?? null,
            codAmount: n.codAmount ?? null,
            totalAmount: n.totalAmount,
            shippingAmount: n.shippingAmount ?? null,
            currency: n.currency,
            placedAt: n.placedAt,
            paidAt: n.paidAt ?? null,
            shippedAt: n.fulfilled ? new Date() : null,
            revision: n.revision ?? null,
            raw: n.raw as object,
          })
          .returning({ id: orders.id });
        await insertItems(tx, created.id, n);
        await logEvent(tx, created.id, 'sync', `Imported from ${account.name}`);
        if (!n.cancelled && !n.fulfilled) stockChanged = (await applyOrderStock(tx, created.id)) || stockChanged;
        newOrderIds.push(created.id);
        return;
      }

      updated++;
      await tx
        .update(orders)
        .set({
          marketplaceStatus: n.marketplaceStatus,
          readyToShip: n.readyToShip,
          revision: n.revision ?? null,
          paidAt: n.paidAt ?? existing.paidAt,
          raw: n.raw as object,
          ...(EDITABLE.includes(existing.status)
            ? {
                buyer: n.buyer,
                shippingAddress: n.shippingAddress,
                deliveryMethodId: n.deliveryMethodId ?? null,
                deliveryMethodName: n.deliveryMethodName ?? null,
                // Keep a locker code staff typed in by hand.
                pickupPointId: existing.pickupPointId ?? n.pickupPointId ?? null,
                codAmount: n.codAmount ?? null,
                totalAmount: n.totalAmount,
              }
            : {}),
        })
        .where(eq(orders.id, existing.id));

      if (n.marketplaceStatus !== existing.marketplaceStatus) {
        await logEvent(tx, existing.id, 'sync', `Marketplace status: ${existing.marketplaceStatus} → ${n.marketplaceStatus}`);
      }
      if (n.cancelled && !['cancelled', 'shipped', 'delivered'].includes(existing.status)) {
        await changeStatus(tx, existing.id, 'cancelled', { reason: 'cancelled on the marketplace', force: true });
      } else if (n.fulfilled && ['new', 'processing', 'label_created', 'on_hold'].includes(existing.status)) {
        await changeStatus(tx, existing.id, 'shipped', { reason: 'shipped on the marketplace', force: true });
      }
    });
  }

  if (stockChanged) await scheduleStockPush();
  return { created: newOrderIds.length, updated, newOrderIds };
}

async function insertItems(tx: Tx, orderId: string, n: NormalizedOrder): Promise<void> {
  if (n.items.length === 0) return;
  const skus = [...new Set(n.items.map((i) => i.sku).filter((s): s is string => Boolean(s)))];
  const known = skus.length
    ? await tx.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.sku, skus))
    : [];
  const bySku = new Map(known.map((p) => [p.sku, p.id]));
  await tx.insert(orderItems).values(
    n.items.map((i) => ({
      orderId,
      externalLineId: i.externalLineId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      externalProductId: i.externalProductId ?? null,
      productId: i.sku ? (bySku.get(i.sku) ?? null) : null,
    })),
  );
}

/** Empik: accept new orders that wait for the seller when stock covers them. */
async function autoAccept(account: MarketplaceAccount, adapter: MarketplaceAdapter, orderIds: string[]): Promise<void> {
  const db = getDb();
  const waiting = await db
    .select()
    .from(orders)
    .where(and(inArray(orders.id, orderIds), eq(orders.marketplaceStatus, 'WAITING_ACCEPTANCE')));
  for (const order of waiting) {
    if (!(await stockCoversOrder(db, order.id))) {
      await logEvent(db, order.id, 'sync', 'Not accepted automatically: not enough stock');
      continue;
    }
    await acceptOrder(order.id, null, { account, adapter });
  }
}

export async function acceptOrder(
  orderId: string,
  userId: string | null,
  ctx?: { account: MarketplaceAccount; adapter: MarketplaceAdapter },
): Promise<void> {
  const db = getDb();
  const order = await loadOrder(orderId);
  const account = ctx?.account ?? (await loadMarketplaceAccount(order.accountId));
  const adapter = ctx?.adapter ?? getMarketplaceAdapter(account);
  if (!adapter.acceptOrder) throw new Error(`${account.name} does not need orders to be accepted`);
  await adapter.acceptOrder(await orderRef(order.id));
  await logEvent(db, order.id, 'sync', userId ? 'Accepted on the marketplace' : 'Accepted automatically', { userId });
  const fresh = await adapter.getOrder(order.externalId);
  if (fresh) await upsertOrders(account, [fresh]);
}

/** Re-reads one order from its marketplace. */
export async function refreshOrder(orderId: string): Promise<void> {
  const order = await loadOrder(orderId);
  const account = await loadMarketplaceAccount(order.accountId);
  const fresh = await getMarketplaceAdapter(account).getOrder(order.externalId);
  if (!fresh) throw new Error('The marketplace no longer returns this order');
  await upsertOrders(account, [fresh]);
}

export async function loadOrder(orderId: string): Promise<Order> {
  const [order] = await getDb().select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error('Order not found');
  return order;
}

export async function orderRef(orderId: string): Promise<OrderRef> {
  const order = await loadOrder(orderId);
  const items = await getDb()
    .select({ externalLineId: orderItems.externalLineId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return { externalId: order.externalId, externalNumber: order.externalNumber, raw: order.raw, items };
}

// ---------------------------------------------------------------- queries

export interface OrderFilters {
  q?: string;
  status?: OrderStatus | 'open';
  marketplace?: string;
  accountId?: string;
  assigneeId?: string;
  tag?: string;
  carrier?: string;
  from?: string;
  to?: string;
  page?: number;
}

export const PAGE_SIZE = 50;
const OPEN: OrderStatus[] = ['new', 'processing', 'label_created', 'on_hold'];

function filterConditions(f: OrderFilters): SQL[] {
  const where: SQL[] = [];
  if (f.status === 'open') where.push(inArray(orders.status, OPEN));
  else if (f.status) where.push(eq(orders.status, f.status));
  if (f.marketplace) where.push(sql`${orders.marketplace} = ${f.marketplace}`);
  if (f.accountId) where.push(eq(orders.accountId, f.accountId));
  if (f.assigneeId) where.push(eq(orders.assigneeId, f.assigneeId));
  if (f.tag) where.push(sql`${f.tag} = any(${orders.tags})`);
  if (f.from) where.push(gte(orders.placedAt, new Date(f.from)));
  if (f.to) where.push(lte(orders.placedAt, new Date(`${f.to}T23:59:59`)));
  if (f.carrier) {
    where.push(
      sql`exists (select 1 from ${shipments} s where s.order_id = ${orders.id} and s.carrier = ${f.carrier} and s.state <> 'cancelled')`,
    );
  }
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    where.push(
      or(
        ilike(orders.externalNumber, like),
        ilike(orders.externalId, like),
        sql`${orders.buyer}->>'name' ilike ${like}`,
        sql`${orders.buyer}->>'email' ilike ${like}`,
        sql`exists (select 1 from ${shipments} s where s.order_id = ${orders.id} and s.tracking_number ilike ${like})`,
        sql`exists (select 1 from ${orderItems} i where i.order_id = ${orders.id} and (i.sku ilike ${like} or i.name ilike ${like}))`,
      )!,
    );
  }
  return where;
}

export async function listOrders(f: OrderFilters) {
  const db = getDb();
  const where = and(...filterConditions(f));
  const page = Math.max(1, f.page ?? 1);

  const rows = await db
    .select({
      order: orders,
      accountName: marketplaceAccounts.name,
      assigneeName: users.name,
      itemCount: sql<number>`(select coalesce(sum(quantity), 0)::int from ${orderItems} i where i.order_id = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, orders.accountId))
    .leftJoin(users, eq(users.id, orders.assigneeId))
    .where(where)
    .orderBy(desc(orders.placedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);

  const ids = rows.map((r) => r.order.id);
  const live = ids.length
    ? await db
        .select()
        .from(shipments)
        .where(and(inArray(shipments.orderId, ids), ne(shipments.state, 'cancelled')))
        .orderBy(desc(shipments.createdAt))
    : [];
  const latest = new Map<string, (typeof live)[number]>();
  for (const s of live) if (!latest.has(s.orderId)) latest.set(s.orderId, s);

  return { rows: rows.map((r) => ({ ...r, shipment: latest.get(r.order.id) ?? null })), total: count, page, pageSize: PAGE_SIZE };
}

export async function statusCounts(): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders)
    .groupBy(orders.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

export async function getOrderDetail(orderId: string) {
  const db = getDb();
  const [row] = await db
    .select({ order: orders, account: marketplaceAccounts })
    .from(orders)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, orders.accountId))
    .where(eq(orders.id, orderId));
  if (!row) return null;
  const [items, events, orderShipments] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.externalLineId)),
    db
      .select({ event: orderEvents, userName: users.name })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.userId))
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(desc(orderEvents.createdAt)),
    db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.createdAt)),
  ]);
  return { ...row, items, events, shipments: orderShipments };
}

// ---------------------------------------------------------------- edits

export async function addNote(orderId: string, userId: string, text: string): Promise<void> {
  const note = text.trim();
  if (!note) return;
  await logEvent(getDb(), orderId, 'note', note, { userId });
}

export async function assignOrder(orderIds: string[], assigneeId: string | null, userId: string): Promise<void> {
  const db = getDb();
  await db.update(orders).set({ assigneeId }).where(inArray(orders.id, orderIds));
  const [assignee] = assigneeId ? await db.select({ name: users.name }).from(users).where(eq(users.id, assigneeId)) : [];
  for (const id of orderIds) {
    await logEvent(db, id, 'edit', assignee ? `Assigned to ${assignee.name}` : 'Unassigned', { userId });
  }
}

export async function setTags(orderId: string, tags: string[], userId: string): Promise<void> {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  await getDb().update(orders).set({ tags: clean }).where(eq(orders.id, orderId));
  await logEvent(getDb(), orderId, 'edit', clean.length ? `Tags: ${clean.join(', ')}` : 'Tags cleared', { userId });
}

export async function updateShippingDetails(
  orderId: string,
  input: { address: Address; pickupPointId: string | null },
  userId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(orders)
    .set({ shippingAddress: input.address, pickupPointId: input.pickupPointId || null })
    .where(eq(orders.id, orderId));
  await logEvent(db, orderId, 'edit', 'Shipping address or pickup point edited', { userId });
}

export async function listTags(): Promise<string[]> {
  const rows = await getDb().execute<{ tag: string }>(sql`select distinct unnest(tags) as tag from orders order by 1`);
  return rows.map((r) => r.tag);
}
