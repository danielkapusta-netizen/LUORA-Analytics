import { motion } from 'framer-motion'
import { Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { CandidateForm } from '@/components/calculator/candidate-form'
import { ComparisonTable, CostCeiling } from '@/components/calculator/cost-ceiling'
import { VerdictCard } from '@/components/calculator/verdict'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { MarginTargets, ProfitWaterfall } from '@/components/pricing/blocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  TARGET_MARGIN,
  buildMarginBenchmark,
  channelCommissionRates,
  emptyCandidate,
  evaluateCandidate,
  type Candidate,
} from '@/domain/calculator'
import { useSnapshot } from '@/hooks/use-snapshot'
import { createId, useSavedCandidates } from '@/hooks/use-saved-candidates'
import { formatPercent } from '@/lib/format'
import { rise, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The sourcing decision, made before the product exists in the business.
 *
 * Every other pricing surface here reports on what already happened. This one
 * is used with a supplier's page open in another tab, and answers a single
 * question: if I buy this at that cost and list it at this price, is it worth
 * stocking?
 *
 * It recomputes as you type rather than behind a "Calculate" button. The
 * arithmetic is instant, so making someone ask for it would add a step that
 * buys nothing — and watching the margin move while adjusting a price is how
 * the shape of the trade-off becomes obvious.
 */
export function CalculatorPage() {
  const { context, snapshot, isLoading, isError, error, refetch } = useSnapshot()
  const { saved, save, remove, clear } = useSavedCandidates()

  const [candidate, setCandidate] = useState<Candidate>(() => emptyCandidate(createId()))

  // Commission comes from the founder's own realised rates. The calculator
  // still works without them — the page must not be held hostage by the feed
  // when its core job is arithmetic on numbers the user typed.
  const rates = useMemo(
    () => channelCommissionRates(context?.orders ?? []),
    [context?.orders],
  )

  const result = useMemo(
    () => evaluateCandidate(candidate, { rates }),
    [candidate, rates],
  )

  const benchmark = useMemo(
    () =>
      snapshot && !result.isIncomplete
        ? buildMarginBenchmark(snapshot.products, result.marginPct)
        : null,
    [snapshot, result.isIncomplete, result.marginPct],
  )

  const savedResults = useMemo(
    () => saved.map((entry) => ({ candidate: entry, result: evaluateCandidate(entry, { rates }) })),
    [saved, rates],
  )

  // Deliberately no loading gate.
  //
  // Nothing the calculator computes depends on the network — it is arithmetic
  // on numbers the founder just typed. Holding the page behind a skeleton
  // while a spreadsheet fetch retries would make them wait for data they are
  // not using, with a supplier's page open in the next tab. The sales data
  // only enriches two things: the measured commission default and the
  // catalogue comparison, and both say so when they are not ready.
  const dataUnavailable = isError || (!context && !isLoading)

  const target = Math.round(TARGET_MARGIN * 100)
  const isSaved = saved.some((entry) => entry.id === candidate.id)

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Calculator"
        title="Will this product make money?"
        description={
          <>
            Enter what a supplier is quoting and what you would list it at. Everything is worked out
            with the same VAT and commission model your live products are measured on, so a product
            checked here will report the same margin once it starts selling.
          </>
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => setCandidate(emptyCandidate(createId()))}
            aria-label="Clear the calculator and start a new product"
          >
            <RotateCcw className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
            New product
          </Button>
        }
      />

      {dataUnavailable && (
        <Card className="border-caution/30 bg-caution-soft/40">
          <div className="p-5">
            <p className="t-strong text-ink">Working without your sales data</p>
            <p className="mt-1.5 t-small text-ink-muted">
              {error?.message ?? 'The data source could not be reached.'} The calculator still works
              — commission falls back to a 15% default you can override, and the catalogue
              comparison is unavailable until the connection returns.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={refetch}>
              Try again
            </Button>
          </div>
        </Card>
      )}

      {/* ── input + answer, side by side ──────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <motion.div {...rise(0)}>
          <Card className="h-full">
            <div className="p-6">
              <SectionHeading
                title="The product"
                description="As the supplier quotes it."
              />
              <div className="mt-6">
                <CandidateForm
                  candidate={candidate}
                  onChange={setCandidate}
                  rates={rates}
                  ratesLoading={isLoading}
                />
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div {...rise(1)}>
          <Card
            className={cn(
              'h-full transition-shadow duration-300',
              !result.isIncomplete && 'shadow-lifted',
            )}
          >
            <div className="p-6">
              <VerdictCard result={result} benchmark={benchmark} />

              {!result.isIncomplete && (
                <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-hairline pt-5">
                  <Button
                    variant={isSaved ? 'secondary' : 'primary'}
                    onClick={() => save(candidate)}
                    disabled={isSaved && savedMatches(saved, candidate)}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {isSaved ? 'Update in comparison' : 'Add to comparison'}
                  </Button>
                  {result.suggestedPricePLN !== null &&
                    result.marginPct < TARGET_MARGIN * 100 && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setCandidate((current) => ({
                            ...current,
                            sellingPricePLN: result.suggestedPricePLN ?? current.sellingPricePLN,
                          }))
                        }
                      >
                        Try {result.suggestedPricePLN.toFixed(2)} zł
                      </Button>
                    )}
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      </section>

      {/* ── the working ───────────────────────────────────────────────── */}
      {!result.isIncomplete && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="space-y-6"
        >
          <SectionHeading
            title="Where the money goes"
            description={`Per unit, at your intended price. ${target}% is the margin a new listing should clear.`}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Block
              title="Profit waterfall"
              description="Every złoty of the selling price, and what survives to profit."
            >
              {result.waterfall ? <ProfitWaterfall steps={result.waterfall} /> : null}
            </Block>

            <Block
              title="Cost ceiling"
              description="What you can afford to pay, and what you are being asked for."
            >
              <CostCeiling result={result} />
            </Block>
          </div>

          <Block
            title="Price targets"
            description="The price this product needs to reach each margin, at this landed cost and commission."
          >
            <MarginTargets
              targets={result.targets}
              currentPricePLN={candidate.sellingPricePLN}
              hasCost={result.landedCostPLN > 0}
              currentLabel="Your intended selling price"
              isHealthyNow={result.marginPct >= 10}
              missingCostNote="Enter a supplier cost to see the price each margin needs."
            />
          </Block>
        </motion.section>
      )}

      {/* ── comparison ────────────────────────────────────────────────── */}
      {savedResults.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="space-y-4"
        >
          <SectionHeading
            title="Candidates"
            description="Ranked by margin. Select a name to load it back into the calculator."
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="neutral" size="md">
                  {savedResults.length} saved
                </Badge>
                <Button variant="ghost" size="sm" onClick={clear}>
                  Clear all
                </Button>
              </div>
            }
          />
          <Card className="overflow-hidden">
            <div className="p-5">
              <ComparisonTable
                entries={savedResults}
                onRemove={remove}
                onLoad={setCandidate}
              />
            </div>
          </Card>
          <p className="t-micro text-ink-subtle">
            Saved in this browser only — the shortlist is not written back to your sheet.
            {benchmark &&
              ` Your catalogue averages ${formatPercent(benchmark.portfolioMarginPct)}.`}
          </p>
        </motion.section>
      )}
    </div>
  )
}

/** True when the saved copy is already identical — nothing to update. */
function savedMatches(saved: readonly Candidate[], candidate: Candidate): boolean {
  const existing = saved.find((entry) => entry.id === candidate.id)
  return existing ? JSON.stringify(existing) === JSON.stringify(candidate) : false
}

function Block({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="t-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">{title}</p>
        {description && <p className="mt-1 t-caption text-ink-subtle">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </Card>
  )
}
