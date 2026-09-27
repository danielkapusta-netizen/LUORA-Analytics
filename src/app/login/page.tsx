import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, Input } from '@/components/ui';
import { currentUser } from '@/server/auth';
import { loginAction } from '../auth-actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect('/orders');
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- no image optimiser on Workers */}
          <img src="/logo-dark.png" alt="Luora" className="h-8 w-auto" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <ActionForm action={loginAction} className="space-y-4" showOk={false}>
            <input type="hidden" name="next" value={next ?? '/orders'} />
            <Field label="Email">
              <Input name="email" type="email" autoComplete="username" required autoFocus />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton className="w-full" pendingText="Signing in…">
              Sign in
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
