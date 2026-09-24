// Small fetch wrapper shared by every integration client: query strings,
// timeouts, retries with exponential backoff, and Retry-After on 429/503.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}${new URL(url).pathname}: ${summarise(body)}`);
    this.name = 'HttpError';
  }
}

function summarise(body: string): string {
  const trimmed = body.replace(/\s+/g, ' ').trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed || '(empty body)';
}

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  /** Objects are sent as JSON unless a string, Buffer or FormData is given. */
  body?: unknown;
  responseType?: 'json' | 'text' | 'buffer' | 'none';
  /** Extra attempts after the first one for retryable failures. */
  retries?: number;
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

export const httpConfig = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  maxRetryAfterMs: 30_000,
};

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export function buildUrl(base: string, query?: Record<string, QueryValue>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
  const { method = 'GET', query, responseType = 'json', retries = 3, timeoutMs = 30_000 } = options;
  const target = buildUrl(url, query);
  const headers: Record<string, string> = { ...options.headers };

  let body: BodyInit | undefined;
  if (options.body === undefined) body = undefined;
  else if (typeof options.body === 'string' || options.body instanceof FormData || options.body instanceof URLSearchParams)
    body = options.body;
  else if (Buffer.isBuffer(options.body)) body = new Uint8Array(options.body);
  else {
    body = JSON.stringify(options.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt >= retries) throw err;
      await httpConfig.sleep(backoff(attempt));
      continue;
    }

    if (RETRYABLE.has(response.status) && attempt < retries) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      await drain(response);
      await httpConfig.sleep(Math.min(retryAfter ?? backoff(attempt), httpConfig.maxRetryAfterMs));
      continue;
    }

    if (!response.ok) throw new HttpError(response.status, target, await response.text());

    let data: unknown;
    if (responseType === 'none' || response.status === 204) {
      await drain(response);
      data = undefined;
    } else if (responseType === 'buffer') data = Buffer.from(await response.arrayBuffer());
    else if (responseType === 'text') data = await response.text();
    else {
      const text = await response.text();
      data = text ? JSON.parse(text) : undefined;
    }
    return { status: response.status, headers: response.headers, data: data as T };
  }
}

/** Reads and discards a body so the connection can be reused. */
async function drain(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined);
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}
