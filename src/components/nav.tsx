'use client';

import { BarChart3, Boxes, LogOut, PackageCheck, Settings, ShoppingBag, Truck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/shipments', label: 'Shipments', icon: Truck },
  { href: '/inventory', label: 'Inventory', icon: Boxes },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Nav({ userName, mock, logoutAction }: { userName: string; mock: boolean; logoutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <aside className="no-print flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:h-screen md:w-56 md:border-r md:border-b-0 md:sticky md:top-0">
      <div className="flex items-center gap-2 px-4 py-4">
        <PackageCheck className="size-6 text-brand-600" />
        <span className="text-base font-semibold tracking-tight">Luora OS</span>
        {mock && <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Demo</span>}
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium',
                active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-slate-100 px-4 py-3 md:block">
        <p className="truncate text-xs text-slate-500">Signed in as</p>
        <p className="truncate text-sm font-medium">{userName}</p>
        <form action={logoutAction}>
          <button className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
