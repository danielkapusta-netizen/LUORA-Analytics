import { PgBoss } from 'pg-boss';
import { env } from '../env';

export const JOBS = {
  syncAll: 'orders-sync-all',
  syncAccount: 'orders-sync',
  shipmentCreate: 'shipment-create',
  shipmentPoll: 'shipment-poll',
  shipmentSweep: 'shipment-sweep',
  trackingPush: 'tracking-push',
  marketplaceProcessing: 'marketplace-processing',
  deliveryCheck: 'delivery-check',
  listingsImport: 'listings-import',
  stockPush: 'stock-push',
  stockReconcile: 'stock-reconcile',
} as const;

export interface JobPayloads {
  [JOBS.syncAll]: Record<string, never>;
  [JOBS.syncAccount]: { accountId: string };
  [JOBS.shipmentCreate]: { shipmentId: string };
  [JOBS.shipmentPoll]: { shipmentId: string };
  [JOBS.shipmentSweep]: Record<string, never>;
  [JOBS.trackingPush]: { shipmentId: string };
  [JOBS.marketplaceProcessing]: { orderId: string };
  [JOBS.deliveryCheck]: Record<string, never>;
  [JOBS.listingsImport]: { accountId: string };
  [JOBS.stockPush]: { accountId: string };
  [JOBS.stockReconcile]: Record<string, never>;
}

export type JobName = keyof JobPayloads;

export interface EnqueueOptions {
  /** Delay before the job may run. */
  startAfterSeconds?: number;
  /** Only one queued job per key (e.g. one sync per account). */
  singletonKey?: string;
  /** Collapse bursts: at most one job per key per this many seconds. */
  debounceSeconds?: number;
}

type EnqueueFn = <K extends JobName>(name: K, data: JobPayloads[K], options?: EnqueueOptions) => Promise<void>;

const globalForBoss = globalThis as unknown as { __luoraBoss?: Promise<PgBoss>; __luoraEnqueue?: EnqueueFn };

/** Retry policy per queue. Label purchases never retry automatically: a retry could buy a second label. */
type QueueConfig = { retryLimit: number; retryDelay?: number; retryBackoff?: boolean; policy?: 'standard' | 'stately' };
const QUEUE_OPTIONS: Record<JobName, QueueConfig> = {
  [JOBS.syncAll]: { retryLimit: 0 },
  // "stately": one queued + one running job per singleton key (account).
  [JOBS.syncAccount]: { retryLimit: 2, retryDelay: 30, retryBackoff: true, policy: 'stately' },
  [JOBS.shipmentCreate]: { retryLimit: 0 },
  [JOBS.shipmentPoll]: { retryLimit: 3, retryDelay: 10, retryBackoff: true },
  [JOBS.shipmentSweep]: { retryLimit: 0 },
  [JOBS.trackingPush]: { retryLimit: 5, retryDelay: 60, retryBackoff: true },
  [JOBS.marketplaceProcessing]: { retryLimit: 3, retryDelay: 60, retryBackoff: true },
  [JOBS.deliveryCheck]: { retryLimit: 0 },
  [JOBS.listingsImport]: { retryLimit: 1, retryDelay: 60, policy: 'stately' },
  [JOBS.stockPush]: { retryLimit: 3, retryDelay: 60, retryBackoff: true },
  [JOBS.stockReconcile]: { retryLimit: 0 },
};

async function createBoss(role: 'web' | 'worker'): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env().DATABASE_URL,
    // Only the worker runs maintenance and cron; the web app just sends jobs.
    supervise: role === 'worker',
    schedule: role === 'worker',
    max: role === 'worker' ? 10 : 3,
  });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  await boss.start();
  for (const name of Object.values(JOBS)) {
    const existing = await boss.getQueue(name);
    if (!existing) await boss.createQueue(name, QUEUE_OPTIONS[name]);
  }
  return boss;
}

export function getBoss(role: 'web' | 'worker' = 'web'): Promise<PgBoss> {
  globalForBoss.__luoraBoss ??= createBoss(role).catch((err) => {
    globalForBoss.__luoraBoss = undefined;
    throw err;
  });
  return globalForBoss.__luoraBoss;
}

export async function stopBoss(): Promise<void> {
  const boss = await globalForBoss.__luoraBoss;
  globalForBoss.__luoraBoss = undefined;
  await boss?.stop({ graceful: true });
}

export const enqueue: EnqueueFn = async (name, data, options = {}) => {
  if (globalForBoss.__luoraEnqueue) return globalForBoss.__luoraEnqueue(name, data, options);
  const boss = await getBoss();
  if (options.debounceSeconds) {
    await boss.sendDebounced(name, data, null, options.debounceSeconds, options.singletonKey ?? name);
    return;
  }
  await boss.send(name, data, {
    startAfter: options.startAfterSeconds,
    singletonKey: options.singletonKey,
  });
};

/** Tests replace the queue with an in-memory recorder. */
export function setEnqueueImplementation(fn: EnqueueFn | undefined): void {
  globalForBoss.__luoraEnqueue = fn;
}
