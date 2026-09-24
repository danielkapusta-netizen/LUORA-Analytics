import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { randomToken } from '@/server/crypto';
import { env } from '@/server/env';
import { ALLEGRO_REDIRECT_PATH, allegroAuthorizeUrl, type AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { loadMarketplaceAccount, readCredentials } from '@/server/services/accounts';

/** Sends the user to Allegro to authorise this app for the given account. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (user?.role !== 'admin') return new Response('Only admins can connect accounts', { status: 403 });
  const accountId = new URL(request.url).searchParams.get('accountId');
  if (!accountId) return new Response('accountId is required', { status: 400 });
  const account = await loadMarketplaceAccount(accountId);
  const creds = readCredentials<AllegroCredentials>(account.credentials);
  if (account.type !== 'allegro' || !creds?.clientId) {
    return new Response('Save the Allegro Client ID and Client Secret first', { status: 400 });
  }
  const state = randomToken(16);
  (await cookies()).set('allegro_oauth', JSON.stringify({ state, accountId }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return NextResponse.redirect(allegroAuthorizeUrl(creds, `${env().APP_URL}${ALLEGRO_REDIRECT_PATH}`, state));
}
