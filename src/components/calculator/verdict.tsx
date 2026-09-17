import { ArrowDownRight, ArrowUpRight, CheckCircle2, CircleSlash, HelpCircle } from 'lucide-react'

import { MarginHealthScale } from '@/components/pricing/blocks'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import type { CandidateResult, MarginBenchmark } from '@/domain/calculator'
import { TARGET_MARGIN } from '@/domain/calculator'
import { formatPercent, formatPLNExact } from '@/lib/format'
import { cn } from '@/lib/utils'

const VERDICT_META = {
  buy: { icon: CheckCircle2, tone: 'positive', badge: 'Worth stocking' },
  negotiate: { icon: ArrowDownRight, tone: 'caution', badge: 'Negotiate the cost' },
  reprice: { icon: ArrowUpRight, tone: 'caution', badge: 'Raise the price' },
  pass: { icon: CircleSlash, tone: 'negative', badge: 'Pass' },
  incomplete: { icon: HelpCircle, tone: 'neutral', badge: 'Incomplete' },
} as const

/**
 * The answer, before any of the working.
 *
 * A founder checking a supplier quote wants a decision first and the
 * arithmetic second, so the verdict leads and the figures support it. The
 * reasons are always shown rather than hidden behind a disclosure: a
 * recommendation whose basis is not visible is one you cannot argue with, and
 * this one is frequently worth arguing with.
 */
export function VerdictCard({
  result,
  benchmark,
}: {
  result: CandidateResult
  benchmark: MarginBenchmark | null
}) {
  const meta = VERDICT_META[result.verdict.kind]
  const Icon = meta.icon
  const target = Math.round(TARGET_MARGIN * 100)

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0',
            meta.tone === 'positive' && 'text-positive',
            meta.tone === 'caution' && 'text-caution',
            meta.tone === 'negative' && 'text-negative',
            meta.tone === 'neutral' && 'text-ink-subtle',
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="t-heading text-ink">{result.verdict.headline}</h3>
            <Badge variant={meta.tone} size="md">
              {meta.badge}
            </Badge>
          </div>
          <ul className="mt-3 space-y-1.5">
            {result.verdict.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 t-small text-ink-muted">
                <span
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-subtle"
                  aria-hidden="true"
                />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!result.isIncomplete && (
        <>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
            <Stat
              label="Margin"
              value={formatPercent(result.marginPct)}
              tone={
                result.marginPct >= target
                  ? 'positive'
                  : result.marginPct > 0
                    ? 'caution'
                    : 'negative'
              }
              caption={`${target}% is the line`}
            />
            <Stat
              label="Profit / unit"
              value={formatPLNExact(result.profitPerUnitPLN)}
              tone={result.profitPerUnitPLN > 0 ? 'positive' : 'negative'}
            />
            <Stat
              label="Break even at"
              value={
                result.breakEvenPricePLN !== null
                  ? formatPLNExact(result.breakEvenPricePLN)
                  : '—'
              }
              caption="lowest viable price"
            />
            <Stat
              label="Landed cost"
              value={formatPLNExact(result.landedCostPLN)}
              caption="goods + freight + duty"
            />
          </dl>

          <div className="border-t border-hairline pt-5">
            <MarginHealthScale health={result.health} />
          </div>

          {benchmark && <BenchmarkStrip benchmark={benchmark} marginPct={result.marginPct} />}
        </>
      )}
    </div>
  )
}

/**
 * The margin measured against the business it would join.
 *
 * A percentage alone cannot answer "is this good for us" — it depends entirely
 * on what the rest of the catalogue returns. Ranking is what converts the
 * number into a judgement the founder can act on.
 */
function BenchmarkStrip({
  benchmark,
  marginPct,
}: {
  benchmark: MarginBenchmark
  marginPct: number
}) {
  const delta = marginPct - benchmark.portfolioMarginPct
  const better = delta >= 0

  return (
    <div className="space-y-3 border-t border-hairline pt-5">
      <p className="t-label text-ink-subtle">Against your catalogue</p>

      <p className="t-small text-ink-muted">
        This would rank{' '}
        <Tooltip
          content={`Beats ${benchmark.beats} of ${benchmark.comparedWith} products that have a known landed cost.`}
        >
          <span className="cursor-help font-semibold text-ink underline decoration-dotted underline-offset-2">
            above {Math.round(benchmark.percentile)}%
          </span>
        </Tooltip>{' '}
        of what you currently sell, and sits{' '}
        <span className={cn('font-semibold', better ? 'text-positive' : 'text-negative')}>
          {better ? '+' : '−'}
          {Math.abs(delta).toFixed(1)}pp
        </span>{' '}
        {better ? 'above' : 'below'} your {formatPercent(benchmark.portfolioMarginPct)} portfolio
        margin.
      </p>

      {/* The candidate placed on the real spread, so "above 60%" is read
          positionally rather than taken on trust. */}
      <div className="relative h-1.5 rounded-full bg-surface-sunken">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            better ? 'bg-positive/30' : 'bg-negative/30',
          )}
          style={{ width: `${Math.min(100, Math.max(0, benchmark.percentile))}%` }}
        />
        <span
          className={cn(
            'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface',
            better ? 'bg-positive' : 'bg-negative',
          )}
          style={{ left: `${Math.min(100, Math.max(0, benchmark.percentile))}%` }}
          aria-hidden="true"
        />
      </div>
      <p className="t-micro text-ink-subtle">
        Median product margin is {formatPercent(benchmark.medianMarginPct)} across{' '}
        {benchmark.comparedWith} costed products.
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  caption,
  tone = 'neutral',
}: {
  label: string
  value: string
  caption?: string
  tone?: 'positive' | 'negative' | 'caution' | 'neutral'
}) {
  return (
    <div>
      <dt className="t-label text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          'tnum mt-1 text-[20px] font-semibold tracking-[-0.02em]',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'caution' && 'text-caution',
          tone === 'neutral' && 'text-ink',
        )}
      >
        {value}
      </dd>
      {caption && <dd className="mt-0.5 t-micro text-ink-subtle">{caption}</dd>}
    </div>
  )
}
