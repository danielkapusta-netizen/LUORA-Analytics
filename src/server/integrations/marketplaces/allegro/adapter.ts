import type { MarketplaceSettings } from '../../../db/schema';
import type { CredentialsStore, Listing, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../../types';
import type { MarketplaceAdapter, SyncResult } from '../types';
import { AllegroClient, type AllegroCredentials } from './client';
import { mapAllegroCheckoutForm } from './mapper';

interface OrderEvent {
  id: string;
  type: string;
  order: { checkoutForm: { id: string } };
}

const RELEVANT_EVENTS = new Set([
  'READY_FOR_PROCESSING',
  'BUYER_CANCELLED',
  'AUTO_CANCELLED',
  'FULFILLMENT_STATUS_CHANGED',
  'BUYER_MODIFIED',
]);
const IMPORTABLE_STATUSES = new Set(['READY_FOR_PROCESSING', 'CANCELLED']);
const EVENTS_LIMIT = 1000;
/** Cursor used when the account has no order events yet. */
const NO_EVENTS = 'none';

export class AllegroAdapter implements MarketplaceAdapter {
  readonly marketplace = 'allegro' as const;
  readonly client: AllegroClient;

  constructor(
    creds: CredentialsStore<AllegroCredentials>,
    private readonly settings: MarketplaceSettings = {},
  ) {
    this.client = new AllegroClient(creds);
  }

  async checkConnection(): Promise<string> {
    const me = await this.client.call<{ login: string; email?: string }>('GET', '/me');
    return `Allegro: ${me.login}`;
  }

  /**
   * First sync: imports paid, unshipped orders from the last N days, then remembers the
   * newest event id. Later syncs read the order event journal from that id.
   */
  async syncOrders(cursor: string | null): Promise<SyncResult> {
    if (cursor === null) return this.initialImport();

    const { events } = await this.client.call<{ events: OrderEvent[] }>('GET', '/order/events', {
      query: { from: cursor === NO_EVENTS ? undefined : cursor, limit: EVENTS_LIMIT },
    });
    const ids = [...new Set(events.filter((e) => RELEVANT_EVENTS.has(e.type)).map((e) => e.order.checkoutForm.id))];
    const orders: NormalizedOrder[] = [];
    for (const id of ids) {
      const form = await this.client.call<{ status: string }>('GET', `/order/checkout-forms/${id}`);
      if (IMPORTABLE_STATUSES.has(form.status)) orders.push(mapAllegroCheckoutForm(form));
    }
    return {
      orders,
      nextCursor: events.at(-1)?.id ?? cursor,
      hasMore: events.length === EVENTS_LIMIT,
    };
  }

  private async initialImport(): Promise<SyncResult> {
    const since = new Date(Date.now() - (this.settings.initialSyncDays ?? 14) * 86_400_000).toISOString();
    // Read the journal position first so events that arrive during the import are not missed.
    const stats = await this.client.call<{ latestEvent?: { id: string } | null }>('GET', '/order/event-stats');
    const orders: NormalizedOrder[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.client.call<{ checkoutForms: unknown[]; totalCount: number }>('GET', '/order/checkout-forms', {
        query: {
          status: 'READY_FOR_PROCESSING',
          'fulfillment.status': ['NEW', 'PROCESSING'],
          'lineItems.boughtAt.gte': since,
          limit: 100,
          offset,
        },
      });
      orders.push(...page.checkoutForms.map(mapAllegroCheckoutForm));
      if (page.checkoutForms.length < 100 || offset + 100 >= page.totalCount) break;
    }
    return { orders, nextCursor: stats.latestEvent?.id ?? NO_EVENTS, hasMore: false };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    const form = await this.client.call<unknown>('GET', `/order/checkout-forms/${externalId}`);
    return form ? mapAllegroCheckoutForm(form) : null;
  }

  async markProcessing(order: OrderRef): Promise<void> {
    await this.client.call('PUT', `/order/checkout-forms/${order.externalId}/fulfillment`, {
      body: { status: 'PROCESSING' },
      responseType: 'none',
    });
  }

  async pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void> {
    const path = `/order/checkout-forms/${order.externalId}/shipments`;
    const existing = await this.client.call<{ shipments: { waybill: string }[] }>('GET', path);
    // Labels bought through "Wysyłam z Allegro" are attached to the order automatically.
    if (!existing.shipments.some((s) => s.waybill === tracking.trackingNumber)) {
      const carrierId = tracking.carrierCode ?? (tracking.carrier === 'inpost' ? 'INPOST' : 'ALLEGRO');
      await this.client.call('POST', path, {
        body: {
          carrierId,
          waybill: tracking.trackingNumber,
          ...(carrierId === 'OTHER' ? { carrierName: tracking.carrierName } : {}),
          lineItems: order.items.map((i) => ({ id: i.externalLineId })),
        },
      });
    }
    await this.client.call('PUT', `/order/checkout-forms/${order.externalId}/fulfillment`, {
      body: { status: 'SENT' },
      responseType: 'none',
    });
  }

  async *listListings(): AsyncIterable<Listing> {
    for (let offset = 0; ; offset += 1000) {
      const page = await this.client.call<{
        offers: { id: string; name: string; external?: { id?: string | null } | null; stock?: { available?: number } | null }[];
        totalCount: number;
      }>('GET', '/sale/offers', { query: { limit: 1000, offset } });
      for (const offer of page.offers) {
        yield {
          externalId: offer.id,
          sku: offer.external?.id || null,
          title: offer.name,
          quantity: offer.stock?.available ?? null,
          ref: { offerId: offer.id },
        };
      }
      if (page.offers.length < 1000 || offset + 1000 >= page.totalCount) return;
    }
  }

  async setStock(updates: StockUpdate[]): Promise<void> {
    for (const u of updates) {
      await this.client.call('PATCH', `/sale/product-offers/${u.externalId}`, {
        body: { stock: { available: u.quantity } },
        responseType: 'none',
      });
    }
  }
}
