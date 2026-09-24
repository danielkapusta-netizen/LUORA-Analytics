'use client';

import { Printer, Tag, Truck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MarketplaceBadge, ShipmentBadge, StatusBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { buttonClass, EmptyState, Select, td, th } from '@/components/ui';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import type { OrderStatus } from '@/server/db/schema';
import { bulkAssignAction, bulkCreateLabelsAction, bulkStatusAction } from './actions';

export interface OrderRow {
  id: string;
  number: string;
  marketplace: string;
  accountName: string;
  placedAt: string;
  buyer: string;
  city: string;
  itemCount: number;
  total: string;
  currency: string;
  cod: boolean;
  delivery: string | null;
  pickupPoint: string | null;
  status: OrderStatus;
  readyToShip: boolean;
  marketplaceStatus: string;
  assignee: string | null;
  tags: string[];
  shipment: { id: string; state: string; trackingNumber: string | null; carrier: string; hasLabel: boolean } | null;
}

export function OrdersTable({
  rows,
  users,
  statuses,
}: {
  rows: OrderRow[];
  users: { id: string; name: string }[];
  statuses: { value: string; label: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const ids = [...selected].join(',');
  const labelIds = useMemo(
    () => rows.filter((r) => selected.has(r.id) && r.shipment?.hasLabel).map((r) => r.shipment!.id),
    [rows, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) return <EmptyState title="No orders match these filters">New orders appear here after the next sync.</EmptyState>;

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-brand-100 bg-brand-50 px-4 py-2">
          <span className="text-sm font-medium text-brand-700">{selected.size} selected</span>
          <ActionForm action={bulkCreateLabelsAction} showOk={false}>
            <input type="hidden" name="ids" value={ids} />
            <SubmitButton size="sm" pendingText="Queuing labels…">
              <Truck className="size-3.5" /> Create labels
            </SubmitButton>
          </ActionForm>
          {labelIds.length > 0 && (
            <a className={buttonClass('secondary', 'sm')} href={`/api/labels/merged?shipments=${labelIds.join(',')}`} target="_blank" rel="noreferrer">
              <Printer className="size-3.5" /> Print {labelIds.length} label(s)
            </a>
          )}
          <ActionForm action={bulkStatusAction} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={ids} />
            <Select name="status" className="h-8 w-40 text-xs" defaultValue="">
              <option value="" disabled>
                Set status…
              </option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary">
              Apply
            </SubmitButton>
          </ActionForm>
          <ActionForm action={bulkAssignAction} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={ids} />
            <Select name="assigneeId" className="h-8 w-36 text-xs" defaultValue="">
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary">
              Assign
            </SubmitButton>
          </ActionForm>
          <button className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50">
            <tr>
              <th className={cn(th, 'w-8')}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  className="size-4 rounded border-slate-300"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th className={th}>Order</th>
              <th className={th}>Placed</th>
              <th className={th}>Buyer</th>
              <th className={cn(th, 'text-right')}>Total</th>
              <th className={th}>Delivery</th>
              <th className={th}>Status</th>
              <th className={th}>Label</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={cn('hover:bg-slate-50', selected.has(r.id) && 'bg-brand-50/50')}>
                <td className={td}>
                  <input
                    type="checkbox"
                    aria-label={`Select order ${r.number}`}
                    className="size-4 rounded border-slate-300"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td className={td}>
                  <Link href={`/orders/${r.id}`} className="font-medium text-brand-700 hover:underline">
                    {r.number}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <MarketplaceBadge marketplace={r.marketplace} />
                    <span className="text-xs text-slate-500">{r.accountName}</span>
                  </div>
                </td>
                <td className={cn(td, 'whitespace-nowrap text-slate-600')}>{formatDate(r.placedAt)}</td>
                <td className={td}>
                  <div>{r.buyer}</div>
                  <div className="text-xs text-slate-500">
                    {r.city} · {r.itemCount} item(s)
                  </div>
                </td>
                <td className={cn(td, 'whitespace-nowrap text-right tabular-nums')}>
                  {formatMoney(r.total, r.currency)}
                  {r.cod && <div className="text-xs font-medium text-orange-700">COD</div>}
                </td>
                <td className={td}>
                  <div className="max-w-48 truncate" title={r.delivery ?? ''}>
                    {r.delivery ?? '—'}
                  </div>
                  {r.pickupPoint && <div className="text-xs font-medium text-slate-600">Point {r.pickupPoint}</div>}
                </td>
                <td className={td}>
                  <StatusBadge status={r.status} />
                  {!r.readyToShip && r.status !== 'cancelled' && (
                    <div className="mt-1 text-xs text-amber-700" title={r.marketplaceStatus}>
                      Not ready: {r.marketplaceStatus}
                    </div>
                  )}
                  {r.assignee && <div className="mt-1 text-xs text-slate-500">{r.assignee}</div>}
                  {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-0.5 text-xs text-slate-500">
                          <Tag className="size-3" />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={td}>
                  {r.shipment ? (
                    <div>
                      <ShipmentBadge state={r.shipment.state} />
                      {r.shipment.trackingNumber && <div className="mt-1 font-mono text-xs text-slate-600">{r.shipment.trackingNumber}</div>}
                      {r.shipment.hasLabel && (
                        <a href={`/api/labels/${r.shipment.id}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                          Print label
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
