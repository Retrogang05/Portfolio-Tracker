// Wheel & PMCC lifecycle detection.
//
// Operates on the full row set from parseAllCSV (all rowTypes).
//
// PMCC (Poor Man's Covered Call)
//   • Long-dated BTO call (LEAPS, DTE > 60) + short near-term calls same underlying
//   • All options — no equity position needed
//
// Wheel / Covered Call Cycle
//   • Short puts → possible assignment → stock owned → covered calls → possible call-away
//   • Detected when: assignment events exist OR ≥ 2 short-option legs on same underlying

const LEAPS_DTE = 60

// "5/16/26" → Date
function parseExpiry(s) {
  if (!s) return null
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts
  return new Date(2000 + parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
}

function daysBetween(a, b) {
  if (!a || !b) return 0
  return Math.round((b - a) / 86400000)
}

// ── Shared: group individual option rows into per-expiry leg summaries ────────

function buildLegGroups(rows) {
  const byKey = {}
  for (const r of rows) {
    const k = `${r.callPut}|${r.strike}|${r.expiration}`
    if (!byKey[k]) byKey[k] = { rows: [], callPut: r.callPut, strike: r.strike, expiration: r.expiration }
    byKey[k].rows.push(r)
  }

  return Object.values(byKey).map(({ rows, callPut, strike, expiration }) => {
    const opens     = rows.filter(r => r.rowType === 'Trade' && r.openClose === 'Open')
    const closes    = rows.filter(r => r.rowType === 'Trade' && r.openClose === 'Close')
    const expireds  = rows.filter(r => r.rowType === 'Expiration')

    const openAmt   = opens.reduce((s, r) => s + r.amount, 0)
    const closeAmt  = closes.reduce((s, r) => s + r.amount, 0)
    const netPremium = openAmt + closeAmt // expirations contribute $0

    const isClosed  = expireds.length > 0 || closes.length > 0
    const closeType = expireds.length  ? 'Expired'
                    : closes.length    ? 'Closed'
                    : null

    const allDates  = [...opens, ...closes, ...expireds].map(r => r.date).filter(Boolean).sort((a, b) => a - b)

    return {
      callPut,
      strike,
      expiration,
      expiryDate:  parseExpiry(expiration),
      openDate:    opens[0]?.date ?? allDates[0] ?? null,
      closeDate:   isClosed ? (expireds[0]?.date ?? closes.at(-1)?.date ?? null) : null,
      netPremium,
      // isShort: true if the opening action was a SELL (credit leg), false for BUY (debit/long leg).
      // Used by stripSpreadPairs — more reliable than netPremium sign since wings bought for $0
      // have netPremium = 0 which is neither positive nor negative.
      isShort:     opens.some(r => r.action.startsWith('SELL')),
      status:      isClosed ? 'Closed' : 'Open',
      closeType,
    }
  }).sort((a, b) => (a.openDate ?? 0) - (b.openDate ?? 0))
}

// ── PMCC ──────────────────────────────────────────────────────────────────────

function tryDetectPMCC(rows, underlying) {
  const tradeRows = rows.filter(r => r.rowType === 'Trade')

  // Long leg: BTO call with DTE > threshold
  const longCandidates = tradeRows.filter(r =>
    r.callPut === 'CALL' && r.openClose === 'Open' && r.action.startsWith('BUY') &&
    daysBetween(r.date, parseExpiry(r.expiration)) > LEAPS_DTE
  )
  if (!longCandidates.length) return null

  // Most recent long leg
  const longLeg = longCandidates.sort((a, b) => b.date - a.date)[0]
  const longExpiry = parseExpiry(longLeg.expiration)

  // Short calls: all non-long-leg call rows whose expiry ≤ LEAPS expiry
  const shortCallRows = [
    ...tradeRows.filter(r =>
      r.callPut === 'CALL' && r.symbol !== longLeg.symbol &&
      (parseExpiry(r.expiration) ?? new Date(0)) <= longExpiry
    ),
    ...rows.filter(r =>
      r.rowType === 'Expiration' && r.callPut === 'CALL' &&
      (parseExpiry(r.expiration) ?? new Date(0)) <= longExpiry
    ),
  ]

  const shortLegs = buildLegGroups(shortCallRows)
  if (!shortLegs.length) return null

  const premiumCollected = shortLegs.reduce((s, l) => s + l.netPremium, 0)
  const netCost          = longLeg.amount + premiumCollected            // negative = still a debit
  const costPerShare     = Math.abs(netCost) / (longLeg.quantity * 100)
  const breakevenPerShare = longLeg.strike + (netCost < 0 ? costPerShare : -costPerShare)
  const pctRecovered     = Math.min(premiumCollected / Math.abs(longLeg.amount) * 100, 100)

  const longClosed = rows.some(r =>
    r.symbol === longLeg.symbol && (r.action === 'SELL_TO_CLOSE' || r.rowType === 'Expiration')
  )

  return {
    id:         `PMCC-${underlying}`,
    type:       'PMCC',
    underlying,
    status:     (!longClosed || shortLegs.some(l => l.status === 'Open')) ? 'Active' : 'Complete',
    longLeg: {
      symbol:         longLeg.symbol,
      strike:         longLeg.strike,
      expiration:     longLeg.expiration,
      expiryDate:     longExpiry,
      openDate:       longLeg.date,
      cost:           longLeg.amount,
      costPerShare:   Math.abs(longLeg.amount) / (longLeg.quantity * 100),
      quantity:       longLeg.quantity,
      dteAtOpen:      daysBetween(longLeg.date, longExpiry),
    },
    shortLegs,
    premiumCollected,
    netCost,
    costPerShare,
    breakevenPerShare,
    pctRecovered,
  }
}

// ── Wheel / Covered Call Cycle ────────────────────────────────────────────────

// Strategy names that indicate a defined-risk spread — never part of a wheel cycle.
const SPREAD_STRATEGIES = new Set([
  'Iron Condor', 'Iron Butterfly', 'Reverse Iron Condor', 'Reverse Iron Butterfly',
  'Bull Call Spread', 'Bear Call Spread', 'Bull Put Spread', 'Bear Put Spread',
  'Call Calendar', 'Call Diagonal', 'Put Calendar', 'Put Diagonal',
  'Long Straddle', 'Short Straddle', 'Long Strangle', 'Short Strangle',
  'Jade Lizard', 'Inverted Jade Lizard', 'Box Spread', 'Custom Combo',
])

function tryDetectWheel(rows, underlying) {
  // Opening legs tagged as spread strategies give us the contract keys (expiry+strike+callPut)
  // for all legs in those groups. Closing legs and expirations share the same contract key
  // but have strategyGroupId=null, so we filter by contract key — not by group id.
  const spreadContractKeys = new Set()
  for (const r of rows) {
    if (r.strategyName && SPREAD_STRATEGIES.has(r.strategyName) && r.callPut) {
      spreadContractKeys.add(`${r.expiration}|${r.strike}|${r.callPut}`)
    }
  }
  const isSpread = r => r.callPut != null && spreadContractKeys.has(`${r.expiration}|${r.strike}|${r.callPut}`)

  const allTradeRows = rows.filter(r => r.rowType === 'Trade')
  const tradeRows  = allTradeRows.filter(r => !isSpread(r))
  const assignRows = rows.filter(r => r.rowType === 'Assignment')
  const expiryRows = rows.filter(r => r.rowType === 'Expiration' && !isSpread(r))

  // Equity cash flows from assignment/exercise events only.
  // Regular equity Trade rows are excluded — they may include unrelated stock
  // purchases that would distort the wheel P&L.
  const equityRows = rows.filter(r =>
    r.rowType === 'EquityDelivery' ||
    ((r.rowType === 'Assignment' || r.rowType === 'Exercise') && r.instrumentType === 'Equity')
  )

  const shortCalls = tradeRows.filter(r => r.callPut === 'CALL' && r.action.startsWith('SELL') && r.openClose === 'Open')
  const shortPuts  = tradeRows.filter(r => r.callPut === 'PUT'  && r.action.startsWith('SELL') && r.openClose === 'Open')
  const hasAssignments = assignRows.length > 0

  // Equity stock purchases for this underlying (BTO equity trade rows).
  // Used to qualify single-call covered call positions where stock was bought outright
  // rather than acquired via put assignment.
  const hasEquityPurchase = allTradeRows.some(r => r.instrumentType === 'Equity' && r.action === 'BUY_TO_OPEN')

  // A single short put is enough — the user always sells puts as wheel entries.
  // Standalone short-call-only positions need ≥ 2 legs OR clear stock ownership
  // (equity purchase) to avoid misclassifying one-off single calls as wheel cycles.
  const hasWheelActivity = shortPuts.length >= 1 || shortCalls.length >= 2 || hasAssignments ||
    (shortCalls.length >= 1 && hasEquityPurchase)
  if (!hasWheelActivity) return null

  // Wheel leg rows: only short entries (SELL_TO_OPEN) and their closes (BUY_TO_CLOSE).
  // Exclude BUY_TO_OPEN (long legs) and SELL_TO_CLOSE (closing a long) — those are
  // directional trades, not wheel/CC entries. Expiration rows are always included.
  const isWheelLegRow = r =>
    r.rowType !== 'Trade' ||
    (r.action === 'SELL_TO_OPEN') ||
    (r.action === 'BUY_TO_CLOSE')

  const callLegs = buildLegGroups(
    [...tradeRows.filter(r => r.callPut === 'CALL' && isWheelLegRow(r)),
     ...expiryRows.filter(r => r.callPut === 'CALL')]
  )

  const putLegs = buildLegGroups(
    [...tradeRows.filter(r => r.callPut === 'PUT' && isWheelLegRow(r)),
     ...expiryRows.filter(r => r.callPut === 'PUT')]
  )

  // Secondary spread filter: wheel positions are always SHORT (credit) — never debit/long.
  // Removes long legs unconditionally, and strips shorts that are fully paired with longs
  // (those are spread shorts, not wheel entries).
  // Catches both:
  //   • Same-day spreads where identifyStrategy couldn't tag them (different timestamp buckets)
  //   • Lone protective long legs that slipped past the spreadContractKeys filter
  function stripSpreadPairs(legs) {
    const byExpiry = {}
    for (const leg of legs) {
      const k = leg.expiration ?? ''
      if (!byExpiry[k]) byExpiry[k] = []
      byExpiry[k].push(leg)
    }
    const kept = []
    for (const group of Object.values(byExpiry)) {
      const shorts = group.filter(l => l.isShort)
      const longs  = group.filter(l => !l.isShort)
      // No shorts at all (only protective longs) → spread protection only, strip everything
      if (shorts.length === 0) continue
      // Shorts fully paired with longs → defined-risk spread → strip all
      if (longs.length > 0 && shorts.length <= longs.length) continue
      // Keep only the short legs; long legs are never genuine wheel entries
      kept.push(...shorts)
    }
    return kept
  }
  const filteredCallLegs = stripSpreadPairs(callLegs)
  const filteredPutLegs  = stripSpreadPairs(putLegs)

  // Keep the position if assignments exist even with no remaining option legs —
  // the assignment is the key event (e.g. a spread where one leg was assigned).
  if (!filteredCallLegs.length && !filteredPutLegs.length && !hasAssignments) return null

  // Assignment events — two flavours:
  // • Tastytrade: Assignment row has option details (callPut/strike/expiration);
  //   equity delivery is a separate EquityDelivery row linked by date.
  // • IBKR: Assignment row IS the equity delivery (instrumentType='Equity');
  //   callPut is inferred from qty sign (positive = put assignment = bought stock,
  //   negative = call assignment = stock called away), strike = price paid/received.
  const usedEquityRows = new Set()
  const makeAssignment = (r) => {
    const isIBKREquity = r.instrumentType === 'Equity'
    const callPut  = isIBKREquity ? (r.action === 'BUY_TO_OPEN' ? 'PUT' : 'CALL') : r.callPut
    const strike   = isIBKREquity ? r.price : r.strike
    const eq       = isIBKREquity ? r
                   : equityRows.find(e => !usedEquityRows.has(e) && Math.abs(e.date - r.date) < 86400000 * 2) ?? null
    if (!isIBKREquity && eq) usedEquityRows.add(eq)
    return { callPut, strike, expiration: r.expiration ?? '', date: r.date, equity: eq }
  }
  const putAssignments  = assignRows.filter(r =>
    r.callPut === 'PUT' || (r.instrumentType === 'Equity' && r.action === 'BUY_TO_OPEN')
  ).map(makeAssignment)
  const callAssignments = assignRows.filter(r =>
    r.callPut === 'CALL' || (r.instrumentType === 'Equity' && r.action !== 'BUY_TO_OPEN')
  ).map(makeAssignment)

  // Equity P&L only when we have both sides of the round-trip:
  // a negative row (stock acquired via put assignment) AND a positive row (stock disposed).
  // Without both, we'd show either gross proceeds or gross cost — not actual P&L.
  const hasAcquisition  = equityRows.some(r => (r.amount ?? 0) < 0)
  const hasDisposition  = equityRows.some(r => (r.amount ?? 0) > 0)
  const equityPnL = (hasAcquisition && hasDisposition)
    ? equityRows.reduce((s, r) => s + (r.amount ?? 0), 0)
    : 0

  const totalPremium = [...filteredCallLegs, ...filteredPutLegs].reduce((s, l) => s + l.netPremium, 0)
  const hasOpenCall  = filteredCallLegs.some(l => l.status === 'Open')
  const hasOpenPut   = filteredPutLegs.some(l => l.status === 'Open')

  const currentPhase =
    hasOpenCall                ? 'CoveredCall'        :
    hasOpenPut                 ? 'ShortPut'           :
    callAssignments.length     ? 'PostCallAssignment' :
    putAssignments.length      ? 'PostPutAssignment'  :
    'Idle'

  return {
    id:           `WHEEL-${underlying}`,
    type:         (hasAssignments || filteredPutLegs.length) ? 'Wheel' : 'CoveredCall',
    underlying,
    // Active if there are open option legs, or if stock was bought outright
    // (not yet called away via assignment) — shares still held, more CCs to sell.
    status:       hasOpenCall || hasOpenPut || (hasEquityPurchase && !hasAssignments) ? 'Active' : 'Complete',
    currentPhase,
    callLegs:     filteredCallLegs,
    putLegs:      filteredPutLegs,
    callAssignments,
    putAssignments,
    totalPremium,
    equityPnL,
    totalWheelPnL: totalPremium + equityPnL,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function detectWheels(allRows) {
  const underlyings = [...new Set(allRows.map(r => r.underlying).filter(Boolean))]
  const positions = []

  for (const ul of underlyings) {
    const rows = allRows.filter(r => r.underlying === ul)

    // PMCC takes priority — if it matches, skip Wheel check for same underlying
    const pmcc = tryDetectPMCC(rows, ul)
    if (pmcc) { positions.push(pmcc); continue }

    const wheel = tryDetectWheel(rows, ul)
    if (wheel) positions.push(wheel)
  }

  // Sort: Active first, then by underlying name
  return positions.sort((a, b) => {
    if (a.status === b.status) return a.underlying.localeCompare(b.underlying)
    return a.status === 'Active' ? -1 : 1
  })
}
