// Read-only connection check for a marketplace or carrier account:
//   pnpm integration:check "Allegro – main"      (name or id)
// Marketplaces: verifies the credentials and counts orders the first sync would import.
// Carriers: verifies the credentials and lists the available services.
// Nothing is written to the database or sent to the marketplace.
import { eq, or, type AnyColumn } from 'drizzle-orm';
import { closeDb, getDb } from '../src/server/db/client';
import { carrierAccounts, marketplaceAccounts } from '../src/server/db/schema';
import { getCarrierAdapter, getMarketplaceAdapter } from '../src/server/services/accounts';

const UUID = /^[0-9a-f-]{36}$/i;

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error('Usage: pnpm integration:check <account name or id>');
  const db = getDb();
  const byName = (name: AnyColumn, id: AnyColumn) => (UUID.test(target) ? or(eq(id, target), eq(name, target)) : eq(name, target));

  const [marketplace] = await db.select().from(marketplaceAccounts).where(byName(marketplaceAccounts.name, marketplaceAccounts.id));
  if (marketplace) {
    const adapter = getMarketplaceAdapter(marketplace);
    console.log(`✓ ${await adapter.checkConnection()}`);
    const result = await adapter.syncOrders(null);
    console.log(`✓ First sync would import ${result.orders.length} order(s)${result.hasMore ? ' (and more)' : ''}`);
    for (const o of result.orders.slice(0, 5)) {
      console.log(`  ${o.externalNumber}  ${o.marketplaceStatus}  ${o.totalAmount} ${o.currency}  ${o.deliveryMethodName ?? ''} ${o.pickupPointId ?? ''}`);
    }
    let listings = 0;
    for await (const listing of adapter.listListings()) {
      listings++;
      if (listings === 1) console.log(`  e.g. listing ${listing.externalId} sku=${listing.sku ?? '—'} qty=${listing.quantity ?? '?'}`);
      if (listings >= 200) break;
    }
    console.log(`✓ Listings readable (${listings}${listings >= 200 ? '+' : ''})`);
    return;
  }

  const [carrier] = await db.select().from(carrierAccounts).where(byName(carrierAccounts.name, carrierAccounts.id));
  if (carrier) {
    const services = await (await getCarrierAdapter(carrier)).services();
    console.log(`✓ ${carrier.name}: ${services.length} service(s)`);
    for (const s of services.slice(0, 20)) console.log(`  ${s.id}  ${s.name}`);
    return;
  }
  throw new Error(`No marketplace or carrier account called "${target}"`);
}

main()
  .catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
