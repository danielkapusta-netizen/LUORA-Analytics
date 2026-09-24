import type { ShopifyCredentials } from '@/server/integrations/marketplaces/shopify/client';
import { validShopifyHmac } from '@/server/integrations/marketplaces/shopify/webhook';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { loadMarketplaceAccount, readCredentials } from '@/server/services/accounts';

/**
 * orders/create and orders/updated webhooks. The payload is not parsed: the webhook
 * just triggers a sync, so there is one code path for reading orders.
 */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const body = await request.text();
  let account;
  try {
    account = await loadMarketplaceAccount(accountId);
  } catch {
    return new Response('Unknown account', { status: 404 });
  }
  const secret = readCredentials<ShopifyCredentials>(account.credentials)?.clientSecret;
  if (account.type !== 'shopify' || !secret || !validShopifyHmac(body, request.headers.get('x-shopify-hmac-sha256'), secret)) {
    return new Response('Invalid signature', { status: 401 });
  }
  await enqueue(JOBS.syncAccount, { accountId }, { singletonKey: accountId });
  return new Response('ok');
}
