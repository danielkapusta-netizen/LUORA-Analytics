import { ArrowLeft, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { MarketplaceBadge, ShipmentBadge } from '@/components/badges';
import { Alert, buttonClass, Card, CardHeader, PageHeader, td, th } from '@/components/ui';
import { cn, formatDate, SERVICE_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { getBatch } from '@/server/services/shipping';

export const metadata: Metadata = { title: 'Label batch' };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const data = await getBatch(id);
  if (!data) notFound();
  const { batch, rows, skipped } = data;
  const done = rows.filter((r) => r.shipment.state === 'created').length;
  const failed = rows.filter((r) => r.shipment.state === 'failed').length;
  const pending = rows.filter((r) => r.shipment.state === 'pending').length;
  const percent = rows.length ? Math.round(((done + failed) / rows.length) * 100) : 100;

  return (
    <>
      <AutoRefresh active={pending > 0} seconds={2} />
      <Link href="/shipments" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Shipments
      </Link>
      <PageHeader
        title={`Label batch · ${batch.total} order(s)`}
        description={`Started ${formatDate(batch.createdAt)}`}
        actions={
          done > 0 && (
            <a className={buttonClass('primary')} href={`/api/labels/merged?batch=${batch.id}`} target="_blank" rel="noreferrer">
              <Printer className="size-4" /> Print {done} label(s)
            </a>
          )
        }
      />

      <Card className="mb-5 px-4 py-3">
        <div className="mb-2 flex flex-wrap gap-4 text-sm">
          <span className="text-emerald-700">{done} ready</span>
          <span className="text-amber-700">{pending} in progress</span>
          <span className="text-red-700">{failed} failed</span>
          <span className="text-slate-500">{skipped.length} skipped</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </Card>

      {skipped.length > 0 && (
        <div className="mb-5">
          <Alert>
            <p className="mb-1 font-medium">Not queued:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {skipped.map((s) => (
                <li key={s.orderId}>
                  {s.order ? (
                    <Link href={`/orders/${s.orderId}`} className="underline">
                      {s.order.externalNumber}
                    </Link>
                  ) : (
                    s.orderId
                  )}
                  : {s.reason}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader title="Labels" />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Recipient</th>
                <th className={th}>Carrier</th>
                <th className={th}>State</th>
                <th className={th}>Tracking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ shipment: s, order, carrierName }) => (
                <tr key={s.id}>
                  <td className={td}>
                    <Link href={`/orders/${order.id}`} className="font-medium text-brand-700 hover:underline">
                      {order.externalNumber}
                    </Link>
                    <div className="mt-0.5">
                      <MarketplaceBadge marketplace={order.marketplace} />
                    </div>
                  </td>
                  <td className={td}>
                    {order.shippingAddress.name}
                    <div className="text-xs text-slate-500">
                      {order.shippingAddress.city}
                      {order.pickupPointId ? ` · ${order.pickupPointId}` : ''}
                    </div>
                  </td>
                  <td className={td}>
                    {carrierName}
                    <div className="text-xs text-slate-500">{SERVICE_LABELS[s.service] ?? s.service}</div>
                  </td>
                  <td className={td}>
                    <ShipmentBadge state={s.state} />
                    {s.error && <div className="mt-1 max-w-72 text-xs text-red-700">{s.error}</div>}
                  </td>
                  <td className={cn(td, 'font-mono text-xs')}>
                    {s.trackingNumber ?? '—'}
                    {s.state === 'created' && (
                      <div>
                        <a href={`/api/labels/${s.id}`} target="_blank" rel="noreferrer" className="font-sans text-brand-700 hover:underline">
                          Print
                        </a>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
