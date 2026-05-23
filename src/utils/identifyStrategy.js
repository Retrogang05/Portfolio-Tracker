// Strategy detection for multi-leg options trades.
// Groups opening legs by Order # (primary) or by same-second timestamp + underlying (fallback),
// then classifies the structure into a known strategy name.

const isBuy = l => l.action.startsWith('BUY')
const isSell = l => l.action.startsWith('SELL')

function groupKey(row) {
  // Order # is the definitive link for multi-leg orders placed together
  if (row.orderId) return row.orderId
  // Fallback: same second + same underlying = same strategy entry
  return `${row.timestampSec}|${row.underlying}`
}

function classifyLegs(legs) {
  const calls = legs.filter(l => l.callPut === 'CALL').sort((a, b) => a.strike - b.strike)
  const puts  = legs.filter(l => l.callPut === 'PUT').sort((a, b) => a.strike - b.strike)
  const n = legs.length

  // ── Single leg ──────────────────────────────────────────────────────────────
  if (n === 1) {
    const [l] = legs
    if (l.callPut === 'CALL') return isBuy(l) ? 'Long Call' : 'Short Call'
    // Standalone short puts are treated as Wheel (CSP) entries by default.
    // Multi-leg puts (spreads, condors) never reach this branch.
    return isBuy(l) ? 'Long Put' : 'Wheel (CSP)'
  }

  // ── Two legs ────────────────────────────────────────────────────────────────
  if (n === 2) {
    // Both calls
    if (calls.length === 2) {
      const [lo, hi] = calls
      const sameExpiry = lo.expiration === hi.expiration
      if (!sameExpiry) return isBuy(lo) ? 'Call Calendar' : 'Call Diagonal'
      if (isBuy(lo)  && isSell(hi)) return 'Bull Call Spread'
      if (isSell(lo) && isBuy(hi))  return 'Bear Call Spread'
    }
    // Both puts
    if (puts.length === 2) {
      const [lo, hi] = puts
      const sameExpiry = lo.expiration === hi.expiration
      if (!sameExpiry) return isSell(hi) ? 'Put Calendar' : 'Put Diagonal'
      if (isSell(lo) && isBuy(hi))  return 'Bear Put Spread'
      if (isBuy(lo)  && isSell(hi)) return 'Bull Put Spread'
    }
    // One call + one put
    if (calls.length === 1 && puts.length === 1) {
      const [call] = calls, [put] = puts
      const callBuy = isBuy(call), putBuy = isBuy(put)
      const sameStrike = call.strike === put.strike
      if (callBuy  && putBuy)  return sameStrike ? 'Long Straddle'  : 'Long Strangle'
      if (!callBuy && !putBuy) return sameStrike ? 'Short Straddle' : 'Short Strangle'
      if (callBuy  && !putBuy) return 'Risk Reversal'
      /* !callBuy && putBuy */ return 'Synthetic Short'
    }
  }

  // ── Three legs ──────────────────────────────────────────────────────────────
  if (n === 3) {
    // Jade Lizard: Sell OTM Put + Bull Call Spread (sell lo call + buy hi call)
    if (puts.length === 1 && calls.length === 2) {
      const [put] = puts, [loCall, hiCall] = calls
      if (isSell(put) && isSell(loCall) && isBuy(hiCall))  return 'Jade Lizard'
      if (isSell(put) && isBuy(loCall)  && isSell(hiCall)) return 'Bull Call Spread + Short Put'
    }
    // Inverted Jade Lizard: Sell OTM Call + Bear Put Spread (buy hi put + sell lo put)
    if (calls.length === 1 && puts.length === 2) {
      const [call] = calls, [loPut, hiPut] = puts
      if (isSell(call) && isBuy(hiPut)  && isSell(loPut)) return 'Inverted Jade Lizard'
      if (isSell(call) && isSell(hiPut) && isBuy(loPut))  return 'Bear Put Spread + Short Call'
    }
  }

  // ── Four legs ────────────────────────────────────────────────────────────────
  if (n === 4 && calls.length === 2 && puts.length === 2) {
    const [loPut, hiPut] = puts, [loCall, hiCall] = calls
    const loPutB = isBuy(loPut), hiPutB = isBuy(hiPut)
    const loCallB = isBuy(loCall), hiCallB = isBuy(hiCall)

    // Iron Condor / Iron Butterfly:  Buy loPut · Sell hiPut · Sell loCall · Buy hiCall
    if (loPutB && !hiPutB && !loCallB && hiCallB) {
      return hiPut.strike === loCall.strike ? 'Iron Butterfly' : 'Iron Condor'
    }
    // Reverse Iron Condor: Sell loPut · Buy hiPut · Buy loCall · Sell hiCall
    if (!loPutB && hiPutB && loCallB && !hiCallB) {
      return hiPut.strike === loCall.strike ? 'Reverse Iron Butterfly' : 'Reverse Iron Condor'
    }
    // Box spread: Bull Call Spread + Bear Put Spread on same strikes
    if (isBuy(loCall) && isSell(hiCall) && isSell(loPut) && isBuy(hiPut)) {
      if (loCall.strike === loPut.strike && hiCall.strike === hiPut.strike) return 'Box Spread'
    }
  }

  return 'Custom Combo'
}

// ── Strategy name registry ───────────────────────────────────────────────────
// Single source of truth — used by the detector AND the override dropdown.
export const STRATEGY_NAMES = [
  // Single leg
  'Long Call',
  'Short Call',
  'Long Put',
  'Wheel (CSP)',   // default for standalone short puts
  'Short Put',     // override option if it's genuinely not a wheel entry
  // Vertical spreads
  'Bull Call Spread',
  'Bear Call Spread',
  'Bull Put Spread',
  'Bear Put Spread',
  // Calendar / Diagonal
  'Call Calendar',
  'Call Diagonal',
  'Put Calendar',
  'Put Diagonal',
  // Volatility
  'Long Straddle',
  'Short Straddle',
  'Long Strangle',
  'Short Strangle',
  // Directional combos
  'Risk Reversal',
  'Synthetic Short',
  // Tastytrade favourites
  'Jade Lizard',
  'Inverted Jade Lizard',
  'Bull Call Spread + Short Put',
  'Bear Put Spread + Short Call',
  // Four-leg
  'Iron Condor',
  'Iron Butterfly',
  'Reverse Iron Condor',
  'Reverse Iron Butterfly',
  'Box Spread',
  // Catch-all
  'Custom Combo',
]

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Annotates every row with `strategyName` and `strategyGroupId`.
 * Strategy is determined from the opening legs; closing legs inherit the
 * strategy via the matched open's strategyGroupId (handled in calculatePnL).
 */
export function tagRowsWithStrategy(rows) {
  // Only opening trade rows participate in strategy detection
  const openRows = rows.filter(r => r.openClose === 'Open' && !r.isExpiration)

  // Group opening legs
  const groups = {} // groupKey → [row, ...]
  for (const row of openRows) {
    const k = groupKey(row)
    if (!groups[k]) groups[k] = []
    groups[k].push(row)
  }

  // Classify each group
  const strategyByKey = {}
  for (const [k, legs] of Object.entries(groups)) {
    strategyByKey[k] = classifyLegs(legs)
  }

  // Annotate rows
  return rows.map(row => {
    if (row.openClose !== 'Open' || row.isExpiration) {
      return { ...row, strategyName: null, strategyGroupId: null }
    }
    const k = groupKey(row)
    return {
      ...row,
      strategyName: strategyByKey[k] ?? 'Unknown',
      strategyGroupId: k,
    }
  })
}
