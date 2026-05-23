// Match opening and closing trades, compute realized P&L, and group into strategies.
//
// Tastytrade Total column = net cash flow (Value + Commissions + Fees):
//   Sell to Open  → positive (credit received)
//   Buy to Close  → negative (debit paid)
//   Expiration    → $0 (expired worthless)
//
// Realized P&L per leg = open Total + close Total
// Strategy P&L         = sum of all leg P&Ls for that strategy group

export function buildTrades(rows) {
  const opens  = rows.filter(r => r.openClose === 'Open')
  const closes = rows.filter(r => r.openClose === 'Close')

  // Match key: underlying + expiration + strike + callPut (sufficient for unique contract id)
  const legKey = r => `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`

  // Group opens by leg key (FIFO queue per contract)
  const openMap = {}
  for (const o of opens) {
    const k = legKey(o)
    if (!openMap[k]) openMap[k] = []
    openMap[k].push({ ...o, remainingQty: o.quantity })
  }

  const closedLegs   = []
  const unmatchedCloses = []

  for (const c of closes) {
    const k = legKey(c)
    const queue = openMap[k] || []
    let remaining = c.quantity

    while (remaining > 0 && queue.length > 0) {
      const open = queue[0]
      const matched  = Math.min(open.remainingQty, remaining)
      const openFrac = matched / open.quantity
      const closeFrac = matched / c.quantity

      const openAmount  = open.amount * openFrac
      const closeAmount = c.amount   * closeFrac
      const pnl = openAmount + closeAmount

      closedLegs.push({
        // Contract details
        underlying:    c.underlying,
        callPut:       c.callPut,
        strike:        c.strike,
        expiration:    c.expiration,
        quantity:      matched,
        // Dates
        openDate:      open.date,
        closeDate:     c.date,
        daysHeld:      Math.max(0, Math.round((c.date - open.date) / 86400000)),
        // Sub-type labels
        openSubType:   open.subType,
        closeSubType:  c.isExpiration ? 'Expired' : c.subType,
        isExpiration:  c.isExpiration,
        // Prices
        openPrice:     open.price,
        closePrice:    c.price,
        openAmount,
        closeAmount,
        // P&L
        pnl,
        isWin: pnl > 0,
        // Strategy (from the opening leg — closing legs inherit via group)
        strategyName:    open.strategyName    ?? 'Unknown',
        strategyGroupId: open.strategyGroupId ?? open.orderId ?? legKey(open),
      })

      open.remainingQty -= matched
      remaining -= matched
      if (open.remainingQty <= 0) queue.shift()
    }

    if (remaining > 0) unmatchedCloses.push({ ...c, unmatchedQty: remaining })
  }

  const openPositions = Object.values(openMap).flat().filter(o => o.remainingQty > 0)

  // Group closed legs into strategy-level trades
  const closedTrades = groupLegsIntoTrades(closedLegs)

  return { closedTrades, closedLegs, openPositions, unmatchedCloses }
}

/**
 * Merges individual legs that share a strategyGroupId + closeDate into one
 * strategy trade record with aggregate P&L.  Single-leg trades are passed through.
 */
