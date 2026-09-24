// Full order → label → tracking → stock flow against a real PostgreSQL database,
// using the mock marketplaces and carriers. Runs only when TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL=postgres://luora:luora@localhost:5432/luora_test pnpm test
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('order flow (database)', () => {
  type Queued = { name: string; data: unknown };
  const queue: Queued[] = [];
  // Loaded after the environment is pointed at the test database.
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    orders: typeof import('@/server/services/orders');
    shipping: typeof import('@/server/services/shipping');
    inventory: typeof import('@/server/services/inventory');
    workflow: typeof import('@/server/services/workflow');
    analytics: typeof import('@/server/services/analytics');
    handlers: typeof import('@/server/jobs/handlers');
  };

  /** Runs queued jobs (and the jobs they queue) until nothing is left. */
  async function drain(skip: string[] = []) {
    for (let i = 0; i < 200 && queue.some((j) => !skip.includes(j.name)); i++) {
      const index = queue.findIndex((j) => !skip.includes(j.name));
      const [job] = queue.splice(index, 1);
      await m.handlers.runJob(job.name as never, job.data as never);
    }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.INTEGRATIONS_MODE = 'mock';
    const db = await import('@/server/db/client');
    const orm = await import('drizzle-orm');
    const { runMigrations } = await import('@/server/db/migrate');
    await runMigrations();
    await db.getDb().execute(orm.sql`
      truncate users, sessions, marketplace_accounts, carrier_accounts, orders, order_items, order_events,
        package_presets, shipping_rules, shipment_batches, shipments, label_files, products,
        product_listings, stock_movements, stock_sync_log cascade`);
    const queueModule = await import('@/server/jobs/queue');
    queueModule.setEnqueueImplementation(async (name, data) => void queue.push({ name, data }));
    const { seed } = await import('@/server/db/seed');
    await seed();
    m = {
      db,
      orm,
      schema: await import('@/server/db/schema'),
      orders: await import('@/server/services/orders'),
      shipping: await import('@/server/services/shipping'),
      inventory: await import('@/server/services/inventory'),
      workflow: await import('@/server/services/workflow'),
      analytics: await import('@/server/services/analytics'),
      handlers: await import('@/server/jobs/handlers'),
    };
  }, 60_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await m?.db.closeDb();
  });

  const allOrders = () => m.db.getDb().select().from(m.schema.orders);
  const productStock = async () =>
    Object.fromEntries((await m.db.getDb().select().from(m.schema.products)).map((p) => [p.sku, p.stock]));
  const adminId = async () => (await m.db.getDb().select().from(m.schema.users))[0].id;

  it('imports orders from every marketplace and takes stock', async () => {
    const before = await productStock();
    const accounts = await m.db.getDb().select().from(m.schema.marketplaceAccounts);
    for (const a of accounts) await m.orders.syncAccount(a.id);
    // A second sync must not duplicate anything.
    for (const a of accounts) await m.orders.syncAccount(a.id);

    const rows = await allOrders();
    expect(new Set(rows.map((o) => o.marketplace))).toEqual(new Set(['shopify', 'allegro', 'empik']));
    expect(rows.length).toBeGreaterThanOrEqual(42);

    const items = await m.db.getDb().select().from(m.schema.orderItems);
    const sold: Record<string, number> = {};
    for (const i of items) sold[i.sku!] = (sold[i.sku!] ?? 0) + i.quantity;
    const after = await productStock();
    for (const sku of Object.keys(before)) expect(after[sku]).toBe(before[sku] - (sold[sku] ?? 0));
    expect(queue.some((j) => j.name === 'stock-push')).toBe(true);
    queue.length = 0;
  });

  it('routes, buys a locker label, pushes tracking and marks the order shipped', async () => {
    const order = (await allOrders()).find((o) => o.marketplace === 'shopify' && o.pickupPointId)!;
    const form = await m.shipping.shippingFormData(order.id);
    expect(form.route?.service).toBe('inpost_locker_standard');

    const id = await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} },
      await adminId(),
    );
    await expect(
      m.shipping.requestShipment({ orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} }, null),
    ).rejects.toThrow(/already has a label/);

    await drain();
    const [shipment] = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.id, id));
    expect(shipment).toMatchObject({ state: 'created', carrierCode: 'INPOST' });
    expect(shipment.trackingNumber).toMatch(/^6\d{23}$/);
    expect(shipment.trackingPushedAt).not.toBeNull();
    expect(await m.shipping.getLabel(id)).toMatchObject({ format: 'pdf' });
    const [updated] = await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, order.id));
    expect(updated.status).toBe('shipped');
    expect(updated.shippedAt).not.toBeNull();
  });

  it('cancels a label before tracking is sent and reopens the order', async () => {
    const order = (await allOrders()).find((o) => o.marketplace === 'shopify' && !o.pickupPointId && o.status === 'new')!;
    const data = await m.shipping.loadRoutingData();
    const route = m.shipping.routeOrder(order, data)!;
    expect(route.service).toBe('inpost_courier_standard');
    const id = await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: route.carrierAccountId, service: route.service, parcel: m.shipping.presetToParcel(data.presets[0]), options: {} },
      null,
    );
    await drain(['tracking-push']);
    queue.length = 0;
    await m.shipping.cancelShipment(id, await adminId());
    const [reopened] = await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, order.id));
    expect(reopened.status).toBe('processing');
    // With the old label cancelled a new one may be bought.
    await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: route.carrierAccountId, service: route.service, parcel: m.shipping.presetToParcel(data.presets[0]), options: {} },
      null,
    );
    queue.length = 0;
  });

  it('returns stock when an order is cancelled and takes it again when reopened', async () => {
    const order = (await allOrders()).find((o) => o.marketplace === 'allegro' && o.status === 'new')!;
    const items = await m.db.getDb().select().from(m.schema.orderItems).where(m.orm.eq(m.schema.orderItems.orderId, order.id));
    const before = await productStock();
    await m.db.getDb().transaction((tx) => m.workflow.changeStatus(tx, order.id, 'cancelled', {}));
    const cancelled = await productStock();
    for (const i of items) expect(cancelled[i.sku!]).toBe(before[i.sku!] + items.filter((x) => x.sku === i.sku).reduce((s, x) => s + x.quantity, 0));
    await m.db.getDb().transaction((tx) => m.workflow.changeStatus(tx, order.id, 'new', {}));
    expect(await productStock()).toEqual(before);
    await expect(m.db.getDb().transaction((tx) => m.workflow.changeStatus(tx, order.id, 'delivered', {}))).rejects.toThrow(/Can't move/);
    queue.length = 0;
  });

  it('creates a bulk batch, skipping orders that are not ready', async () => {
    const rows = await allOrders();
    const allegro = rows.filter((o) => o.marketplace === 'allegro' && o.status === 'new').slice(0, 3);
    const waiting = rows.find((o) => o.marketplace === 'empik' && !o.readyToShip)!;
    const batchId = await m.shipping.createBatch([...allegro.map((o) => o.id), waiting.id], await adminId());
    await drain();
    const batch = (await m.shipping.getBatch(batchId))!;
    expect(batch.rows.map((r) => r.shipment.state)).toEqual(['created', 'created', 'created']);
    expect(batch.rows.every((r) => r.shipment.carrier === 'allegro_shipping')).toBe(true);
    expect(batch.skipped).toHaveLength(1);
    expect(batch.skipped[0].reason).toMatch(/not ready to ship/);
    const merged = await m.shipping.mergedLabelsFor(batch.rows.map((r) => r.shipment.id));
    expect(merged.format).toBe('pdf');
  });

  it('accepts an Empik order, which then becomes shippable', async () => {
    const waiting = (await allOrders()).find((o) => o.marketplace === 'empik' && o.marketplaceStatus === 'WAITING_ACCEPTANCE')!;
    await m.orders.acceptOrder(waiting.id, await adminId());
    const [after] = await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, waiting.id));
    expect(after).toMatchObject({ readyToShip: true, marketplaceStatus: 'SHIPPING' });
  });

  it('pushes master stock to listings, only logging in dry-run mode', async () => {
    const [account] = await m.db.getDb().select().from(m.schema.marketplaceAccounts).where(m.orm.eq(m.schema.marketplaceAccounts.type, 'shopify'));
    const dry = await m.inventory.runStockPush(account.id);
    expect(dry).toMatchObject({ dryRun: true });
    expect((await m.inventory.runStockPush(account.id)).pushed).toBe(0);

    await m.db.getDb().update(m.schema.marketplaceAccounts).set({ stockDryRun: false }).where(m.orm.eq(m.schema.marketplaceAccounts.id, account.id));
    const live = await m.inventory.runStockPush(account.id);
    expect(live).toEqual({ pushed: 6, dryRun: false });
    expect((await m.inventory.runStockPush(account.id)).pushed).toBe(0);
  });

  it('reports analytics over the stored orders', async () => {
    const data = await m.analytics.analytics({ from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 60_000) });
    expect(data.kpis.orders).toBeGreaterThan(30);
    expect(data.byMarketplace).toHaveLength(3);
    expect(data.carriers.length).toBeGreaterThan(0);
  });
});
