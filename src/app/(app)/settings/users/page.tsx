import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Badge, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { listUsers } from '@/server/services/settings';
import { createUserAction, deleteUserAction, resetPasswordAction } from '../actions';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage() {
  const me = await requireUser();
  const users = await listUsers();
  const admin = me.role === 'admin';

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader title="Team" description="Admins manage integrations, rules and users. Staff work on orders, labels and stock." />
        <ul className="divide-y divide-slate-100">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {u.name} {u.id === me.id && <span className="text-xs text-slate-500">(you)</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {u.email} · added {formatDate(u.createdAt, false)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={u.role === 'admin' ? 'violet' : 'gray'}>{u.role}</Badge>
                {admin && (
                  <>
                    <ActionForm action={resetPasswordAction.bind(null, u.id)} className="flex gap-1.5" resetOnSuccess>
                      <Input name="password" type="password" placeholder="New password" className="h-8 w-40" minLength={8} required autoComplete="new-password" />
                      <SubmitButton size="sm" variant="secondary">
                        Set
                      </SubmitButton>
                    </ActionForm>
                    {u.id !== me.id && (
                      <ActionForm action={deleteUserAction.bind(null, u.id)} showOk={false}>
                        <SubmitButton size="sm" variant="danger" confirm={`Delete ${u.name}?`}>
                          Delete
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {admin && (
        <Card>
          <CardHeader title="Add a user" />
          <CardBody>
            <ActionForm action={createUserAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Password" hint="At least 8 characters">
                <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
              </Field>
              <Field label="Role">
                <Select name="role" defaultValue="staff">
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
              <div>
                <SubmitButton>Add user</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
