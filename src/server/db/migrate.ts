import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { closeDb, getDb } from './client';

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  runMigrations()
    .then(() => console.log('Migrations applied'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
