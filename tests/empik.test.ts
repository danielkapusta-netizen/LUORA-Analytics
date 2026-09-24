import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import order from './fixtures/empik/order.json';
import { buildStockCsv, EmpikAdapter } from '@/server/integrations/marketplaces/empik/adapter';
import { mapMiraklOrder, toAlpha2 } from '@/server/integrations/marketplaces/empik/mapper';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://marketplace.empik.test';
const creds = { baseUrl: BASE, apiKey: 'key-123' };

describe('mapMiraklOrder', () => {
  it('normalises an Empik order', () => {
    const o = mapMiraklOrder(order);
    expect(o).toMatchObject({
      externalId: '210045-A',
      externalNumber: '210045',
      readyToShip: true,
      pickupPointId: 'WAW01A',
      totalAmount: '108.80',
      shippingAmount: '9.00',
    });
    expect(o.shippingAddress).toMatchObject({ street: 'Marszałkowska 10 m. 4', postalCode: '00-590', countryCode: 'PL' });
    expect(o.items.map((i) => [i.sku, i.quantity, i.unitPrice])).toEqual([
      ['LUO-NTB-A5', 2, '29.90'],
      ['LUO-BAG-01', 1, '40.00'],
    ]);
  });

  it('is not shippable until accepted and paid', () => {
    expect(mapMiraklOrder({ ...order, order_state: 'WAITING_ACCEPTANCE' }).readyToShip).toBe(false);
    expect(mapMiraklOrder({ ...order, order_state: 'CANCELED' }).cancelled).toBe(true);
  });

  it('converts ISO alpha-3 country codes', () => {
    expect(toAlpha2('POL')).toBe('PL');
    expect(toAlpha2('de')).toBe('DE');
  });
});

describe('EmpikAdapter', () => {
  it('pages through OR11 with the API key', async () => {
    server.use(
      http.get(`${BASE}/api/orders`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('key-123');
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        const page = offset === 0 ? [order, { ...order, order_id: 'staged', order_state: 'STAGING' }] : [{ ...order, order_id: '210046-A', last_updated_date: '2026-09-23T08:00:00Z' }];
        return HttpResponse.json({ orders: offset < 200 ? page : [], total_count: 101 });
      }),
    );
    const result = await new EmpikAdapter(creds).syncOrders('2026-09-01T00:00:00Z');
    expect(result.orders.map((o) => o.externalId)).toEqual(['210045-A', '210046-A']);
    expect(result.nextCursor).toBe('2026-09-23T08:00:00Z');
  });

  it('sends tracking (OR23) then confirms shipment (OR24), and skips shipped orders', async () => {
    const calls: string[] = [];
    let state = 'SHIPPING';
    server.use(
      http.get(`${BASE}/api/orders`, () => HttpResponse.json({ orders: [{ ...order, order_state: state }], total_count: 1 })),
      http.put(`${BASE}/api/orders/:id/tracking`, async ({ request, params }) => {
        calls.push(`tracking ${params.id} ${JSON.stringify(await request.json())}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.put(`${BASE}/api/orders/:id/ship`, ({ params }) => {
        calls.push(`ship ${params.id}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const adapter = new EmpikAdapter(creds);
    const ref = { externalId: '210045-A', externalNumber: '210045', raw: order, items: [] };
    await adapter.pushTracking(ref, { carrier: 'inpost', carrierName: 'InPost', trackingNumber: '62001', trackingUrl: 'https://inpost.pl/sledzenie-przesylek?number=62001' });
    expect(calls).toEqual([
      'tracking 210045-A {"carrier_name":"InPost","carrier_url":"https://inpost.pl/sledzenie-przesylek?number=62001","tracking_number":"62001"}',
      'ship 210045-A',
    ]);
    state = 'SHIPPED';
    await adapter.pushTracking(ref, { carrier: 'inpost', carrierName: 'InPost', trackingNumber: '62001' });
    expect(calls).toHaveLength(2);
  });

  it('accepts every order line (OR21)', async () => {
    let body: unknown;
    server.use(
      http.put(`${BASE}/api/orders/210045-A/accept`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await new EmpikAdapter(creds).acceptOrder({ externalId: '210045-A', externalNumber: '210045', raw: order, items: [{ externalLineId: '210045-A-1', quantity: 2 }] });
    expect(body).toEqual({ order_lines: [{ accepted: true, id: '210045-A-1' }] });
  });

  it('updates stock with an STO01 CSV upload', async () => {
    let csv = '';
    server.use(
      http.post(`${BASE}/api/offers/stock/imports`, async ({ request }) => {
        const form = await request.formData();
        csv = await (form.get('file') as File).text();
        return HttpResponse.json({ import_id: '77' }, { status: 201 });
      }),
    );
    await new EmpikAdapter(creds).setStock([{ externalId: '5551', sku: 'LUO-NTB-A5', ref: { shopSku: 'LUO-NTB-A5' }, quantity: 4 }]);
    expect(csv).toBe('"offer-sku";"quantity";"warehouse-code";"update-delete"\n"LUO-NTB-A5";"4";"";"update"\n');
  });

  it('never sends negative stock', () => {
    expect(buildStockCsv([{ externalId: '1', sku: 'A;B"C', ref: {}, quantity: -2 }])).toContain('"A;B""C";"0"');
  });
});
