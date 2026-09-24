import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

const globalForDb = globalThis as unknown as { __luoraSql?: postgres.Sql; __luoraDb?: Db };

export function getSql(): postgres.Sql {
  globalForDb.__luoraSql ??= postgres(env().DATABASE_URL, { max: 10, onnotice: () => {} });
  return globalForDb.__luoraSql;
}

export function getDb(): Db {
  globalForDb.__luoraDb ??= drizzle(getSql(), { schema });
  return globalForDb.__luoraDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__luoraSql?.end({ timeout: 5 });
  globalForDb.__luoraSql = undefined;
  globalForDb.__luoraDb = undefined;
}

export { schema };
