import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildUrl, HttpError, parseRetryAfter, request } from '@/server/http';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('request', () => {
  it('retries a 429 and then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.test/items', () => {
        calls++;
        return calls < 3 ? new HttpResponse('slow down', { status: 429, headers: { 'Retry-After': '1' } }) : HttpResponse.json({ ok: true });
      }),
    );
    const res = await request<{ ok: boolean }>('https://api.test/items');
    expect(res.data.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('does not retry client errors and reports the body', async () => {
    let calls = 0;
    server.use(
      http.post('https://api.test/items', () => {
        calls++;
        return HttpResponse.json({ error: 'bad postcode' }, { status: 422 });
      }),
    );
    await expect(request('https://api.test/items', { method: 'POST', body: { a: 1 } })).rejects.toThrow(/422.*bad postcode/);
    expect(calls).toBe(1);
  });

  it('gives up after the retry budget', async () => {
    server.use(http.get('https://api.test/down', () => new HttpResponse(null, { status: 503 })));
    const err = await request('https://api.test/down', { retries: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
  });

  it('sends JSON and reads binary', async () => {
    server.use(
      http.post('https://api.test/label', async ({ request: req }) => {
        expect(req.headers.get('content-type')).toBe('application/json');
        expect(await req.json()).toEqual({ id: 7 });
        return new HttpResponse(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } });
      }),
    );
    const res = await request<Buffer>('https://api.test/label', { method: 'POST', body: { id: 7 }, responseType: 'buffer' });
    expect(res.data.toString()).toBe('%PDF');
  });
});

describe('helpers', () => {
  it('builds query strings with arrays and skips empty values', () => {
    expect(buildUrl('https://a.test/x', { a: 1, b: undefined, c: ['p', 'q'], d: null })).toBe('https://a.test/x?a=1&c=p&c=q');
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});
