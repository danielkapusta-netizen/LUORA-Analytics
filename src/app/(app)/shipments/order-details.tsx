import { CustomerSummary, OrderItemsList, type SummaryItem } from '@/components/order-summary';
import type { Order } from '@/server/db/schema';

/** What is in the parcel and who it is for, shown when a shipment row is expanded. */
export function ShipmentOrderDetails({ order, items }: { order: Order; items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,18rem)_1fr]">
      <CustomerSummary buyerName={order.buyer.name} recipientName={order.shippingAddress.name} className="self-start" />
      {items.length ? <OrderItemsList items={items} /> : <p className="text-sm text-slate-500">No items on this order.</p>}
    </div>
  );
}
