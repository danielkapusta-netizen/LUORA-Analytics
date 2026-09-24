import { z } from 'zod';

const schema = z.object({
  ENCRYPTION_KEY: z.string().optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
  INTEGRATIONS_MODE: z.enum(['live', 'mock']).default('live'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(3),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof schema>;

// Wrangler `vars` and secrets are copied into process.env by the nodejs_compat flag.
export function env(): Env {
  return schema.parse(process.env);
}

export function isMockMode(): boolean {
  return env().INTEGRATIONS_MODE === 'mock';
}
