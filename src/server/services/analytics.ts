import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  marketplace?: string;
}

function orderScope(f: AnalyticsFilters) {
  return sql`o.placed_at >= ${f.from.toISOString()} and o.placed_at < ${f.to.toISOString()}
    ${f.marketplace ? sql`and o.marketplace = ${f.marketplace}` : sql``}`;
}

export async function analytics(f: AnalyticsFilters) {
  const db = getDb();
  const scope = orderScope(f);

  const [kpis] = await db.execute<{
    orders: number;
    cancelled: number;
    revenue: string | null;
    aov: string | null;
    shipped: number;
    avg_hours_to_ship: string | null;
    currencies: string[] | null;
  }>(sql`
    select
      count(*) filter (where o.status <> 'cancelled')::int as orders,
      count(*) filter (where o.status = 'cancelled')::int as cancelled,
      sum(o.total_amount) filter (where o.status <> 'cancelled') as revenue,
      avg(o.total_amount) filter (where o.status <> 'cancelled') as aov,
      count(*) filter (where o.status in ('shipped', 'delivered'))::int as shipped,
      avg(extract(epoch from (o.shipped_at - o.placed_at)) / 3600) filter (where o.shipped_at is not null) as avg_hours_to_ship,
      array_agg(distinct o.currency) as currencies
    from orders o where ${scope}`);

  const daily = await db.execute<{ day: string; marketplace: string; orders: number; revenue: string }>(sql`
    select to_char(date_trunc('day', o.placed_at at time zone 'Europe/Warsaw'), 'YYYY-MM-DD') as day,
           o.marketplace, count(*)::int as orders, sum(o.total_amount) as revenue
    from orders o where ${scope} and o.status <> 'cancelled'
    group by 1, 2 order by 1`);

  const byMarketplace = await db.execute<{ marketplace: string; orders: number; revenue: string; aov: string }>(sql`
    select o.marketplace, count(*)::int as orders, sum(o.total_amount) as revenue, avg(o.total_amount) as aov
    from orders o where ${scope} and o.status <> 'cancelled'
    group by 1 order by revenue desc`);

  const topSkus = await db.execute<{ sku: string | null; name: string; quantity: number; revenue: string }>(sql`
    select i.sku, min(i.name) as name, sum(i.quantity)::int as quantity, sum(i.quantity * i.unit_price) as revenue
    from order_items i join orders o on o.id = i.order_id
    where ${scope} and o.status <> 'cancelled'
    group by i.sku order by quantity desc limit 10`);

  const carriers = await db.execute<{ carrier: string; service: string; shipments: number }>(sql`
    select s.carrier, s.service, count(*)::int as shipments
    from shipments s join orders o on o.id = s.order_id
    where ${scope} and s.state = 'created'
    group by 1, 2 order by shipments desc`);

  const shipTime = await db.execute<{ marketplace: string; avg_hours: string; shipped: number }>(sql`
    select o.marketplace, avg(extract(epoch from (o.shipped_at - o.placed_at)) / 3600) as avg_hours, count(*)::int as shipped
    from orders o where ${scope} and o.shipped_at is not null
    group by 1 order by 1`);

  const backlog = await db.execute<{ status: string; orders: number; oldest: string | null }>(sql`
    select o.status, count(*)::int as orders, min(o.placed_at)::text as oldest
    from orders o
    where o.status in ('new', 'processing', 'label_created', 'on_hold')
      ${f.marketplace ? sql`and o.marketplace = ${f.marketplace}` : sql``}
    group by 1`);

  return {
    kpis: {
      orders: kpis?.orders ?? 0,
      cancelled: kpis?.cancelled ?? 0,
      revenue: Number(kpis?.revenue ?? 0),
      aov: Number(kpis?.aov ?? 0),
      shipped: kpis?.shipped ?? 0,
      avgHoursToShip: kpis?.avg_hours_to_ship != null ? Number(kpis.avg_hours_to_ship) : null,
      currencies: (kpis?.currencies ?? []).filter(Boolean),
    },
    daily: [...daily].map((r) => ({ ...r, revenue: Number(r.revenue) })),
    byMarketplace: [...byMarketplace].map((r) => ({ ...r, revenue: Number(r.revenue), aov: Number(r.aov) })),
    topSkus: [...topSkus].map((r) => ({ ...r, revenue: Number(r.revenue) })),
    carriers: [...carriers],
    shipTime: [...shipTime].map((r) => ({ ...r, avgHours: Number(r.avg_hours) })),
    backlog: [...backlog],
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof analytics>>;
