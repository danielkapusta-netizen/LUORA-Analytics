import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { ExpandableRow } from '@/components/expandable-row';
import { MarketplaceBadge, ShipmentBadge } from '@/components/badges';
import { Card, CardHeader, EmptyState, PageHeader, td, th } from '@/components/ui';
import { cn, CARRIER_LABELS, formatDate, SERVICE_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { itemsByOrder } from '@/server/services/orders';
import { recentBatches, recentShipments } from '@/server/services/shipping';
import { ShipmentOrderDetails } from './order-details';
import { ActionForm, SubmitButton } from '@/components/forms';
import { retryFailedTrackingAction } from './actions';

export const metadata: Metadata = { title: 'Shipments' };

const STATES = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Being created' },
  { value: 'created', label: 'Label ready' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await requireUser();
  const { state = '' } = await searchParams;
  const [rows, batches] = await Promise.all([recentShipments({ state: state || undefined }), recentBatches(10)]);
  const items = await itemsByOrder(rows.map((r) => r.order.id));

  return (
    <>
      <AutoRefresh active={rows.some((r) => r.shipment.state === 'pending')} />
      <PageHeader
        title="Shipments"
        description="Labels bought through InPost and Allegro Delivery. To create labels in bulk, select orders on the Orders page."
        actions={
          rows.some((r) => r.shipment.trackingPushError && !r.shipment.trackingPushedAt) && (
            <ActionForm action={retryFailedTrackingAction}>
              <SubmitButton variant="secondary">Retry failed tracking</SubmitButton>
            </ActionForm>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Recent labels"
            actions={STATES.map((s) => (
              <Link
                key={s.value}
                href={s.value ? `/shipments?state=${s.value}` : '/shipments'}
                className={cn('rounded-md px-2 py-1 text-xs font-medium', state === s.value ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}
              >
                {s.label}
              </Link>
            ))}
          />
          {rows.length === 0 ? (
            <EmptyState title="No labels yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-10" />
                    <th className={th}>Order</th>
                    <th className={th}>Carrier</th>
                    <th className={th}>Tracking</th>
                    <th className={th}>State</th>
                    <th className={th}>Marketplace</th>
                    <th className={th}>Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ shipment: s, order, carrierName }) => (
                    <ExpandableRow
                      key={s.id}
                      colSpan={7}
                      className="hover:bg-slate-50"
                      details={<ShipmentOrderDetails order={order} items={items.get(order.id) ?? []} />}
                    >
                      <td className={td}>
                        <Link href={`/orders/${order.id}`} className="font-medium text-brand-700 hover:underline">
                          {order.externalNumber}
                        </Link>
                        <div className="mt-0.5">
                          <MarketplaceBadge marketplace={order.marketplace} />
                        </div>
                      </td>
                      <td className={td}>
                        {carrierName}
                        <div className="text-xs text-slate-500">
                          {CARRIER_LABELS[s.carrier]} · {SERVICE_LABELS[s.service] ?? s.service}
                        </div>
                      </td>
                      <td className={cn(td, 'font-mono text-xs')}>
                        {s.trackingNumber ?? '—'}
                        {s.state === 'created' && (
                          <div>
                            <a href={`/api/labels/${s.id}`} target="_blank" rel="noreferrer" className="font-sans text-brand-700 hover:underline">
                              Print label
                            </a>
                          </div>
                        )}
                      </td>
                      <td className={td}>
                        <ShipmentBadge state={s.state} />
                        {s.error && <div className="mt-1 max-w-64 text-xs text-red-700">{s.error}</div>}
                      </td>
                      <td className={cn(td, 'text-xs')}>
                        {s.trackingPushedAt ? (
                          <span className="text-emerald-700">Tracking sent</span>
                        ) : s.trackingPushError ? (
                          <span className="text-red-700">Not sent: {s.trackingPushError}</span>
                        ) : s.state === 'created' ? (
                          <span className="text-slate-500">Sending…</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={cn(td, 'whitespace-nowrap text-slate-600')}>{formatDate(s.createdAt)}</td>
                    </ExpandableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Bulk batches" />
          {batches.length === 0 ? (
            <EmptyState title="No batches yet">Select orders and press “Create labels”.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/shipments/batches/${b.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                    <p className="text-sm font-medium text-brand-700">{b.total} order(s)</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(b.createdAt)}
                      {b.skipped.length ? ` · ${b.skipped.length} skipped` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
