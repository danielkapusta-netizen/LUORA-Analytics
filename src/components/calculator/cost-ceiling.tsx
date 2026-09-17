import { Trash2 } from 'lucide-react'

import { StatusDot } from '@/components/pricing/blocks'
import { Button } from '@/components/ui/button'
import { TARGET_MARGIN, type Candidate, type CandidateResult } from '@/domain/calculator'
import { formatPercent, formatPLNExact } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The number to walk into a negotiation with.
 *
 * Margin tells you whether a quote works; it does not tell you what to say to
 * the supplier. This does: at the price you intend to list, here is the most
 * the product can cost and still be worth stocking, and here is exactly how
 * far the current quote sits from it.
 */
export function CostCeiling({ result }: { result: CandidateResult }) {
  const target = Math.round(TARGET_MARGIN * 100)

  if (result.maxPayableCostPLN === null) {
    return (
      <p className="t-small text-ink-muted">
        No landed cost clears {target}% at this selling price — VAT and commission take too much of
        it. Raising the price is the only lever here.
      </p>
    )
  }

  const ceiling = result.maxPayableCostPLN
  const over = result.costOverrunPLN
  const headroom = over === null ? ceiling - result.landedCostPLN : 0
  // Both bars share one scale so their lengths are directly comparable.
  const scale = Math.max(ceiling, result.landedCostPLN)

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <Bar
          label={`Most you can pay for ${target}%`}
          value={ceiling}
          scale={scale}
          tone="target"
        />
        <Bar
          label="This supplier's quote"
          value={result.landedCostPLN}
          scale={scale}
          tone={over === null ? 'under' : 'over'}
        />
      </div>

      <div
        className={cn(
          'rounded-xl border px-4 py-3',
          over === null
            ? 'border-positive/25 bg-positive-soft/50'
            : 'border-caution/25 bg-caution-soft/50',
        )}
      >
        {over === null ? (
          <p className="t-small text-ink-muted">
            The quote is{' '}
            <span className="tnum font-semibold text-positive">{formatPLNExact(headroom)}</span>{' '}
            under the ceiling — there is room for freight or the exchange rate to move before this
            stops working.
          </p>
        ) : (
          <p className="t-small text-ink-muted">
            The quote is{' '}
            <span className="tnum font-semibold text-caution">{formatPLNExact(over)}</span> per unit
            too high. Ask for{' '}
            <span className="tnum font-semibold text-ink">{formatPLNExact(ceiling)}</span> landed,
            or list higher.
          </p>
        )}
      </div>
    </div>
  )
}

function Bar({
  label,
  value,
  scale,
  tone,
}: {
  label: string
  value: number
  scale: number
  tone: 'target' | 'under' | 'over'
}) {
  const width = scale > 0 ? (value / scale) * 100 : 0
  return (
    <div className="grid grid-cols-[1fr_88px] items-center gap-3 sm:grid-cols-[200px_1fr_88px]">
      <span className="t-caption text-ink-muted sm:col-span-1">{label}</span>
      <div className="hidden h-5 overflow-hidden rounded-md bg-surface-sunken sm:block">
        <div
          className={cn(
            'h-full rounded-md',
            tone === 'target' && 'bg-ink/25',
            tone === 'under' && 'bg-positive',
            tone === 'over' && 'bg-caution',
          )}
          style={{ width: `${Math.max(1, Math.min(100, width))}%` }}
        />
      </div>
      <span className="tnum text-right t-caption font-medium text-ink">
        {formatPLNExact(value)}
      </span>
    </div>
  )
}

/* ── comparison ─────────────────────────────────────────────────────────── */

/**
 * The shortlist, ranked by what actually matters.
 *
 * Sorted by margin rather than entry order: the point of keeping several
 * candidates is to see which one wins, and a list in the order they happened
 * to be typed makes the reader do that comparison themselves.
 */
export function ComparisonTable({
  entries,
  onRemove,
  onLoad,
}: {
  entries: Array<{ candidate: Candidate; result: CandidateResult }>
  onRemove: (id: string) => void
  onLoad: (candidate: Candidate) => void
}) {
  const ranked = [...entries].sort((a, b) => b.result.marginPct - a.result.marginPct)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead>
          <tr className="t-label text-ink-subtle">
            <th className="w-8 pb-2.5 font-semibold" />
            <th className="pb-2.5 font-semibold">Product</th>
            <th className="pb-2.5 text-right font-semibold">Landed</th>
            <th className="pb-2.5 text-right font-semibold">Price</th>
            <th className="pb-2.5 text-right font-semibold">Profit</th>
            <th className="pb-2.5 text-right font-semibold">Margin</th>
            <th className="w-10 pb-2.5" />
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ candidate, result }) => (
            <tr key={candidate.id} className="border-t border-hairline t-small">
              <td className="py-3">
                <StatusDot status={result.status} />
              </td>
              <td className="py-3">
                <button
                  type="button"
                  onClick={() => onLoad(candidate)}
                  className="press-sm max-w-[240px] truncate text-left font-medium text-ink transition-colors duration-150 hover:text-accent-ink"
                  title="Load this candidate back into the calculator"
                >
                  {candidate.label || 'Untitled product'}
                </button>
                <span className="mt-0.5 block t-micro capitalize text-ink-subtle">
                  {candidate.channel}
                </span>
              </td>
              <td className="tnum py-3 text-right text-ink-muted">
                {formatPLNExact(result.landedCostPLN)}
              </td>
              <td className="tnum py-3 text-right text-ink">
                {formatPLNExact(candidate.sellingPricePLN)}
              </td>
              <td
                className={cn(
                  'tnum py-3 text-right font-medium',
                  result.profitPerUnitPLN >= 0 ? 'text-ink' : 'text-negative',
                )}
              >
                {formatPLNExact(result.profitPerUnitPLN)}
              </td>
              <td
                className={cn(
                  'tnum py-3 text-right font-semibold',
                  result.status === 'green'
                    ? 'text-positive'
                    : result.status === 'yellow'
                      ? 'text-caution'
                      : 'text-negative',
                )}
              >
                {formatPercent(result.marginPct)}
              </td>
              <td className="py-3 text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(candidate.id)}
                  aria-label={`Remove ${candidate.label || 'this candidate'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
