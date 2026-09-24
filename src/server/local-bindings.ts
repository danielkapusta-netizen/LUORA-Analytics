// Local D1/R2/Queue bindings for Node scripts and tests (wrangler's workerd simulators).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { setCfEnv, type CfEnv } from './cf';

export async function localBindings(options: { persistTo?: string } = {}) {
  const proxy = await getPlatformProxy<CfEnv & Record<string, unknown>>({
    persist: options.persistTo ? { path: options.persistTo } : true,
  });
  // Plain-text vars from wrangler.jsonc / .dev.vars behave like process.env on Workers.
  for (const [key, value] of Object.entries(proxy.env)) if (typeof value === 'string') process.env[key] ??= value;
  setCfEnv(proxy.env);
  return { env: proxy.env, dispose: () => proxy.dispose() };
}

/** Applies drizzle/*.sql to a D1 binding (what `wrangler d1 migrations apply` does). */
export async function applyMigrations(db: D1Database, dir = path.join(process.cwd(), 'drizzle')): Promise<void> {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await db.prepare(statement).run();
    }
  }
}
