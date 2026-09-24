import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import form from './fixtures/allegro/checkout-form.json';
import { AllegroAdapter } from '@/server/integrations/marketplaces/allegro/adapter';
import type { AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { mapAllegroCheckoutForm } from '@/server/integrations/marketplaces/allegro/mapper';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const API = 'https://api.allegro.pl.allegrosandbox.pl';
const AUTH = 'https://allegro.pl.allegrosandbox.pl';

function store(overrides: Partial<AllegroCredentials> = {}) {
  let current: AllegroCredentials = {
    clientId: 'cid',
    clientSecret: 'csecret',
    sandbox: true,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
  const saved: AllegroCredentials[] = [];
  return { saved, get: () => current, save: async (n: AllegroCredentials) => void saved.push((current = n)) };
}

describe('mapAllegroCheckoutForm', () => {
  it('normalises a paid parcel-locker order', () => {
    const o = mapAllegroCheckoutForm(form);
    expect(o).toMatchObject({
      externalId: '29738e61-7f6a-11e8-ac45-09db60ede9d6',
      externalNumber: '29738E61',
      readyToShip: true,
      pickupPointId: 'POZ08A',
      deliveryMethodId: '2488f7b7-5d1c-4d65-b85c-4cbcf253fd93',
      codAmount: null,
      totalAmount: '123.45',
      revision: '819b5836',
    });
    expect(o.buyer.login).toBe('User_Login');
    expect(o.items[0]).toMatchObject({ sku: 'LUO-CND-01', quantity: 2, unitPrice: '57.23', externalProductId: '10000000001' });
  });

  it('marks cash on delivery and cancellation', () => {
    const cod = mapAllegroCheckoutForm({ ...form, payment: { ...form.payment, type: 'CASH_ON_DELIVERY' } });
    expect(cod.codAmount).toBe('123.45');
    expect(mapAllegroCheckoutForm({ ...form, status: 'CANCELLED' }).cancelled).toBe(true);
  });
});

describe('AllegroAdapter', () => {
  it('imports the backlog on the first sync and remembers the journal position', async () => {
    server.use(
      http.get(`${API}/order/event-stats`, () => HttpResponse.json({ latestEvent: { id: 'ev-100', occurredAt: '2026-09-21T10:00:00Z' } })),
      http.get(`${API}/order/checkout-forms`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('status')).toBe('READY_FOR_PROCESSING');
        expect(url.searchParams.getAll('fulfillment.status')).toEqual(['NEW', 'PROCESSING']);
        expect(request.headers.get('accept')).toBe('application/vnd.allegro.public.v1+json');
        return HttpResponse.json({ checkoutForms: [form], count: 1, totalCount: 1 });
      }),
    );
    const result = await new AllegroAdapter(store()).syncOrders(null);
    expect(result.orders).toHaveLength(1);
    expect(result.nextCursor).toBe('ev-100');
  });

  it('reads the event journal and only imports paid or cancelled orders', async () => {
    server.use(
      http.get(`${API}/order/events`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('from')).toBe('ev-100');
        return HttpResponse.json({
          events: [
            { id: 'ev-101', type: 'BOUGHT', order: { checkoutForm: { id: 'unpaid' } } },
            { id: 'ev-102', type: 'READY_FOR_PROCESSING', order: { checkoutForm: { id: form.id } } },
            { id: 'ev-103', type: 'FULFILLMENT_STATUS_CHANGED', order: { checkoutForm: { id: 'filled-in' } } },
          ],
        });
      }),
      http.get(`${API}/order/checkout-forms/:id`, ({ params }) =>
        HttpResponse.json(params.id === form.id ? form : { ...form, id: String(params.id), status: 'FILLED_IN' }),
      ),
    );
    const result = await new AllegroAdapter(store()).syncOrders('ev-100');
    expect(result.orders.map((o) => o.externalId)).toEqual([form.id]);
    expect(result.nextCursor).toBe('ev-103');
    expect(result.hasMore).toBe(false);
  });

  it('refreshes an expired token and saves the rotated refresh token', async () => {
    server.use(
      http.post(`${AUTH}/auth/oauth/token`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
        const body = new URLSearchParams(await request.text());
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('refresh-1');
        return HttpResponse.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 43199 });
      }),
      http.get(`${API}/me`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer access-2');
        return HttpResponse.json({ login: 'Luora_Shop' });
      }),
    );
    const creds = store({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await new AllegroAdapter(creds).checkConnection()).toBe('Allegro: Luora_Shop');
    expect(creds.saved[0]).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('adds the waybill once and marks the order as sent', async () => {
    const posted: unknown[] = [];
    const fulfillment: unknown[] = [];
    let existing: { waybill: string }[] = [];
    server.use(
      http.get(`${API}/order/checkout-forms/:id/shipments`, () => HttpResponse.json({ shipments: existing })),
      http.post(`${API}/order/checkout-forms/:id/shipments`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ id: 's1' }, { status: 201 });
      }),
      http.put(`${API}/order/checkout-forms/:id/fulfillment`, async ({ request }) => {
        fulfillment.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const adapter = new AllegroAdapter(store());
    const ref = { externalId: form.id, externalNumber: '29738E61', raw: form, items: [{ externalLineId: 'line-1', quantity: 2 }] };
    const tracking = { carrier: 'inpost' as const, carrierName: 'InPost', trackingNumber: '6200001' };
    await adapter.pushTracking(ref, tracking);
    expect(posted).toEqual([{ carrierId: 'INPOST', waybill: '6200001', lineItems: [{ id: 'line-1' }] }]);
    existing = [{ waybill: '6200001' }];
    await adapter.pushTracking(ref, tracking);
    expect(posted).toHaveLength(1);
    expect(fulfillment).toEqual([{ status: 'SENT' }, { status: 'SENT' }]);
  });
});
