'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { products, stockMovements } from '@/server/db/schema';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { adjustStock, linkListing } from '@/server/services/inventory';
import { listMarketplaceAccounts } from '@/server/services/settings';

export async function adjustStockAction(productId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const mode = formData.get('mode') === 'add' ? 'add' : 'set';
  const value = Number(formData.get('value'));
  return attempt(async () => {
    if (!Number.isInteger(value)) throw new Error('Enter a whole number');
    await adjustStock({ productId, mode, value, userId: user.id, note: String(formData.get('note') ?? '') });
    revalidatePath('/inventory');
    return 'Stock updated; marketplaces will follow shortly';
  });
}

export async function createProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const sku = String(formData.get('sku') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const stock = Number(formData.get('stock') ?? 0);
  return attempt(async () => {
    if (!sku || !name) throw new Error('SKU and name are required');
    if (!Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a whole number ≥ 0');
    await getDb().transaction(async (tx) => {
      const [p] = await tx.insert(products).values({ sku, name, stock }).returning({ id: products.id });
      if (stock) await tx.insert(stockMovements).values({ productId: p.id, delta: stock, reason: 'manual', userId: user.id, note: 'Created' });
    });
    revalidatePath('/inventory');
    return `Product ${sku} created`;
  });
}

export async function linkListingAction(listingId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await linkListing(listingId, String(formData.get('productId') ?? '') || null);
    revalidatePath('/inventory');
    return 'Listing linked';
  });
}

export async function importListingsAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled);
    for (const a of accounts) await enqueue(JOBS.listingsImport, { accountId: a.id }, { singletonKey: a.id });
    return `Importing listings from ${accounts.length} account(s). Refresh in a moment.`;
  });
}

export async function pushStockNowAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled && a.stockSyncEnabled);
    for (const a of accounts) await enqueue(JOBS.stockPush, { accountId: a.id });
    return accounts.length ? `Stock push queued for ${accounts.length} account(s)` : 'Stock sync is off for every account (see Settings → Integrations)';
  });
}
