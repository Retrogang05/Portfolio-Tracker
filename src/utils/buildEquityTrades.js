// FIFO matching for equity buy/sell rows from both Tastytrade and IBKR.
//
// Open (acquiring shares):  amount < 0  (paid cash, received stock)
// Close (selling shares):   amount > 0  (received cash, delivered stock)

import { auFY } from './calculatePnL'

function isEquityRow(r) {
  return (
    (r.rowType === 'Trade' && r.instrumentType === 'Equity') ||
    r.rowType === 'Assignment' ||
    r.rowType === 'Exercise' ||
    r.rowType === 'EquityDelivery'
  )
}

export function computeEquityStats(positions, fyFn = auFY) {
  if (!positions.length) return null

  const wins   = positions.filter(p => p.pnl > 0)
  const losses = positions.filter(p => p.pnl <= 0)

  const byYearMap = {}
  for (const pos of positions) {
    const year = fyFn(pos.sellDate)
    if (!byYearMap[year]) byYearMap[year] = { pnl: 0, count: 0, wins: 0, losses: 0, months: {} }
    byYearMap[year].pnl    += pos.pnl
    byYearMap[year].count  += 1
    if (pos.pnl > 0) byYearMap[year].wins++
    else             byYearMap[year].losses++
    const month = pos.sellDate.toISOString().slice(0, 7)
    if (!byYearMap[year].months[month]) byYearMap[year].months[month] = { pnl: 0, count: 0, wins: 0 }
    byYearMap[year].months[month].pnl += pos.pnl
    byYearMap[year].months[month].count++
    if (pos.pnl > 0) byYearMap[year].months[month].wins++
  }

  const byYear = Object.entries(byYearMap)
    .map(([year, v]) => {
      const yp = positions.filter(p => fyFn(p.sellDate) === year)
      const yw = yp.filter(p => p.pnl > 0)
      const yl = yp.filter(p => p.pnl <= 0)
      const monthList = Object.entries(v.months)
        .map(([month, m]) => ({ month, pnl: m.pnl, count: m.count, wins: m.wins }))
        .sort((a, b) => a.month.localeCompare(b.month))
      return {
        year,
        pnl:      v.pnl,
        count:    v.count,
        wins:     v.wins,
        losses:   v.losses,
        winRate:  v.count > 0 ? (v.wins / v.count) * 100 : 0,
        avgWin:   yw.length ? yw.reduce((s, p) => s + p.pnl, 0) / yw.length : 0,
        avgLoss:  yl.length ? yl.reduce((s, p) => s + p.pnl, 0) / yl.length : 0,
        bestMonth:  monthList.length ? monthList.reduce((a, b) => b.pnl > a.pnl ? b : a) : null,
        worstMonth: monthList.length ? monthList.reduce((a, b) => b.pnl < a.pnl ? b : a) : null,
        months: monthList,
      }
    })
    .sort((a, b) => a.year.localeCompare(b.year))

  return {
    totalPnL:    positions.reduce((s, p) => s + p.pnl, 0),
    totalTrades: positions.length,
    wins:        wins.length,
    losses:      losses.length,
    winRate:     positions.length > 0 ? (wins.length / positions.length) * 100 : 0,
    avgWin:      wins.length   ? wins.reduce((s, p)   => s + p.pnl, 0) / wins.length   : 0,
    avgLoss:     losses.length ? losses.reduce((s, p) => s + p.pnl, 0) / losses.length : 0,
    largestWin:  wins.length   ? Math.max(...wins.map(p   => p.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map(p => p.pnl)) : 0,
    avgDaysHeld: positions.length > 0
      ? positions.reduce((s, p) => s + p.daysHeld, 0) / positions.length : 0,
    byYear,
  }
}

export function buildEquityTrades(allRows) {
  const equityRows = allRows
    .filter(isEquityRow)
    .filter(r => r.amount !== 0 && r.quantity > 0)
    .sort((a, b) => a.date - b.date)

  // Use openClose when available (supports short selling where amount signs are reversed).
  // Fall back to amount sign for legacy rows without openClose.
  const opens  = equityRows.filter(r => r.openClose != null ? r.openClose === 'Open'  : r.amount < 0)
  const closes = equityRows.filter(r => r.openClose != null ? r.openClose === 'Close' : r.amount > 0)

  // FIFO queue per underlying symbol
  const openMap = {}
  for (const o of opens) {
    const k = o.underlying
    if (!openMap[k]) openMap[k] = []
    openMap[k].push({ ...o, remainingQty: o.quantity })
  }

  const closedPositions = []

  for (const c of closes) {
    const k = c.underlying
    const queue = openMap[k] || []
    let remaining = c.quantity

    while (remaining > 0 && queue.length > 0) {
      const open = queue[0]
      const matched  = Math.min(open.remainingQty, remaining)
      const openFrac = matched / open.quantity
      const closeFrac = matched / c.quantity

      const openCost     = open.amount * openFrac   // negative (net cash paid incl. fees)
      const closeNet     = c.amount   * closeFrac   // positive (net cash received after fees)
      const pnl          = openCost + closeNet      // net P&L after all fees

      // Fees breakdown (commissions are stored as negative costs)
      const buyFees   = Math.abs((open.commissions ?? 0) * openFrac)
      const sellFees  = Math.abs((c.commissions    ?? 0) * closeFrac)
      const totalFees = parseFloat((buyFees + sellFees).toFixed(2))

      // Gross cost and proceeds — fees listed separately, NOT baked in
      const costBasis    = parseFloat((Math.abs(open.price) * matched).toFixed(2))  // price × qty only
      const saleProceeds = parseFloat((Math.abs(c.price)    * matched).toFixed(2))  // price × qty only

      const daysHeld = Math.max(0, Math.round((c.date - open.date) / 86400000))

      closedPositions.push({
        symbol:       c.underlying,
        quantity:     matched,
        buyDate:      open.date,
        sellDate:     c.date,
        daysHeld,
        isDayTrade:   daysHeld <= 2,
        buyPrice:     Math.abs(open.price),
        sellPrice:    Math.abs(c.price),
        costBasis,       // gross cost (price × qty, no fees)
        saleProceeds,    // gross proceeds (price × qty, no fees)
        buyFees,
        sellFees,
        totalFees,
        pnl,             // net P&L = saleProceeds − costBasis − totalFees
        isWin:        pnl > 0,
        buyDesc:      open.description,
        sellDesc:     c.description,
        currency:     c.currency ?? open.currency ?? null,
      })

      open.remainingQty -= matched
      remaining -= matched
      if (open.remainingQty <= 0) queue.shift()
    }
  }

  // Remaining unmatched opens = current open positions
  const openPositions = []
  for (const [symbol, queue] of Object.entries(openMap)) {
    const active = queue.filter(q => q.remainingQty > 0)
    if (!active.length) continue

    const totalQty  = active.reduce((s, r) => s + r.remainingQty, 0)
    const totalCost = active.reduce((s, r) => s + Math.abs(r.amount) * (r.remainingQty / r.quantity), 0)
    openPositions.push({
      symbol,
      quantity: totalQty,
      totalCost,
      avgCost: totalCost / totalQty,
      earliestBuy: active[0].date,
      currency: active[0].currency ?? null,
      lots: active.map(r => ({
        date:  r.date,
        qty:   r.remainingQty,
        price: Math.abs(r.price),
        cost:  Math.abs(r.amount) * (r.remainingQty / r.quantity),
      })),
    })
  }

  openPositions.sort((a, b) => a.symbol.localeCompare(b.symbol))

  const totalRealizedPnL = closedPositions.reduce((s, p) => s + p.pnl, 0)
  const totalOpenCost    = openPositions.reduce((s, p) => s + p.totalCost, 0)
  const stats            = computeEquityStats(closedPositions)

  return { closedPositions, openPositions, totalRealizedPnL, totalOpenCost, stats }
}
