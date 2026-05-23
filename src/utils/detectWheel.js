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

function tryDetectWheel(rows, underlying) {
  const tradeRows  = rows.filter(r => r.rowType === 'Trade')
  const assignRows = rows.filter(r => r.rowType === 'Assignment')
  const equityRows = rows.filter(r => r.rowType === 'EquityDelivery')
  const expiryRows = rows.filter(r => r.rowType === 'Expiration')

  const shortCalls = tradeRows.filter(r => r.callPut === 'CALL' && r.action.startsWith('SELL') && r.openClose === 'Open')
  const shortPuts  = tradeRows.filter(r => r.callPut === 'PUT'  && r.action.startsWith('SELL') && r.openClose === 'Open')

  const hasAssignments = assignRows.length > 0
  // A single short put is enough — the user always sells puts as wheel entries.
  // Standalone short-call-only positions still need ≥ 2 legs to avoid
  // misclassifying one-off covered calls as wheel cycles.
  const hasWheelActivity = shortPuts.length >= 1 || shortCalls.length >= 2 || hasAssignments
  if (!hasWheelActivity) return null

  // Build call legs (short side only)
  const callLegRows = [
    ...tradeRows.filter(r => r.callPut === 'CALL'),
    ...expiryRows.filter(r => r.callPut === 'CALL'),
  ]
  const callLegs = buildLegGroups(
    callLegRows.filter(r => r.rowType !== 'Trade' || r.action?.startsWith('SELL') || r.openClose === 'Close')
  )

  // Build put legs (short side only)
  const putLegRows = [
    ...tradeRows.filter(r => r.callPut === 'PUT'),
    ...expiryRows.filter(r => r.callPut === 'PUT'),
  ]
  const putLegs = buildLegGroups(
    putLegRows.filter(r => r.rowType !== 'Trade' || r.action?.startsWith('SELL') || r.openClose === 'Close')
  )

  if (!callLegs.length && !putLegs.length) return null

  // Assignment events — link to equity delivery that followed within 1 day
  const makeAssignment = (r) => ({
    callPut:      r.callPut,
    strike:       r.strike,
    expiration:   r.expiration,
    date:         r.date,
    // Find the equity row that settled on the same day (±1 day)
    equity: equityRows.find(e => Math.abs(e.date - r.date) < 86400000 * 2) ?? null,
  })
  const callAssignments = assignRows.filter(r => r.callPut === 'CALL').map(makeAssignment)
  const putAssignments  = assignRows.filter(r => r.callPut === 'PUT').map(makeAssignment)

  const totalPremium = [...callLegs, ...putLegs].reduce((s, l) => s + l.netPremium, 0)
  const hasOpenCall  = callLegs.some(l => l.status === 'Open')
  const hasOpenPut   = putLegs.some(l => l.status === 'Open')

  const currentPhase =
    hasOpenCall          ? 'CoveredCall' :
    hasOpenPut           ? 'ShortPut'    :
    callAssignments.length ? 'PostCallAssignment' :
    putAssignments.length  ? 'PostPutAssignment'  :
    'Idle'

  return {
    id:           `WHEEL-${underlying}`,
    type:         (hasAssignments || putLegs.length) ? 'Wheel' : 'CoveredCall',
    underlying,
    status:       hasOpenCall || hasOpenPut ? 'Active' : 'Complete',
    currentPhase,
    callLegs,
    putLegs,
    callAssignments,
    putAssignments,
    totalPremium,
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
