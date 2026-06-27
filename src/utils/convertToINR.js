import { RBI_RATES } from './rbiRates'
import { inFY } from './calculatePnL'
import { computeEquityStats } from './buildEquityTrades'

// Look up the INR/USD rate for a given date, falling back up to 7 calendar
// days earlier to cover weekends and Indian public holidays.
export function getINRRate(date) {
  if (!date || isNaN(date)) return null
  for (let i = 0; i <= 7; i++) {
    const d = new Date(date)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    if (RBI_RATES[key] != null) return RBI_RATES[key]
  }
  return null
}

// Convert a single closed-position record to INR using the sell date rate.
function convertPosition(pos) {
  const rate = getINRRate(pos.sellDate) ?? getINRRate(pos.buyDate) ?? 1
  return {
    ...pos,
    pnl:          pos.pnl          * rate,
    costBasis:    pos.costBasis    * rate,
    saleProceeds: pos.saleProceeds * rate,
    buyFees:      pos.buyFees      * rate,
    sellFees:     pos.sellFees     * rate,
    totalFees:    pos.totalFees    * rate,
    buyPrice:     pos.buyPrice     * rate,
    sellPrice:    pos.sellPrice    * rate,
    currency:     'INR',
    _inrRate:     rate,
  }
}

// Convert a full equityData object (output of buildEquityTrades) to INR.
export function convertEquityDataToINR(equityData) {
  if (!equityData) return null
  const closed = equityData.closedPositions.map(convertPosition)
  const totalRealizedPnL = closed.reduce((s, p) => s + p.pnl, 0)

  // Open positions: use most recent available rate (today or last trading day)
  const latestRate = getINRRate(new Date()) ?? 1
  const open = equityData.openPositions.map(op => ({
    ...op,
    totalCost: op.totalCost * latestRate,
    avgCost:   op.avgCost   * latestRate,
    currency:  'INR',
    lots: op.lots.map(l => ({
      ...l,
      price: l.price * latestRate,
      cost:  l.cost  * latestRate,
    })),
  }))

  return {
    ...equityData,
    closedPositions:  closed,
    openPositions:    open,
    totalRealizedPnL,
    totalOpenCost:    open.reduce((s, p) => s + p.totalCost, 0),
    // Recompute stats grouped by Indian FY (Apr–Mar) instead of Australian FY (Jul–Jun)
    stats: computeEquityStats(closed, inFY),
  }
}