function groupLegsIntoTrades(legs) {
  // Two legs belong to the same strategy trade if they share a strategyGroupId.
  // A single strategy can be closed in multiple separate orders (different close dates),
  // so we also group on close date to avoid merging roll attempts.
  const groups = {}
  for (const leg of legs) {
    // Group by strategyGroupId + close-date (ISO date string, not time)
    const closeDateStr = leg.closeDate.toISOString().split('T')[0]
    const k = `${leg.strategyGroupId}||${closeDateStr}`
    if (!groups[k]) groups[k] = []
    groups[k].push(leg)
  }

  return Object.values(groups).map(group => {
    if (group.length === 1) return { ...group[0], legs: group }

    const pnl = group.reduce((s, l) => s + l.pnl, 0)
    const first = group[0]
    const openDates  = group.map(l => l.openDate)
    const closeDates = group.map(l => l.closeDate)

    return {
      // Use the earliest open / latest close across legs
      underlying:      first.underlying,
      strategyName:    first.strategyName,
      strategyGroupId: first.strategyGroupId,
      openDate:        new Date(Math.min(...openDates)),
      closeDate:       new Date(Math.max(...closeDates)),
      daysHeld:        Math.max(...group.map(l => l.daysHeld)),
      isExpiration:    group.every(l => l.isExpiration),
      pnl,
      isWin: pnl > 0,
      // Multi-leg: no single strike/callPut — consumers check legs[]
      callPut:    group.length === 1 ? first.callPut    : null,
      strike:     group.length === 1 ? first.strike     : null,
      expiration: group.length === 1 ? first.expiration : null,
      openPrice:  group.length === 1 ? first.openPrice  : null,
      closePrice: group.length === 1 ? first.closePrice : null,
      legs: group,
    }
  })
}

export function computeStats(closedTrades) {
  if (!closedTrades.length) return null

  const totalPnL = closedTrades.reduce((s, t) => s + t.pnl, 0)
  const wins     = closedTrades.filter(t => t.isWin)
  const losses   = closedTrades.filter(t => !t.isWin)
  const winRate  = (wins.length / closedTrades.length) * 100
  const avgWin   = wins.length   ? wins.reduce((s, t)   => s + t.pnl, 0) / wins.length   : 0
  const avgLoss  = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const largestWin  = wins.length   ? Math.max(...wins.map(t   => t.pnl)) : 0
  const largestLoss = losses.length ? Math.min(...losses.map(t => t.pnl)) : 0

  // Cumulative P&L over time (by close date)
  const sorted = [...closedTrades].sort((a, b) => a.closeDate - b.closeDate)
  let cumulative = 0
  const cumulativeData = sorted.map(t => {
    cumulative += t.pnl
    return {
      date:       t.closeDate.toISOString().split('T')[0],
      cumPnL:     parseFloat(cumulative.toFixed(2)),
      pnl:        parseFloat(t.pnl.toFixed(2)),
      underlying: t.underlying,
      strategy:   t.strategyName,
    }
  })

  // P&L by underlying
  const byUnderlyingMap = {}
  for (const t of closedTrades) {
    if (!byUnderlyingMap[t.underlying]) byUnderlyingMap[t.underlying] = { pnl: 0, count: 0, wins: 0 }
    byUnderlyingMap[t.underlying].pnl += t.pnl
    byUnderlyingMap[t.underlying].count++
    if (t.isWin) byUnderlyingMap[t.underlying].wins++
  }
  const byUnderlying = Object.entries(byUnderlyingMap)
    .map(([symbol, v]) => ({ symbol, pnl: parseFloat(v.pnl.toFixed(2)), count: v.count, wins: v.wins }))
    .sort((a, b) => b.pnl - a.pnl)

  // P&L by strategy type
  const byStrategyMap = {}
  for (const t of closedTrades) {
    const s = t.strategyName || 'Unknown'
    if (!byStrategyMap[s]) byStrategyMap[s] = { pnl: 0, count: 0, wins: 0 }
    byStrategyMap[s].pnl += t.pnl
    byStrategyMap[s].count++
    if (t.isWin) byStrategyMap[s].wins++
  }
  const byStrategy = Object.entries(byStrategyMap)
    .map(([strategy, v]) => ({ strategy, pnl: parseFloat(v.pnl.toFixed(2)), count: v.count, wins: v.wins }))
    .sort((a, b) => b.pnl - a.pnl)

  // P&L by month
  const byMonthMap = {}
  for (const t of closedTrades) {
    const month = t.closeDate.toISOString().slice(0, 7)
    if (!byMonthMap[month]) byMonthMap[month] = 0
    byMonthMap[month] += t.pnl
  }
  const byMonth = Object.entries(byMonthMap)
    .map(([month, pnl]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    totalPnL,
    totalTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    cumulativeData,
    byUnderlying,
    byStrategy,
    byMonth,
  }
}
