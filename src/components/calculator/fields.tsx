import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Form primitives for the calculator.
 *
 * There is no shared Input component in the codebase — fields are styled
 * inline — so these exist to keep the calculator's many inputs identical to
 * each other and to the simulator field they are modelled on, rather than to
 * introduce a general-purpose abstraction the rest of the app does not use.
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block t-label text-ink-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block t-micro text-ink-subtle">{hint}</span>}
    </label>
  )
}

/**
 * A number field with its unit inside the control.
 *
 * The suffix sits within the input rather than beside it because the unit is
 * part of the value, not a separate piece of information to read. Empty is
 * rendered as an empty string rather than `0`, so a founder clearing a field
 * to retype it does not have to delete a leading zero first.
 */
export function NumberField({
  value,
  onChange,
  suffix,
  step = '0.01',
  placeholder = '0.00',
  emphasis = false,
  ariaLabel,
}: {
  value: number
  onChange: (value: number) => void
  suffix?: string
  step?: string
  placeholder?: string
  emphasis?: boolean
  ariaLabel: string
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        value={value === 0 ? '' : value}
        placeholder={placeholder}
        onChange={(event) => {
          const next = Number(event.target.value.replace(',', '.'))
          onChange(Number.isFinite(next) && next >= 0 ? next : 0)
        }}
        aria-label={ariaLabel}
        className={cn(
          'tnum w-full rounded-control border border-hairline bg-surface text-ink',
          'placeholder:text-ink-subtle',
          'transition-[border-color,box-shadow] duration-150',
          'focus:border-accent/60',
          suffix ? 'pl-3 pr-10' : 'px-3',
          emphasis
            ? 'h-11 text-[18px] font-semibold tracking-[-0.02em]'
            : 'h-9 text-[14px] tracking-[-0.003em]',
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 t-small text-ink-subtle">
          {suffix}
        </span>
      )}
    </div>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={cn(
        'h-9 w-full rounded-control border border-hairline bg-surface px-3',
        'text-[14px] tracking-[-0.003em] text-ink placeholder:text-ink-subtle',
        'transition-[border-color] duration-150 focus:border-accent/60',
      )}
    />
  )
}
