import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { encryptJson } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { marketplaceAccounts } from '@/server/db/schema';
import { env } from '@/server/env';
import { ALLEGRO_REDIRECT_PATH, exchangeAllegroCode, type AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { loadMarketplaceAccount, readCredentials } from '@/server/services/accounts';

export async function GET(request: Request) {
  const back = (message: string) =>
    NextResponse.redirect(`${env().APP_URL}/settings/integrations?message=${encodeURIComponent(message)}`);
  if ((await currentUser())?.role !== 'admin') return new Response('Only admins can connect accounts', { status: 403 });

  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get('allegro_oauth')?.value;
  jar.delete('allegro_oauth');
  const { state, accountId } = saved ? (JSON.parse(saved) as { state: string; accountId: string }) : { state: '', accountId: '' };
  if (!state || state !== url.searchParams.get('state')) return back('Allegro login expired or was tampered with. Try again.');
  if (url.searchParams.get('error')) return back(`Allegro refused access: ${url.searchParams.get('error')}`);
  const code = url.searchParams.get('code');
  if (!code) return back('Allegro did not return an authorisation code');

  const account = await loadMarketplaceAccount(accountId);
  const creds = readCredentials<AllegroCredentials>(account.credentials);
  if (!creds) return back('The Allegro account has no client credentials');
  try {
    const next = await exchangeAllegroCode(creds, code, `${env().APP_URL}${ALLEGRO_REDIRECT_PATH}`);
    await getDb()
      .update(marketplaceAccounts)
      .set({ credentials: encryptJson(next), lastError: null })
      .where(eq(marketplaceAccounts.id, accountId));
  } catch (err) {
    return back(`Could not connect Allegro: ${err instanceof Error ? err.message : err}`);
  }
  return back(`${account.name} connected`);
}
