import { Nav } from '@/components/nav';
import { requireUser } from '@/server/auth';
import { isMockMode } from '@/server/env';
import { logoutAction } from '../auth-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav userName={user.name} mock={isMockMode()} logoutAction={logoutAction} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
