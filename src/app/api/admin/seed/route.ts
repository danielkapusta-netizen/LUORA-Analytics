import { currentUser } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { seed } from '@/server/db/seed';

/**
 * First-run setup on Cloudflare: creates the admin user (from ADMIN_EMAIL /
 * ADMIN_PASSWORD secrets) and default packages. Open while no user exists;
 * afterwards only admins may call it.
 */
export async function POST() {
  const anyUser = await getDb().select({ id: users.id }).from(users).limit(1);
  if (anyUser.length > 0 && (await currentUser())?.role !== 'admin') return new Response('Forbidden', { status: 403 });
  await seed();
  return Response.json({ ok: true });
}
