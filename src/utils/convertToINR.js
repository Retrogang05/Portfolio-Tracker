// Look up the INR/USD rate for a given date, falling back up to 7 calendar
// days earlier to cover weekends and Indian public holidays.
export function getINRRate(date, rbiRates) {
  if (!date || !rbiRates || isNaN(date)) return null
  for (let i = 0; i <= 7; i++) {
    const d = new Date(date)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    if (rbiRates[key] != null) return rbiRates[key]
  }
  return null
}

function convertPosition(pos, rbiRates) {
  const rate = getINRRate(pos.sellDate, rbiRates) ?? getINRRate(pos.buyDate, rbiRates) ?? 1
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

export function convertEquityDataToINR(equityData, rbiRates) {
  if (!equityData) return null
  const closed = equityData.closedPositions.map(p => convertPosition(p, rbiRates))
  const totalRealizedPnL = closed.reduce((s, p) => s + p.pnl, 0)

  const latestRate = getINRRate(new Date(), rbiRates) ?? 1
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
    stats: null, // recomputed in App.jsx with inFY
  }
}
