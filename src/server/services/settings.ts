import { asc, eq } from 'drizzle-orm';
import { encryptJson, hashPassword } from '../crypto';
import { getDb } from '../db/client';
import {
  carrierAccounts,
  marketplaceAccounts,
  packagePresets,
  shippingRules,
  users,
  type CarrierSettings,
  type MarketplaceSettings,
  type RuleConditions,
} from '../db/schema';
import type { SenderSettings } from '../integrations/types';
import { BUYER_CHOICE } from '../integrations/carriers/allegro-shipping/adapter';
import { getCarrierAdapter, getMarketplaceAdapter, loadCarrierAccount, loadMarketplaceAccount, readCredentials } from './accounts';

export const DEFAULT_PRESETS = [
  { name: 'Paczkomat A (small)', lengthCm: 64, widthCm: 38, heightCm: 8, weightKg: '5', inpostTemplate: 'small', isDefault: false },
  { name: 'Paczkomat B (medium)', lengthCm: 64, widthCm: 38, heightCm: 19, weightKg: '10', inpostTemplate: 'medium', isDefault: false },
  { name: 'Paczkomat C (large)', lengthCm: 64, widthCm: 38, heightCm: 41, weightKg: '25', inpostTemplate: 'large', isDefault: false },
  { name: 'Box 30×20×10 cm, 1 kg', lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: '1', inpostTemplate: 'small', isDefault: true },
];

export async function ensureDefaultPresets(): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: packagePresets.id }).from(packagePresets).limit(1);
  if (existing.length === 0) await db.insert(packagePresets).values(DEFAULT_PRESETS);
}

/**
 * The routing described in the plan: Allegro orders use Allegro Delivery with the
 * buyer's method, orders with a pickup point go to an InPost locker, the rest by InPost courier.
 */
export async function createDefaultRules(): Promise<number> {
  const db = getDb();
  await ensureDefaultPresets();
  const carriers = await db.select().from(carrierAccounts).orderBy(asc(carrierAccounts.createdAt));
  const presets = await db.select().from(packagePresets);
  const inpost = carriers.find((c) => c.type === 'inpost');
  const allegro = carriers.find((c) => c.type === 'allegro_shipping');
  const lockerPreset = presets.find((p) => p.inpostTemplate === 'small' && !p.isDefault) ?? presets[0];
  const defaultPreset = presets.find((p) => p.isDefault) ?? presets[0];

  const rules: (typeof shippingRules.$inferInsert)[] = [];
  if (allegro) {
    rules.push({ name: 'Allegro orders → Allegro Delivery', priority: 10, conditions: { marketplaces: ['allegro'] }, carrierAccountId: allegro.id, service: BUYER_CHOICE, packagePresetId: defaultPreset?.id });
  }
  if (inpost) {
    rules.push({ name: 'Pickup point → InPost Paczkomat', priority: 20, conditions: { hasPickupPoint: true }, carrierAccountId: inpost.id, service: 'inpost_locker_standard', packagePresetId: lockerPreset?.id });
    rules.push({ name: 'Everything else → InPost courier', priority: 30, conditions: {}, carrierAccountId: inpost.id, service: 'inpost_courier_standard', packagePresetId: defaultPreset?.id });
  }
  if (rules.length) await db.insert(shippingRules).values(rules);
  return rules.length;
}

// ---------------------------------------------------------------- marketplace accounts

export async function listMarketplaceAccounts() {
  return getDb().select().from(marketplaceAccounts).orderBy(asc(marketplaceAccounts.createdAt));
}

export async function saveMarketplaceAccount(input: {
  id?: string;
  type: 'shopify' | 'allegro' | 'empik';
  name: string;
  /** Only fields that were filled in; blank secrets keep their stored value. */
  credentials: Record<string, unknown>;
  settings: MarketplaceSettings;
  enabled: boolean;
  stockSyncEnabled: boolean;
  stockDryRun: boolean;
}): Promise<string> {
  const db = getDb();
  if (input.id) {
    const existing = await loadMarketplaceAccount(input.id);
    const merged = { ...(readCredentials<Record<string, unknown>>(existing.credentials) ?? {}), ...input.credentials };
    await db
      .update(marketplaceAccounts)
      .set({
        name: input.name,
        credentials: Object.keys(merged).length ? encryptJson(merged) : null,
        settings: { ...existing.settings, ...input.settings },
        enabled: input.enabled,
        stockSyncEnabled: input.stockSyncEnabled,
        stockDryRun: input.stockDryRun,
      })
      .where(eq(marketplaceAccounts.id, input.id));
    return input.id;
  }
  const [row] = await db
    .insert(marketplaceAccounts)
    .values({
      type: input.type,
      name: input.name,
      credentials: Object.keys(input.credentials).length ? encryptJson(input.credentials) : null,
      settings: input.settings,
      enabled: input.enabled,
      stockSyncEnabled: input.stockSyncEnabled,
      stockDryRun: input.stockDryRun,
    })
    .returning({ id: marketplaceAccounts.id });
  return row.id;
}

