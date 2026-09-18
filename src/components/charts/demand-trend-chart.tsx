import { useId } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { CatalogueTrendPoint } from '@/domain/catalogue'
import { formatMonthShort, formatNumber, formatPLN } from '@/lib/format'

/**
 * How often a row sold, month by month — the companion to the margin chart it
 * sits beneath.
 *
 * Margin and demand answer different halves of the same question, and either
 * alone misleads: a margin can improve precisely because a product stopped
 * selling at a discount, which reads as good news until you see the volume
 * that went with it. Stacking the two on a shared month axis lets one be read
 * against the other.
 *
 * Both series share **one** y-axis, unlike the margin chart above. That chart
 * splits its axes because a percentage and a złoty price cannot share a scale.
 * Orders and units are the same unit, and units is always at least orders —
 * independent axes could render units *below* orders and invent a relationship
 * that does not exist. On one scale the gap between the lines is itself the
 * reading: it is how often customers buy more than one.
 */
export function DemandTrendChart({
  history,
  height = 200,
}: {
  history: readonly CatalogueTrendPoint[]
  height?: number
}) {
  const gradientId = useId()
  if (history.length < 2) return null

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={[...history]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />

          <XAxis
            dataKey="date"
            tickFormatter={formatMonthShort}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            dy={6}
            minTickGap={16}
          />

          {/* Counts have no halves — an axis ticking "2.5 orders" is a lie. */}
          <YAxis
            allowDecimals={false}
            tickFormatter={(value: number) => formatNumber(value)}
            width={46}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
          />

          <Tooltip
            cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as CatalogueTrendPoint | undefined
              if (!point) return null
              return (
                <div className="min-w-[180px] rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                  <p className="t-caption font-semibold text-ink">{formatMonthShort(point.date)}</p>
                  <dl className="mt-2 space-y-1.5">
                    <TooltipRow label="Orders" value={formatNumber(point.orders)} />
                    <TooltipRow label="Units" value={formatNumber(point.units)} />
                    <TooltipRow
                      label="Units per order"
                      value={point.orders > 0 ? (point.units / point.orders).toFixed(2) : '—'}
                    />
                    <TooltipRow label="Revenue" value={formatPLN(point.revenuePLN)} />
                  </dl>
                </div>
              )
            }}
          />

          {/* Units sits behind orders, dashed, exactly as unit price does on
              the margin chart — the secondary series in both. */}
          <Line
            type="monotone"
            dataKey="units"
            stroke="var(--caution)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />

          <Area
            type="monotone"
            dataKey="orders"
            stroke="var(--accent)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--accent)' }}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
            animationDuration={500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="t-caption text-ink-muted">{label}</dt>
      <dd className="tnum t-caption font-medium text-ink">{value}</dd>
    </div>
  )
}
