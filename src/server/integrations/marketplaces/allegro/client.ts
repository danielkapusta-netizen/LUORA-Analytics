import { HttpError, request, type RequestOptions } from '../../../http';
import type { CredentialsStore } from '../../types';

export interface AllegroCredentials {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
  accessToken?: string;
  refreshToken?: string;
  /** ISO date */
  expiresAt?: string;
}

const MEDIA_TYPE = 'application/vnd.allegro.public.v1+json';

/** Register exactly this path (prefixed with APP_URL) as the redirect URI of the Allegro app. */
export const ALLEGRO_REDIRECT_PATH = '/api/oauth/allegro/callback';

export function allegroHosts(sandbox?: boolean) {
  return sandbox
    ? { api: 'https://api.allegro.pl.allegrosandbox.pl', auth: 'https://allegro.pl.allegrosandbox.pl' }
    : { api: 'https://api.allegro.pl', auth: 'https://allegro.pl' };
}

export function allegroAuthorizeUrl(creds: Pick<AllegroCredentials, 'clientId' | 'sandbox'>, redirectUri: string, state: string) {
  const url = new URL(`${allegroHosts(creds.sandbox).auth}/auth/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(creds: AllegroCredentials, params: Record<string, string>): Promise<AllegroCredentials> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const { data } = await request<TokenResponse>(`${allegroHosts(creds.sandbox).auth}/auth/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  return {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

/** Exchanges the code from the OAuth callback for tokens. */
export function exchangeAllegroCode(creds: AllegroCredentials, code: string, redirectUri: string) {
  return tokenRequest(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export class AllegroClient {
  constructor(private readonly creds: CredentialsStore<AllegroCredentials>) {}

  get apiBase(): string {
    return allegroHosts(this.creds.get().sandbox).api;
  }

  /** Access tokens live 12 hours; refresh tokens rotate on every refresh. */
  async accessToken(forceRefresh = false): Promise<string> {
    const c = this.creds.get();
    if (!c.accessToken || !c.refreshToken) throw new Error('Allegro account is not connected. Use "Connect Allegro" in Settings.');
    const expiresAt = c.expiresAt ? Date.parse(c.expiresAt) : 0;
    if (!forceRefresh && expiresAt - Date.now() > 10 * 60_000) return c.accessToken;
    const next = await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: c.refreshToken });
    await this.creds.save(next);
    return next.accessToken!;
  }

  async call<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    let refreshed = false;
    for (;;) {
      const token = await this.accessToken();
      try {
        const { data } = await request<T>(`${this.apiBase}${path}`, {
          ...options,
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: MEDIA_TYPE,
            ...(options.body !== undefined ? { 'Content-Type': MEDIA_TYPE } : {}),
            ...options.headers,
          },
        });
        return data;
      } catch (err) {
        if (err instanceof HttpError && err.status === 401 && !refreshed) {
          refreshed = true;
          await this.accessToken(true);
          continue;
        }
        throw err;
      }
    }
  }

  /** Like `call` but also returns response headers (for Retry-After on async commands). */
  async callWithHeaders<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}) {
    const token = await this.accessToken();
    return request<T>(`${this.apiBase}${path}`, {
      ...options,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: MEDIA_TYPE,
        ...(options.body !== undefined ? { 'Content-Type': MEDIA_TYPE } : {}),
        ...options.headers,
      },
    });
  }
}