export async function deleteMarketplaceAccount(id: string): Promise<void> {
  await getDb().delete(marketplaceAccounts).where(eq(marketplaceAccounts.id, id));
}

/** Which credential fields are stored (never their values), for the settings form. */
export function storedCredentialKeys(encrypted: string | null): string[] {
  const creds = readCredentials<Record<string, unknown>>(encrypted);
  return creds ? Object.keys(creds).filter((k) => creds[k] !== undefined && creds[k] !== '') : [];
}

/** Non-secret credential fields that are safe to show in forms. */
export function publicCredentialFields(encrypted: string | null): Record<string, string | boolean> {
  const creds = readCredentials<Record<string, unknown>>(encrypted) ?? {};
  const out: Record<string, string | boolean> = {};
  for (const key of ['shopDomain', 'clientId', 'baseUrl', 'shopId', 'organizationId', 'sandbox']) {
    const value = creds[key];
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export async function testMarketplaceConnection(id: string): Promise<string> {
  return getMarketplaceAdapter(await loadMarketplaceAccount(id)).checkConnection();
}

// ---------------------------------------------------------------- carrier accounts

export async function listCarrierAccounts() {
  return getDb().select().from(carrierAccounts).orderBy(asc(carrierAccounts.createdAt));
}

export async function saveCarrierAccount(input: {
  id?: string;
  type: 'inpost' | 'allegro_shipping';
  name: string;
  credentials: Record<string, unknown>;
  marketplaceAccountId: string | null;
  sender: SenderSettings;
  settings: CarrierSettings;
  enabled: boolean;
}): Promise<string> {
  const db = getDb();
  if (input.id) {
    const existing = await loadCarrierAccount(input.id);
    const merged = { ...(readCredentials<Record<string, unknown>>(existing.credentials) ?? {}), ...input.credentials };
    await db
      .update(carrierAccounts)
      .set({
        name: input.name,
        credentials: Object.keys(merged).length ? encryptJson(merged) : null,
        marketplaceAccountId: input.marketplaceAccountId,
        sender: input.sender,
        settings: { ...existing.settings, ...input.settings },
        enabled: input.enabled,
      })
      .where(eq(carrierAccounts.id, input.id));
    return input.id;
  }
  const [row] = await db
    .insert(carrierAccounts)
    .values({
      type: input.type,
      name: input.name,
      credentials: Object.keys(input.credentials).length ? encryptJson(input.credentials) : null,
      marketplaceAccountId: input.marketplaceAccountId,
      sender: input.sender,
      settings: input.settings,
      enabled: input.enabled,
    })
    .returning({ id: carrierAccounts.id });
  return row.id;
}

export async function deleteCarrierAccount(id: string): Promise<void> {
  await getDb().delete(carrierAccounts).where(eq(carrierAccounts.id, id));
}

export async function testCarrierConnection(id: string): Promise<string> {
  const services = await (await getCarrierAdapter(await loadCarrierAccount(id))).services();
  return `${services.length} service(s) available`;
}

// ---------------------------------------------------------------- rules & presets

export async function saveRule(input: {
  id?: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  carrierAccountId: string;
  service: string;
  packagePresetId: string | null;
}): Promise<void> {
  const db = getDb();
  const { id, ...values } = input;
  if (id) await db.update(shippingRules).set(values).where(eq(shippingRules.id, id));
  else await db.insert(shippingRules).values(values);
}

export async function deleteRule(id: string): Promise<void> {
  await getDb().delete(shippingRules).where(eq(shippingRules.id, id));
}

export async function savePreset(input: {
  id?: string;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: string;
  inpostTemplate: string | null;
  isDefault: boolean;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(packagePresets).set({ isDefault: false });
    const { id, ...values } = input;
    if (id) await tx.update(packagePresets).set(values).where(eq(packagePresets.id, id));
    else await tx.insert(packagePresets).values(values);
  });
}

export async function deletePreset(id: string): Promise<void> {
  await getDb().delete(packagePresets).where(eq(packagePresets.id, id));
}

// ---------------------------------------------------------------- users

export async function listUsers() {
  return getDb()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function createUser(input: { email: string; name: string; password: string; role: 'admin' | 'staff' }): Promise<void> {
  if (input.password.length < 8) throw new Error('Password must have at least 8 characters');
  await getDb()
    .insert(users)
    .values({ email: input.email.trim().toLowerCase(), name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) });
}

export async function deleteUser(id: string): Promise<void> {
  await getDb().delete(users).where(eq(users.id, id));
}

export async function resetPassword(id: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error('Password must have at least 8 characters');
  await getDb().update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
}
