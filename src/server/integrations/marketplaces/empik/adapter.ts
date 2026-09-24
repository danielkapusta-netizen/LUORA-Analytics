import type { MarketplaceSettings } from '../../../db/schema';
import type { Listing, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../../types';
import type { MarketplaceAdapter, SyncResult } from '../types';
import { MiraklClient, type EmpikCredentials } from './client';
import { mapMiraklOrder } from './mapper';

const PAGE = 100;
const MAX_PAGES_PER_SYNC = 10;
const ALREADY_SHIPPED = new Set(['SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED']);

interface OrdersPage {
  orders: { order_id: string; order_state: string; last_updated_date: string }[];
  total_count: number;
}

/** Builds the STO01 stock import CSV: one line per offer, global (not per-warehouse) quantity. */
export function buildStockCsv(updates: StockUpdate[]): string {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['"offer-sku";"quantity";"warehouse-code";"update-delete"'];
  for (const u of updates) {
    const sku = String(u.ref.shopSku ?? u.sku ?? '');
    if (!sku) continue;
    lines.push([quote(sku), quote(String(Math.max(0, u.quantity))), '""', '"update"'].join(';'));
  }
  return `${lines.join('\n')}\n`;
}

export class EmpikAdapter implements MarketplaceAdapter {
  readonly marketplace = 'empik' as const;
  private readonly client: MiraklClient;

  constructor(
    creds: EmpikCredentials,
    private readonly settings: MarketplaceSettings = {},
  ) {
    this.client = new MiraklClient(creds);
  }

  async checkConnection(): Promise<string> {
    const shop = await this.client.call<{ shop_name?: string; shop_id?: number }>('GET', '/account');
    return `Empik: ${shop.shop_name ?? shop.shop_id ?? 'connected'}`;
  }

  /** OR11. Cursor = newest `last_updated_date` already stored. */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    const since = cursor ?? new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString();
    const orders: NormalizedOrder[] = [];
    let newest = since;
    let hasMore = false;

    for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
      const offset = page * PAGE;
      const data = await this.client.call<OrdersPage>('GET', '/orders', {
        query: { start_update_date: since, max: PAGE, offset, paginate: true },
      });
      for (const raw of data.orders) {
        if (raw.last_updated_date > newest) newest = raw.last_updated_date;
        // STAGING orders are still in Empik's fraud check and may never reach the seller.
        if (raw.order_state === 'STAGING') continue;
        orders.push(mapMiraklOrder(raw));
      }
      hasMore = offset + data.orders.length < data.total_count;
      if (!hasMore || data.orders.length === 0) break;
    }
    return { orders, nextCursor: newest, hasMore };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const data = await this.client.call<OrdersPage>('GET', '/orders', { query: { order_ids: externalId } });
    return data.orders[0] ? mapMiraklOrder(data.orders[0]) : null;
  }

  /** OR21: accept every line of an order waiting for acceptance. */
  async acceptOrder(order: OrderRef): Promise<void> {
    await this.client.call('PUT', `/orders/${encodeURIComponent(order.externalId)}/accept`, {
      body: { order_lines: order.items.map((i) => ({ accepted: true, id: i.externalLineId })) },
      responseType: 'none',
    });
  }

  /** OR23 tracking, then OR24 to confirm shipment. */
  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    const id = encodeURIComponent(order.externalId);
    const current = await this.client.call<OrdersPage>('GET', '/orders', { query: { order_ids: order.externalId } });
    if (ALREADY_SHIPPED.has(current.orders[0]?.order_state ?? '')) return;

    const carrierCode = this.settings.carrierCodes?.[tracking.carrier];
    await this.client.call('PUT', `/orders/${id}/tracking`, {
      body: carrierCode
        ? { carrier_code: carrierCode, tracking_number: tracking.trackingNumber }
        : { carrier_name: tracking.carrierName, carrier_url: tracking.trackingUrl ?? undefined, tracking_number: tracking.trackingNumber },
      responseType: 'none',
    });
    await this.client.call('PUT', `/orders/${id}/ship`, { responseType: 'none' });
  }

  /** OF21 */
  async *listListings(): AsyncIterable<Listing> {
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.client.call<{
        offers: { offer_id: number; shop_sku: string; product_title: string; quantity: number; active?: boolean }[];
        total_count: number;
      }>('GET', '/offers', { query: { max: PAGE, offset } });
      for (const offer of page.offers) {
        yield {
          externalId: String(offer.offer_id),
          sku: offer.shop_sku || null,
          title: offer.product_title,
          quantity: offer.quantity,
          ref: { shopSku: offer.shop_sku },
        };
      }
      if (page.offers.length < PAGE || offset + PAGE >= page.total_count) return;
    }
  }

  /**
   * STO01 stock import. OF24 is not used on purpose: it resets every offer field that
   * is not sent, which would wipe prices and descriptions.
   */
  async setStock(updates: StockUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const form = new FormData();
    form.append('file', new Blob([buildStockCsv(updates)], { type: 'text/csv' }), 'stock.csv');
    await this.client.call('POST', '/offers/stock/imports', { body: form });
  }
}
