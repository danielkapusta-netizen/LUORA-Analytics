import type { Metadata } from 'next';
import { AutoRefresh } from '@/components/auto-refresh';
import { MarketplaceBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, Select, td, th } from '@/components/ui';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { listProductsWithListings, marketplaceQuantity, recentStockLog, unmatchedListings } from '@/server/services/inventory';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { adjustStockAction, createProductAction, importListingsAction, linkListingAction, pushStockNowAction } from './actions';

export const metadata: Metadata = { title: 'Inventory' };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q } = await searchParams;
  const [{ products, listings }, accounts, unmatched, log] = await Promise.all([
    listProductsWithListings(),
    listMarketplaceAccounts(),
    unmatchedListings(),
    recentStockLog(30),
  ]);
  const needle = q?.toLowerCase().trim();
  const shown = needle ? products.filter((p) => p.sku.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)) : products;
  const byProduct = new Map<string, typeof listings>();
  for (const l of listings) {
    if (!l.productId) continue;
    byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
  }
  const syncAccounts = accounts.filter((a) => a.enabled);
  const pendingPush = listings.some((l) => {
    const p = products.find((x) => x.id === l.productId);
    const acct = accounts.find((a) => a.id === l.accountId);
    return p && acct?.stockSyncEnabled && !acct.stockDryRun && l.lastPushedQty !== Math.max(0, p.stock);
  });

  return (
    <>
      <AutoRefresh active={pendingPush} seconds={10} />
      <PageHeader
        title="Inventory"
        description="The stock here is the master. Every sale lowers it and the new number is sent to every marketplace listing with the same SKU."
        actions={
          <>
            <ActionForm action={importListingsAction}>
              <SubmitButton variant="secondary">Import listings</SubmitButton>
            </ActionForm>
            <ActionForm action={pushStockNowAction}>
              <SubmitButton>Push stock now</SubmitButton>
            </ActionForm>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {syncAccounts.map((a) => (
          <Card key={a.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{a.name}</span>
              <MarketplaceBadge marketplace={a.type} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {a.stockSyncEnabled ? <Badge tone="green">Stock sync on</Badge> : <Badge>Stock sync off</Badge>}
              {a.stockSyncEnabled && a.stockDryRun && <Badge tone="amber">Dry run: nothing is sent</Badge>}
            </div>
            <p className="mt-2 text-xs text-slate-500">{listings.filter((l) => l.accountId === a.id).length} listing(s)</p>
          </Card>
        ))}
      </div>

      <Card className="mb-5">
        <CardHeader
          title={`Products (${products.length})`}
          actions={
            <form className="flex gap-2" action="/inventory">
              <Input name="q" defaultValue={q} placeholder="Search SKU or name" className="h-8 w-56" />
            </form>
          }
        />
        {shown.length === 0 ? (
          <EmptyState title="No products yet">Use “Import listings” to create products from your marketplace listings, or add one below.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>SKU</th>
                  <th className={th}>Product</th>
                  <th className={cn(th, 'text-right')}>Stock</th>
                  <th className={th}>Quantity on each marketplace</th>
                  <th className={th}>Adjust</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td className={cn(td, 'whitespace-nowrap font-mono text-xs')}>{p.sku}</td>
                    <td className={td}>{p.name}</td>
                    <td className={cn(td, 'text-right text-base font-semibold tabular-nums', p.stock <= 0 && 'text-red-700', p.stock > 0 && p.stock < 5 && 'text-amber-700')}>
                      {p.stock}
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1.5">
                        {(byProduct.get(p.id) ?? []).map((l) => {
                          const account = accounts.find((a) => a.id === l.accountId);
                          const shownQty = marketplaceQuantity(l);
                          const drift = shownQty !== null && shownQty !== Math.max(0, p.stock);
                          return (
                            <span
                              key={l.id}
                              title={`${l.title} · read ${l.lastSeenQty ?? '?'}${l.lastSeenAt ? ` on ${formatDate(l.lastSeenAt)}` : ''}${l.lastPushedAt ? ` · sent ${l.lastPushedQty} on ${formatDate(l.lastPushedAt)}` : ''}${l.lastPushError ? ` · error: ${l.lastPushError}` : ''}`}
                              className={cn(
                                'rounded border px-1.5 py-0.5 text-xs',
                                l.lastPushError ? 'border-red-200 bg-red-50 text-red-700' : drift ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600',
                              )}
                            >
                              {account?.name ?? '?'}: {shownQty ?? '?'}
                            </span>
                          );
                        })}
                        {!byProduct.get(p.id)?.length && <span className="text-xs text-slate-400">not listed</span>}
                      </div>
                    </td>
                    <td className={td}>
                      <ActionForm action={adjustStockAction.bind(null, p.id)} className="flex items-center gap-1.5" showOk={false}>
                        <Select name="mode" className="h-8 w-24 text-xs" defaultValue="set">
                          <option value="set">Set</option>
                          <option value="add">+ / −</option>
                        </Select>
                        <Input name="value" inputMode="numeric" className="h-8 w-20" required placeholder={String(p.stock)} />
                        <SubmitButton size="sm" variant="secondary">
                          Save
                        </SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CardBody className="border-t border-slate-100">
          <ActionForm action={createProductAction} resetOnSuccess className="flex flex-wrap items-end gap-2">
            <Input name="sku" placeholder="SKU" className="w-40" required />
            <Input name="name" placeholder="Product name" className="w-72" required />
            <Input name="stock" placeholder="Stock" inputMode="numeric" className="w-24" defaultValue="0" />
            <SubmitButton variant="secondary">Add product</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title={`Listings without a product (${unmatched.length})`} description="Listings with no SKU, or a SKU that is linked to nothing. Link them to sync their stock." />
          {unmatched.length === 0 ? (
            <EmptyState title="Every listing is linked" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {unmatched.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{l.title}</p>
                    <p className="text-xs text-slate-500">
                      {accounts.find((a) => a.id === l.accountId)?.name} · {l.sku ?? 'no SKU'} · qty {l.lastSeenQty ?? '?'}
                    </p>
                  </div>
                  <ActionForm action={linkListingAction.bind(null, l.id)} className="flex gap-1.5" showOk={false}>
                    <Select name="productId" className="h-8 w-52 text-xs" defaultValue="">
                      <option value="">Choose product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} – {p.name}
                        </option>
                      ))}
                    </Select>
                    <SubmitButton size="sm" variant="secondary">
                      Link
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent stock pushes" />
          {log.length === 0 ? (
            <EmptyState title="Nothing sent yet" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {log.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span className="min-w-0 truncate">
                    {e.accountName}: {e.title ?? 'listing'} → <strong>{e.quantity}</strong>
                    {e.error && <span className="ml-1 text-red-700">({e.error})</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {e.dryRun ? <Badge tone="amber">dry run</Badge> : e.ok ? <Badge tone="green">sent</Badge> : <Badge tone="red">failed</Badge>}
                    <span className="text-xs text-slate-400">{timeAgo(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
