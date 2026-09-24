// Creates the first admin user and default package presets. In mock mode it also
// adds demo marketplace and carrier accounts plus the default shipping rules.
import { eq } from 'drizzle-orm';
import { hashPassword } from '../crypto';
import { isMockMode } from '../env';
import { importListings } from '../services/inventory';
import { createDefaultRules, ensureDefaultPresets } from '../services/settings';
import { closeDb, getDb } from './client';
import { carrierAccounts, marketplaceAccounts, shippingRules, users } from './schema';

const DEMO_SENDER = {
  name: 'Magazyn Luora',
  company: 'Luora sp. z o.o.',
  street: 'ul. Magazynowa 5',
  city: 'Warszawa',
  postalCode: '02-222',
  countryCode: 'PL',
  phone: '500600700',
  email: 'wysylka@example.com',
};

export async function seed(): Promise<void> {
  const db = getDb();
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'change-me-please';
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!existing) {
    await db.insert(users).values({ email, name: 'Admin', role: 'admin', passwordHash: await hashPassword(password) });
    console.log(`Created admin ${email}`);
  }
  await ensureDefaultPresets();

  if (!isMockMode()) return;
  const accounts = await db.select({ id: marketplaceAccounts.id }).from(marketplaceAccounts).limit(1);
  if (accounts.length) return;

  const created = await db
    .insert(marketplaceAccounts)
    .values([
      { type: 'shopify', name: 'Shopify (demo)', stockSyncEnabled: true },
      { type: 'allegro', name: 'Allegro (demo)', stockSyncEnabled: true },
      { type: 'empik', name: 'Empik (demo)', stockSyncEnabled: true, settings: { autoAccept: false } },
    ])
    .returning({ id: marketplaceAccounts.id });
  const allegro = created[1];
  await db.insert(carrierAccounts).values([
    { type: 'inpost', name: 'InPost (demo)', sender: DEMO_SENDER, settings: { labelFormat: 'pdf', labelSize: 'A6' } },
    {
      type: 'allegro_shipping',
      name: 'Allegro Delivery (demo)',
      marketplaceAccountId: allegro.id,
      sender: DEMO_SENDER,
      settings: { labelFormat: 'pdf', labelSize: 'A6', codIban: 'PL61109010140000071219812874', codOwnerName: 'Luora sp. z o.o.' },
    },
  ]);
  const rules = await db.select({ id: shippingRules.id }).from(shippingRules).limit(1);
  if (rules.length === 0) await createDefaultRules();
  // Demo products: every mock listing shares the same SKUs, so they link across marketplaces.
  for (const account of created) await importListings(account.id);
  console.log('Created demo accounts and shipping rules (mock mode)');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
