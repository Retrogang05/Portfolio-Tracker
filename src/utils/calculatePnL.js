// Match opening and closing trades and compute realized P&L per position.
// Tastytrade reports net cash impact in the Amount column:
//   Sell to Open  → positive (credit received)
//   Buy to Close  → negative (debit paid)
//   Buy to Open   → negative (debit paid)
//   Sell to Close → positive (credit received)
// Realized P&L = open Amount + close Amount (fees already embedded or tracked separately)

export function buildTrades(rows) {
  // Separate opens and closes
  const opens = rows.filter(r => r.openClose === 'Open')
  const closes = rows.filter(r => r.openClose === 'Close')

  // Build a key for matching: underlying + expiration + strike + callPut
  const key = r =>
    `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`

  // Group opens by key (FIFO queue)
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
      const fraction = matchedQty / c.quantity
      const openFraction = matchedQty / open.quantity

      const openAmount = open.amount * openFraction
      const closeAmount = c.amount * fraction
      const openFees = open.fees * openFraction
      const closeFees = c.fees * fraction
      const pnl = openAmount + closeAmount // net cash (fees already included)

      closedTrades.push({
        underlying: c.underlying,
        callPut: c.callPut,
        strike: c.strike,
        expiration: c.expiration,
        quantity: matchedQty,
        openDate: open.date,
        closeDate: c.date,
        openSubcode: open.subcode,
        closeSubcode: c.subcode,
        openPrice: open.price,
        closePrice: c.price,
        openAmount,
        closeAmount,
        fees: openFees + closeFees,
        pnl,
        isWin: pnl > 0,
        daysHeld: Math.round((c.date - open.date) / 86400000),
      })

      open.remainingQty -= matchedQty
      remainingClose -= matchedQty
      if (open.remainingQty <= 0) queue.shift()
    }

    if (remainingClose > 0) {
      unmatchedCloses.push({ ...c, unmatchedQty: remainingClose })
    }
  }

  // Remaining open positions
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
  const totalFees = closedTrades.reduce((s, t) => s + t.fees, 0)

  // Cumulative P&L over time (sorted by close date)
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
  const byUnderlying = {}
  for (const t of closedTrades) {
    if (!byUnderlying[t.underlying]) byUnderlying[t.underlying] = { pnl: 0, count: 0, wins: 0 }
    byUnderlying[t.underlying].pnl += t.pnl
    byUnderlying[t.underlying].count++
    if (t.isWin) byUnderlying[t.underlying].wins++
  }
  const byUnderlyingArr = Object.entries(byUnderlying)
    .map(([symbol, v]) => ({ symbol, pnl: parseFloat(v.pnl.toFixed(2)), count: v.count, wins: v.wins }))
    .sort((a, b) => b.pnl - a.pnl)

  // P&L by month
  const byMonth = {}
  for (const t of closedTrades) {
    const month = t.closeDate.toISOString().slice(0, 7)
    if (!byMonth[month]) byMonth[month] = 0
    byMonth[month] += t.pnl
  }
  const byMonthArr = Object.entries(byMonth)
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
    totalFees,
    cumulativeData,
    byUnderlying: byUnderlyingArr,
    byMonth: byMonthArr,
  }
}
