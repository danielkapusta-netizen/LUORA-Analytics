import { useCallback, useEffect, useState } from 'react'

import { emptyCandidate, type Candidate } from '@/domain/calculator'

const STORAGE_KEY = 'luora-calculator-candidates'

/**
 * The shortlist survives a refresh.
 *
 * Comparing suppliers is not a single sitting — a quote arrives, gets entered,
 * and is weighed against another one hours later. Losing the list to an
 * accidental reload would make the page useless for the job it exists to do.
 *
 * Every access is guarded. Storage throws in private windows and when site
 * data is blocked, and a calculator that refuses to render because it could
 * not read a cache would be a worse failure than simply forgetting. On any
 * fault this degrades to an in-memory list that works for the session.
 */
function readStored(): Candidate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Persisted data is effectively untrusted input: it may predate a change
    // to the shape. Rebuild each entry over a known-good default so a missing
    // or renamed field can never reach the arithmetic as undefined.
    return parsed.flatMap((entry): Candidate[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const record = entry as Partial<Candidate> & { cost?: Partial<Candidate['cost']> }
      const base = emptyCandidate(typeof record.id === 'string' ? record.id : createId())
      return [
        {
          ...base,
          label: typeof record.label === 'string' ? record.label : base.label,
          sellingPricePLN: num(record.sellingPricePLN, base.sellingPricePLN),
          channel: record.channel === 'empik' ? 'empik' : 'allegro',
          commissionRatePct:
            typeof record.commissionRatePct === 'number' && Number.isFinite(record.commissionRatePct)
              ? record.commissionRatePct
              : null,
          cost: {
            ...base.cost,
            supplierUnitPrice: num(record.cost?.supplierUnitPrice, 0),
            currency:
              record.cost?.currency === 'USD' ||
              record.cost?.currency === 'EUR' ||
              record.cost?.currency === 'KRW'
                ? record.cost.currency
                : 'PLN',
            fxRateToPLN: num(record.cost?.fxRateToPLN, 1),
            inboundFreightPLN: num(record.cost?.inboundFreightPLN, 0),
            dutyPLN: num(record.cost?.dutyPLN, 0),
          },
        },
      ]
    })
  } catch {
    return []
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function createId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function useSavedCandidates(): {
  saved: Candidate[]
  save: (candidate: Candidate) => void
  remove: (id: string) => void
  clear: () => void
} {
  // Seeded from storage rather than filled in by an effect.
  //
  // Hydrating in an effect means the component first mounts with an empty
  // list, and the persist effect below then runs in that same commit and
  // writes that empty list straight over the saved shortlist — destroying it
  // on the very reload it exists to survive. A guard flag does not help,
  // because both effects run before either state update is committed.
  // Seeding here removes the ordering problem instead of policing it.
  //
  // Reading during render is safe because `readStored` cannot throw.
  const [saved, setSaved] = useState<Candidate[]>(readStored)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch {
      // Quota or blocked storage — the in-memory list still works.
    }
  }, [saved])

  const save = useCallback((candidate: Candidate) => {
    setSaved((current) => {
      const index = current.findIndex((entry) => entry.id === candidate.id)
      if (index === -1) return [...current, candidate]
      const next = [...current]
      next[index] = candidate
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setSaved((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clear = useCallback(() => setSaved([]), [])

  return { saved, save, remove, clear }
}
