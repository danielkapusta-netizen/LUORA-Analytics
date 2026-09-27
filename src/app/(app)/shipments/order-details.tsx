import { MapPin, Truck } from 'lucide-react';
import { CustomerSummary, OrderItemsList, type SummaryItem } from '@/components/order-summary';
import { SERVICE_LABELS } from '@/lib/utils';
import type { Order, Shipment } from '@/server/db/schema';

/** Who the parcel is for, where it goes and what is in it, shown when a shipment row is expanded. */
export function ShipmentOrderDetails({
  order,
  shipment,
  carrierName,
  items,
}: {
  order: Order;
  shipment: Shipment;
  carrierName: string;
  items: SummaryItem[];
}) {
  const a = order.shippingAddress;
  const point = shipment.options.pickupPointId ?? order.pickupPointId;
  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,20rem)_1fr]">
      <div className="space-y-3">
        <CustomerSummary buyerName={order.buyer.name} recipientName={a.name} />
        <div className="flex gap-3 px-1">
          <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 text-sm">
            <p className="text-xs text-slate-400">{point ? 'Pickup point' : 'Ship to'}</p>
            {point && <p className="font-semibold">{point}</p>}
            <p className="text-slate-700">
              {a.street}, {a.postalCode} {a.city}
            </p>
          </div>
        </div>
        <div className="flex gap-3 px-1">
          <Truck className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 text-sm">
            <p className="text-xs text-slate-400">Carrier</p>
            <p>
              <span className="font-medium">{carrierName}</span>
              {shipment.service !== 'buyer_choice' && <span className="text-slate-500"> · {SERVICE_LABELS[shipment.service] ?? shipment.service}</span>}
            </p>
            {shipment.trackingNumber && <p className="font-mono text-xs text-slate-500">{shipment.trackingNumber}</p>}
            {order.deliveryMethodName && <p className="text-xs text-slate-400">Buyer chose: {order.deliveryMethodName}</p>}
          </div>
        </div>
      </div>
      {items.length ? <OrderItemsList items={items} highlightQuantity /> : <p className="text-sm text-slate-500">No items on this order.</p>}
    </div>
  );
}
