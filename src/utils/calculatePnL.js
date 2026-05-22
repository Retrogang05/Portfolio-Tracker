// Match opening and closing trades and compute realized P&L per position.
//
// Tastytrade Total column = net cash flow (Value + Commissions + Fees):
//   Sell to Open  → positive (credit received, net of fees)
//   Buy to Close  → negative (debit paid, net of fees)
//   Buy to Open   → negative (debit paid, net of fees)
//   Sell to Close → positive (credit received, net of fees)
//   Expiration    → $0 (option expired worthless)
//
// Realized P&L = open Total + close Total

export function buildTrades(rows) {
  const opens = rows.filter(r => r.openClose === 'Open')
  const closes = rows.filter(r => r.openClose === 'Close')

  // Match key: underlying + expiration + strike + callPut
  const key = r => `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`

  // Group opens by key (FIFO)
  const openMap = {}
  for (const o of opens) {
    const k = key(o)
    if (!openMap[k]) openMap[k] = []
    openMap[k].push({ ...o, remainingQty: o.quantity })
  }

  const closedTrades = []
  const unmatchedCloses = []

  for (const c of closes) {
    const k = key(c)
    const queue = openMap[k] || []
    let remainingClose = c.quantity

    while (remainingClose > 0 && queue.length > 0) {
      const open = queue[0]
      const matchedQty = Math.min(open.remainingQty, remainingClose)
      const openFrac = matchedQty / open.quantity
      const closeFrac = matchedQty / c.quantity

      const openAmount = open.amount * openFrac
      const closeAmount = c.amount * closeFrac
      const pnl = openAmount + closeAmount // Total already includes commissions & fees

      closedTrades.push({
        underlying: c.underlying,
        callPut: c.callPut,
        strike: c.strike,
        expiration: c.expiration,
        quantity: matchedQty,
        openDate: open.date,
        closeDate: c.date,
        openSubType: open.subType,
        closeSubType: c.isExpiration ? 'Expired' : c.subType,
        openPrice: open.price,
        closePrice: c.price,
        openAmount,
        closeAmount,
        isExpiration: c.isExpiration,
        pnl,
        isWin: pnl > 0,
        daysHeld: Math.max(0, Math.round((c.date - open.date) / 86400000)),
      })

      open.remainingQty -= matchedQty
      remainingClose -= matchedQty
      if (open.remainingQty <= 0) queue.shift()
    }

    if (remainingClose > 0) {
      unmatchedCloses.push({ ...c, unmatchedQty: remainingClose })
    }
  }

  const openPositions = Object.values(openMap)
    .flat()
    .filter(o => o.remainingQty > 0)

  return { closedTrades, openPositions, unmatchedCloses }
}

export function computeStats(closedTrades) {
  if (!closedTrades.length) return null

  const totalPnL = closedTrades.reduce((s, t) => s + t.pnl, 0)
  const wins = closedTrades.filter(t => t.isWin)
  const losses = closedTrades.filter(t => !t.isWin)
  const winRate = (wins.length / closedTrades.length) * 100
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const largestWin = wins.length ? Math.max(...wins.map(t => t.pnl)) : 0
  const largestLoss = losses.length ? Math.min(...losses.map(t => t.pnl)) : 0

  // Cumulative P&L over time
  const sorted = [...closedTrades].sort((a, b) => a.closeDate - b.closeDate)
  let cumulative = 0
  const cumulativeData = sorted.map(t => {
    cumulative += t.pnl
    return {
      date: t.closeDate.toISOString().split('T')[0],
      cumPnL: parseFloat(cumulative.toFixed(2)),
      pnl: parseFloat(t.pnl.toFixed(2)),
      underlying: t.underlying,
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
    byMonth,
  }
}
