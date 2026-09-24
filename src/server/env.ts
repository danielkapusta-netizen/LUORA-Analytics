import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://luora:luora@localhost:5432/luora'),
  ENCRYPTION_KEY: z.string().optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
  INTEGRATIONS_MODE: z.enum(['live', 'mock']).default('live'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(3),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function isMockMode(): boolean {
  return env().INTEGRATIONS_MODE === 'mock';
}
