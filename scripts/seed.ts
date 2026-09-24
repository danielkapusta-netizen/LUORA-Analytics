// Seeds the LOCAL D1 database used by `pnpm dev` / `pnpm preview`.
// For the deployed database, POST /api/admin/seed once (see README).
import { seed } from '../src/server/db/seed';
import { localBindings } from '../src/server/local-bindings';

async function main() {
  const { dispose } = await localBindings();
  try {
    await seed();
    console.log('Seeded local D1');
  } finally {
    await dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
