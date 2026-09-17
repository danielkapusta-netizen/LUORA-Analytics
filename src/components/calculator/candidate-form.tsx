import { Field, NumberField, TextField } from '@/components/calculator/fields'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import {
  SOURCE_CURRENCIES,
  costParts,
  type Candidate,
  type ChannelRate,
  type CostInput,
} from '@/domain/calculator'
import type { Channel } from '@/domain/types'
import { formatPercent, formatPLNExact } from '@/lib/format'

const CHANNELS: Array<{ value: Channel; label: string }> = [
  { value: 'allegro', label: 'Allegro' },
  { value: 'empik', label: 'Empik' },
]

/**
 * What you are looking at, as the quote presents it.
 *
 * Cost is entered in three parts because that is how a supplier quotes it —
 * a unit price, freight, and whatever the customs agent adds. Asking for a
 * single "landed cost" would make the founder do that arithmetic in their head
 * before the tool that exists to do arithmetic could help. The running total
 * sits directly beneath the fields that produce it, so the relationship
 * between the parts and the number that actually drives margin is visible
 * rather than implied.
 */
export function CandidateForm({
  candidate,
  onChange,
  rates,
  ratesLoading = false,
}: {
  candidate: Candidate
  onChange: (next: Candidate) => void
  rates: Record<Channel, ChannelRate>
  /** True while the measured rate is still being fetched. */
  ratesLoading?: boolean
}) {
  const parts = costParts(candidate.cost)
  const isForeign = candidate.cost.currency !== 'PLN'
  const symbol =
    SOURCE_CURRENCIES.find((entry) => entry.value === candidate.cost.currency)?.symbol ?? 'zł'
  const channelRate = rates[candidate.channel]

  const setCost = (patch: Partial<CostInput>) =>
    onChange({ ...candidate, cost: { ...candidate.cost, ...patch } })

  return (
    <div className="space-y-6">
      <Field label="Product" hint="Just for your own reference in the comparison table.">
        <TextField
          value={candidate.label}
          onChange={(label) => onChange({ ...candidate, label })}
          placeholder="e.g. Beauty of Joseon Relief Sun SPF50"
          ariaLabel="Product name"
        />
      </Field>

      {/* ── what it costs you ── */}
      <div className="space-y-4 rounded-card border border-hairline bg-surface-sunken/40 p-4">
        <p className="t-label text-ink-subtle">What it costs you</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier unit price">
            <NumberField
              value={candidate.cost.supplierUnitPrice}
              onChange={(supplierUnitPrice) => setCost({ supplierUnitPrice })}
              suffix={symbol}
              ariaLabel="Supplier unit price"
            />
          </Field>

          <Field label="Currency" className="min-w-0">
            <Segmented
              options={SOURCE_CURRENCIES.map((entry) => ({
                value: entry.value,
                label: entry.label,
              }))}
              value={candidate.cost.currency}
              onChange={(currency) =>
                setCost({ currency, fxRateToPLN: currency === 'PLN' ? 1 : candidate.cost.fxRateToPLN })
              }
              aria-label="Supplier currency"
              className="flex w-full max-w-full overflow-x-auto"
            />
          </Field>
        </div>

        {/* The rate sits immediately beside the price it converts — a control
            belongs next to the thing it affects. */}
        {isForeign && (
          <Field
            label={`Exchange rate — PLN per 1 ${candidate.cost.currency}`}
            hint={
              parts.goodsPLN > 0
                ? `${candidate.cost.supplierUnitPrice} ${candidate.cost.currency} = ${formatPLNExact(parts.goodsPLN)}`
                : 'Enter the rate your bank actually gives you, not the mid-market rate.'
            }
          >
            <NumberField
              value={candidate.cost.fxRateToPLN}
              onChange={(fxRateToPLN) => setCost({ fxRateToPLN })}
              suffix="zł"
              step="0.0001"
              placeholder="0.0000"
              ariaLabel="Exchange rate to PLN"
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Inbound freight / unit" hint="Shipping the stock to you, per unit.">
            <NumberField
              value={candidate.cost.inboundFreightPLN}
              onChange={(inboundFreightPLN) => setCost({ inboundFreightPLN })}
              suffix="zł"
              ariaLabel="Inbound freight per unit in PLN"
            />
          </Field>
          <Field label="Duty & customs / unit" hint="Import duty, VAT handling, agent fees.">
            <NumberField
              value={candidate.cost.dutyPLN}
              onChange={(dutyPLN) => setCost({ dutyPLN })}
              suffix="zł"
              ariaLabel="Duty and customs per unit in PLN"
            />
          </Field>
        </div>

        <div className="flex items-baseline justify-between border-t border-hairline pt-3">
          <span className="t-caption font-medium text-ink-muted">Landed cost per unit</span>
          <span className="tnum text-[18px] font-semibold tracking-[-0.02em] text-ink">
            {formatPLNExact(parts.totalPLN)}
          </span>
        </div>
      </div>

      {/* ── what you'd charge ── */}
      <div className="space-y-4 rounded-card border border-hairline bg-surface-sunken/40 p-4">
        <p className="t-label text-ink-subtle">What you would charge</p>

        <Field label="Intended selling price" hint="The gross price a customer pays, VAT included.">
          <NumberField
            value={candidate.sellingPricePLN}
            onChange={(sellingPricePLN) => onChange({ ...candidate, sellingPricePLN })}
            suffix="zł"
            step="0.10"
            emphasis
            ariaLabel="Intended selling price in PLN"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Channel">
            <Segmented
              options={CHANNELS}
              value={candidate.channel}
              onChange={(channel) => onChange({ ...candidate, channel })}
              aria-label="Sales channel"
              className="w-full"
            />
          </Field>

          <Field
            label="Commission"
            hint={
              candidate.commissionRatePct === null ? (
                <Tooltip
                  content={
                    ratesLoading
                      ? 'Reading your recent sales to measure the rate you actually pay. A 15% default applies until it arrives.'
                      : channelRate.measured
                        ? `Measured from ${channelRate.sampleLines} of your own ${candidate.channel} lines — commission over gross revenue.`
                        : 'No sales on this channel yet, so a 15% market default is assumed.'
                  }
                >
                  <span className="cursor-help underline decoration-dotted underline-offset-2">
                    {ratesLoading
                      ? 'Checking your rate…'
                      : `${channelRate.measured ? 'Your actual rate' : 'Assumed default'} — ${formatPercent(channelRate.rate * 100)}`}
                  </span>
                </Tooltip>
              ) : (
                <button
                  type="button"
                  onClick={() => onChange({ ...candidate, commissionRatePct: null })}
                  className="press-sm underline decoration-dotted underline-offset-2 hover:text-ink-muted"
                >
                  Reset to your actual rate
                </button>
              )
            }
          >
            <NumberField
              value={
                candidate.commissionRatePct ?? Number((channelRate.rate * 100).toFixed(1))
              }
              onChange={(commissionRatePct) => onChange({ ...candidate, commissionRatePct })}
              suffix="%"
              step="0.1"
              ariaLabel="Marketplace commission rate percent"
            />
          </Field>
        </div>
      </div>
    </div>
  )
}
