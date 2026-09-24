import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { orders, type OrderStatus } from '../db/schema';
import { enqueue, JOBS } from '../jobs/queue';
import { logEvent } from './events';
import { applyOrderStock, restockOrder, scheduleStockPush } from './inventory';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  processing: 'Processing',
  label_created: 'Label created',
  shipped: 'Shipped',
  delivered: 'Delivered',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

/** Which statuses an order may move to from each status. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['processing', 'label_created', 'shipped', 'on_hold', 'cancelled'],
  processing: ['new', 'label_created', 'shipped', 'on_hold', 'cancelled'],
  label_created: ['processing', 'shipped', 'on_hold', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  on_hold: ['new', 'processing', 'cancelled'],
  cancelled: ['new'],
};

/** Statuses staff can pick by hand; the rest are set by labels, tracking and sync. */
export const MANUAL_TARGETS: OrderStatus[] = ['new', 'processing', 'on_hold', 'shipped', 'cancelled'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {}

/**
 * Moves an order to a new status and runs the side effects:
 * cancelling returns stock, reopening takes it again, and "processing" tells Allegro.
 */
export async function changeStatus(
  db: Tx,
  orderId: string,
  to: OrderStatus,
  options: { userId?: string | null; reason?: string; force?: boolean } = {},
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) throw new TransitionError('Order not found');
  if (order.status === to) return;
  if (!options.force && !canTransition(order.status, to)) {
    throw new TransitionError(`Can't move an order from "${STATUS_LABELS[order.status]}" to "${STATUS_LABELS[to]}"`);
  }

  await db
    .update(orders)
    .set({ status: to, ...(to === 'shipped' && !order.shippedAt ? { shippedAt: new Date() } : {}) })
    .where(eq(orders.id, orderId));
  await logEvent(db, orderId, 'status', `${STATUS_LABELS[order.status]} → ${STATUS_LABELS[to]}${options.reason ? ` (${options.reason})` : ''}`, {
    userId: options.userId,
    data: { from: order.status, to },
  });

  if (to === 'cancelled' && order.stockApplied) {
    if (await restockOrder(db, orderId)) await scheduleStockPush();
  }
  if (order.status === 'cancelled' && !order.stockApplied) {
    if (await applyOrderStock(db, orderId)) await scheduleStockPush();
  }
  if (to === 'processing' && order.marketplace === 'allegro') {
    await enqueue(JOBS.marketplaceProcessing, { orderId });
  }
}
