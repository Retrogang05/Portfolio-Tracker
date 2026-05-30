// Australian financial year helper — exported so components can group by FY consistently
export const auFY = d => (d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear()).toString()

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
      const pnl = openAmount + closeAmount  // already net of fees (amount = Total col)

      // Fees: open always charged; close charged only when closing before expiry
      // Tastytrade: commissions (per-contract) + fees (regulatory)
      const openFees  = (Math.abs(open.commissions ?? 0) + Math.abs(open.fees ?? 0)) * openFrac
      const closeFees = c.isExpiration
        ? 0  // expires worthless → no closing fees
        : (Math.abs(c.commissions ?? 0) + Math.abs(c.fees ?? 0)) * closeFrac
      const totalFees = parseFloat((openFees + closeFees).toFixed(2))

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
        // P&L — net of fees (fees already deducted via amount=Total)
        pnl,
        totalFees,     // visible breakdown: open fees + close fees (0 if expired)
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
    if (group.length === 1) return {
      ...group[0],
      isDayTrade: group[0].daysHeld <= 2,
      totalFees: group[0].totalFees ?? 0,
      legs: group,
    }

    const pnl        = group.reduce((s, l) => s + l.pnl, 0)
    const totalFees  = parseFloat(group.reduce((s, l) => s + (l.totalFees ?? 0), 0).toFixed(2))
    // Preserve gross cash-flow amounts for CGT reporting (ATO requires separate proceeds / cost base)
    const openAmount  = group.reduce((s, l) => s + (l.openAmount  ?? 0), 0)
    const closeAmount = group.reduce((s, l) => s + (l.closeAmount ?? 0), 0)
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
      openAmount,
      closeAmount,
      pnl,
      totalFees,
      isWin:      pnl > 0,
      isDayTrade: Math.max(...group.map(l => l.daysHeld)) <= 2,
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

  // P&L by calendar day (for heatmap)
  const dailyPnLMap = {}
  for (const t of closedTrades) {
    const date = t.closeDate.toISOString().split('T')[0]
    if (!dailyPnLMap[date]) dailyPnLMap[date] = { pnl: 0, count: 0, trades: [] }
    dailyPnLMap[date].pnl += t.pnl
    dailyPnLMap[date].count++
    dailyPnLMap[date].trades.push({
      underlying: t.underlying,
      strategy: t.strategyName,
      pnl: t.pnl,
    })
  }

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

  // P&L by Australian financial year: 1 Jul – 30 Jun (labelled by ending year)
  // e.g. a trade closing Oct 2024 → FY2025
  const toFY = auFY

  const byYearMap = {}
  for (const t of closedTrades) {
    const year = toFY(t.closeDate)
    if (!byYearMap[year]) byYearMap[year] = { pnl: 0, count: 0, wins: 0, losses: 0, months: {} }
    byYearMap[year].pnl += t.pnl
    byYearMap[year].count++
    if (t.isWin) byYearMap[year].wins++
    else byYearMap[year].losses++
    const month = t.closeDate.toISOString().slice(0, 7)
    if (!byYearMap[year].months[month]) byYearMap[year].months[month] = { pnl: 0, count: 0, wins: 0 }
    byYearMap[year].months[month].pnl += t.pnl
    byYearMap[year].months[month].count++
    if (t.isWin) byYearMap[year].months[month].wins++
  }
  const byYear = Object.entries(byYearMap)
    .map(([year, v]) => {
      const monthList = Object.entries(v.months)
        .map(([month, m]) => ({ month, pnl: parseFloat(m.pnl.toFixed(2)), count: m.count, wins: m.wins }))
        .sort((a, b) => a.month.localeCompare(b.month))
      const monthPnLs = monthList.map(m => m.pnl)
      const bestMonth  = monthList.length ? monthList.reduce((a, b) => b.pnl > a.pnl ? b : a) : null
      const worstMonth = monthList.length ? monthList.reduce((a, b) => b.pnl < a.pnl ? b : a) : null
      const yearWins   = closedTrades.filter(t => toFY(t.closeDate) === year && t.isWin)
      const yearLosses = closedTrades.filter(t => toFY(t.closeDate) === year && !t.isWin)
      return {
        year,
        pnl: parseFloat(v.pnl.toFixed(2)),
        count: v.count,
        wins: v.wins,
        losses: v.losses,
        winRate: v.count > 0 ? (v.wins / v.count) * 100 : 0,
        avgWin:  yearWins.length   ? yearWins.reduce((s, t)   => s + t.pnl, 0) / yearWins.length   : 0,
        avgLoss: yearLosses.length ? yearLosses.reduce((s, t) => s + t.pnl, 0) / yearLosses.length : 0,
        bestMonth,
        worstMonth,
        months: monthList,
      }
    })
    .sort((a, b) => a.year.localeCompare(b.year))

  return {
    totalPnL,
    dailyPnL: dailyPnLMap,
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
    byYear,
  }
}
