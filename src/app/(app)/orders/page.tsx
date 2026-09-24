import { RefreshCw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SubmitButton } from '@/components/forms';
import { Alert, buttonClass, Card, Input, PageHeader, Select } from '@/components/ui';
import { cn, MARKETPLACE_LABELS, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { OrderStatus } from '@/server/db/schema';
import { listOrders, listTags, statusCounts, type OrderFilters } from '@/server/services/orders';
import { listMarketplaceAccounts, listUsers } from '@/server/services/settings';
import { STATUS_LABELS } from '@/server/services/workflow';
import { syncNowAction } from './actions';
import { OrdersTable, type OrderRow } from './orders-table';

export const metadata: Metadata = { title: 'Orders' };

const TABS: { value: OrderStatus | 'open' | 'all'; label: string }[] = [
  { value: 'open', label: 'To do' },
  { value: 'new', label: 'New' },
  { value: 'processing', label: 'Processing' },
  { value: 'label_created', label: 'Label created' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

type Search = Record<string, string | undefined>;

function hrefWith(params: Search, patch: Search): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/orders?${qs}` : '/orders';
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const params = await searchParams;
  const status = params.status ?? 'open';
  const filters: OrderFilters = {
    q: params.q,
    status: status === 'all' ? undefined : (status as OrderFilters['status']),
    marketplace: params.marketplace,
    accountId: params.account,
    assigneeId: params.assignee,
    tag: params.tag,
    carrier: params.carrier,
    from: params.from,
    to: params.to,
    page: Number(params.page ?? 1) || 1,
  };

  const [{ rows, total, page, pageSize }, counts, accounts, users, tags] = await Promise.all([
    listOrders(filters),
    statusCounts(),
    listMarketplaceAccounts(),
    listUsers(),
    listTags(),
  ]);
  const openCount = (counts.new ?? 0) + (counts.processing ?? 0) + (counts.label_created ?? 0) + (counts.on_hold ?? 0);
  const errors = accounts.filter((a) => a.enabled && a.lastError);
  const lastSync = accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().at(-1);

  const tableRows: OrderRow[] = rows.map(({ order, accountName, assigneeName, itemCount, shipment }) => ({
    id: order.id,
    number: order.externalNumber,
    marketplace: order.marketplace,
    accountName,
    placedAt: order.placedAt.toISOString(),
    buyer: order.buyer.name,
    city: order.shippingAddress.city,
    itemCount,
    total: order.totalAmount,
    currency: order.currency,
    cod: Boolean(order.codAmount && Number(order.codAmount) > 0),
    delivery: order.deliveryMethodName,
    pickupPoint: order.pickupPointId,
    status: order.status,
    readyToShip: order.readyToShip,
    marketplaceStatus: order.marketplaceStatus,
    assignee: assigneeName,
    tags: order.tags,
    shipment: shipment
      ? { id: shipment.id, state: shipment.state, trackingNumber: shipment.trackingNumber, carrier: shipment.carrier, hasLabel: shipment.state === 'created' }
      : null,
  }));

  return (
    <>
      <PageHeader
        title="Orders"
        description={`All marketplaces in one list. Last sync ${timeAgo(lastSync)}.`}
        actions={
          <form action={syncNowAction}>
            <SubmitButton variant="secondary" pendingText="Syncing…">
              <RefreshCw className="size-4" /> Sync now
            </SubmitButton>
          </form>
        }
      />

      {errors.length > 0 && (
        <div className="mb-4 space-y-2">
          {errors.map((a) => (
            <Alert key={a.id} tone="red">
              <strong>{a.name}:</strong> last sync failed – {a.lastError}{' '}
              <Link href="/settings/integrations" className="underline">
                Check settings
              </Link>
            </Alert>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const count = tab.value === 'open' ? openCount : tab.value !== 'all' ? counts[tab.value] : undefined;
          const active = status === tab.value;
          return (
            <Link
              key={tab.label}
              href={hrefWith(params, { status: tab.value === 'open' ? undefined : tab.value, page: undefined })}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {tab.label}
              {count ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{count}</span> : null}
            </Link>
          );
        })}
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/orders">
        {params.status && <input type="hidden" name="status" value={params.status} />}
        <Input name="q" defaultValue={params.q} placeholder="Number, buyer, SKU, tracking…" className="w-full sm:w-64" />
        <Select name="marketplace" defaultValue={params.marketplace ?? ''} className="w-auto">
          <option value="">All marketplaces</option>
          {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select name="account" defaultValue={params.account ?? ''} className="w-auto">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select name="assignee" defaultValue={params.assignee ?? ''} className="w-auto">
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select name="tag" defaultValue={params.tag ?? ''} className="w-auto">
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={params.from} aria-label="Placed from" className="w-auto" />
        <Input type="date" name="to" defaultValue={params.to} aria-label="Placed until" className="w-auto" />
        <button className={buttonClass('primary')}>Filter</button>
        {(params.q || params.marketplace || params.account || params.assignee || params.tag || params.from || params.to) && (
          <Link href={hrefWith({ status: params.status }, {})} className="text-sm text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <Card>
        <OrdersTable rows={tableRows} users={users.map((u) => ({ id: u.id, name: u.name }))} statuses={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm text-slate-500">
          <span>
            {total === 0 ? 'No orders' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page - 1) })}>
                Previous
              </Link>
            )}
            {page * pageSize < total && (
              <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page + 1) })}>
                Next
              </Link>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
