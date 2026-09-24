import type { Listing, Marketplace, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../types';

export interface SyncResult {
  orders: NormalizedOrder[];
  /** Saved after the orders are stored, and passed to the next call. */
  nextCursor: string | null;
  /** More orders are waiting; the caller should sync again right away. */
  hasMore: boolean;
}

export interface MarketplaceAdapter {
  readonly marketplace: Marketplace;

  /** Returns a short description of the connected account, e.g. the shop name. */
  checkConnection(): Promise<string>;

  /** Fetches orders created or changed since `cursor` (null on the first sync). */
  syncOrders(cursor: string | null): Promise<SyncResult>;

  /** Re-reads one order, e.g. after accepting it. */
  getOrder(externalId: string): Promise<NormalizedOrder | null>;

  /** Adds the tracking number to the order and marks it as shipped. Must be safe to call twice. */
  pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void>;

  /** Tells the marketplace the order is being prepared (Allegro "PROCESSING"). */
  markProcessing?(order: OrderRef): Promise<void>;

  /** Accepts an order that waits for the seller's decision (Empik). */
  acceptOrder?(order: OrderRef): Promise<void>;

  listListings(): AsyncIterable<Listing>;

  /** Sets absolute stock quantities. */
  setStock(updates: StockUpdate[]): Promise<void>;
}
