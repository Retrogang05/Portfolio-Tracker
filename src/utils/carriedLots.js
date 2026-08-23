// Positions carried in from another broker.
//
// An account transfer (ACAT) moves shares but generates no trade record, so the
// receiving broker's activity report shows sales of stock it never records buying.
// Those sales have no cost basis and are excluded from realised P&L, and any holding
// still open from the transfer is missing from the positions list entirely.
//
// The cost basis exists — in the *sending* broker's history — so let it be entered
// once and stored, rather than hard-coded. Kept in localStorage, per portfolio:
//   • holdings never enter the source tree, which is published to GitHub Pages
//   • editing needs no code change or redeploy
//   • matches how strategy overrides and capital tags are already stored
//
// Each lot becomes a synthetic opening purchase, so FIFO matching, cost basis and
// realised P&L all behave exactly as if the shares had been bought here.

const key = idx => `portfolio-tracker:carried-lots:${idx}`

export function loadCarriedLots(idx) {
  try {
    const raw = JSON.parse(localStorage.getItem(key(idx)) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export function saveCarriedLots(idx, lots) {
  localStorage.setItem(key(idx), JSON.stringify(lots))
}

/**
 * Turn stored lots into synthetic opening equity rows.
 *
 * `totalCost` is the full cash cost of the lot including fees, entered as a positive
 * number and stored as a negative amount to match the sign convention everywhere else
 * (cash out is negative). Dating the row at the original purchase gives the holding
 * period an accurate start, which matters for the CGT long/short split.
 */
export function carriedLotsToRows(lots, currency = null) {
  const rows = []

  for (const lot of lots) {
    const symbol   = (lot.symbol || '').trim().toUpperCase()
    const quantity = Number(lot.quantity)
    const cost     = Math.abs(Number(lot.totalCost))
    const date     = new Date(`${lot.date}T00:00:00`)

    if (!symbol || !(quantity > 0) || !(cost > 0) || isNaN(date)) continue

    rows.push({
      rowType:        'Trade',
      date,
      timestampSec:   Math.floor(date.getTime() / 1000).toString(),
      orderId:        `CARRIED-${symbol}-${lot.date}`,
      subType:        'Buy',
      action:         'BUY_TO_OPEN',
      symbol,
      underlying:     symbol,
      instrumentType: 'Equity',
      openClose:      'Open',
      quantity,
      expiration:     '',
      strike:         0,
      callPut:        null,
      price:          cost / quantity,
      commissions:    0,
      fees:           0,
      amount:         -cost,
      currency,
      description:    `Carried in from ${lot.source || 'another broker'}`,
      isCarriedLot:   true,
      isExpiration:   false,
    })
  }

  return rows
}
