// Background worker: order sync, label purchases, tracking pushes and stock sync.
// Run with `pnpm worker` next to the web app.
import { closeDb } from '../server/db/client';
import { runMigrations } from '../server/db/migrate';
import { env, isMockMode } from '../server/env';
import { handlers } from '../server/jobs/handlers';
import { getBoss, JOBS, stopBoss, type JobName } from '../server/jobs/queue';

/** Parallel jobs per queue. Label and tracking jobs are I/O bound, so a few at once is fine. */
const CONCURRENCY: Partial<Record<JobName, number>> = {
  [JOBS.syncAccount]: 3,
  [JOBS.shipmentCreate]: 4,
  [JOBS.shipmentPoll]: 4,
  [JOBS.trackingPush]: 4,
};

async function main() {
  await runMigrations();
  const boss = await getBoss('worker');

  for (const [name, handler] of Object.entries(handlers) as [JobName, (data: unknown) => Promise<unknown>][]) {
    await boss.work(name, { localConcurrency: CONCURRENCY[name] ?? 1, pollingIntervalSeconds: 1 }, async ([job]) => {
      const started = Date.now();
      try {
        const result = await handler(job.data);
        console.log(`[job] ${name} done in ${Date.now() - started} ms`, result ?? '');
        return result;
      } catch (err) {
        console.error(`[job] ${name} failed:`, err instanceof Error ? err.message : err);
        throw err;
      }
    });
  }

  const minutes = env().SYNC_INTERVAL_MINUTES;
  await boss.schedule(JOBS.syncAll, `*/${minutes} * * * *`, {}, { tz: 'Europe/Warsaw' });
  await boss.schedule(JOBS.shipmentSweep, '*/2 * * * *', {}, { tz: 'Europe/Warsaw' });
  await boss.schedule(JOBS.deliveryCheck, '15 */2 * * *', {}, { tz: 'Europe/Warsaw' });
  await boss.schedule(JOBS.stockReconcile, '30 3 * * *', {}, { tz: 'Europe/Warsaw' });
  // Sync right away instead of waiting for the first cron tick.
  await boss.send(JOBS.syncAll, {});

  console.log(`Worker started (${isMockMode() ? 'mock' : 'live'} integrations, order sync every ${minutes} min)`);

  const shutdown = async () => {
    console.log('Worker stopping…');
    await stopBoss();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
