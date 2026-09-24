import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';

export async function GET() {
  try {
    await getDb().run(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
