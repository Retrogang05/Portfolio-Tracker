import { describe, it, expect } from 'vitest'
import { carriedLotsToRows } from '../carriedLots.js'
import { buildEquityTrades } from '../buildEquityTrades.js'

const lot = over => ({ symbol: 'FIG', quantity: 200, totalCost: 5240.16, date: '2026-06-01', ...over })

describe('carriedLotsToRows', () => {

  it('builds an opening purchase with cash out negative', () => {
    const [r] = carriedLotsToRows([lot()], 'USD')
    expect(r.rowType).toBe('Trade')
    expect(r.instrumentType).toBe('Equity')
    expect(r.action).toBe('BUY_TO_OPEN')
    expect(r.openClose).toBe('Open')
    expect(r.underlying).toBe('FIG')
    expect(r.quantity).toBe(200)
    expect(r.amount).toBeCloseTo(-5240.16, 2)
    expect(r.price).toBeCloseTo(26.2008, 4)
    expect(r.currency).toBe('USD')
  })

  it('normalises the symbol', () => {
    expect(carriedLotsToRows([lot({ symbol: ' fig ' })])[0].underlying).toBe('FIG')
  })

  // A malformed lot must be dropped rather than producing a row with a broken cost
  // basis, which would corrupt P&L silently.
  it('ignores lots that are not fully specified', () => {
    const bad = [
      lot({ symbol: '' }),
      lot({ quantity: 0 }),
      lot({ totalCost: 0 }),
      lot({ date: '' }),
      lot({ date: 'not-a-date' }),
    ]
    expect(carriedLotsToRows(bad)).toHaveLength(0)
  })

  it('dates the row at the original acquisition, for the CGT holding period', () => {
    const d = carriedLotsToRows([lot({ date: '2026-05-16' })])[0].date
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(4)   // May
    expect(d.getDate()).toBe(16)
  })

})

describe('carried lots through buildEquityTrades', () => {

  // The case this exists for: shares transferred in, then sold at the new broker.
  // Without the lot the sale has no cost basis and is dropped from realised P&L.
  const sale = {
    rowType: 'Trade', instrumentType: 'Equity', underlying: 'FIG', symbol: 'FIG',
    action: 'SELL_TO_CLOSE', openClose: 'Close', quantity: 100,
    date: new Date('2026-07-31T00:00:00'), price: 24, amount: 2399.93,
    commissions: 0, fees: 0, description: 'Assigned',
  }

  it('leaves the sale unmatched when no lot is supplied', () => {
    const eq = buildEquityTrades([sale])
    expect(eq.closedPositions).toHaveLength(0)
    expect(eq.unmatchedCloses).toHaveLength(1)
    expect(eq.unmatchedCloses[0].symbol).toBe('FIG')
  })

  it('matches the sale and keeps the remainder open once the lot is supplied', () => {
    const rows = [...carriedLotsToRows([lot()], 'USD'), sale].sort((a, b) => a.date - b.date)
    const eq = buildEquityTrades(rows)

    expect(eq.unmatchedCloses).toHaveLength(0)
    expect(eq.closedPositions).toHaveLength(1)
    // 100 of the 200-share lot: cost 5240.16/2 = 2620.08, sold for 2399.93
    expect(eq.closedPositions[0].costBasis).toBeCloseTo(2620.08, 2)
    expect(eq.closedPositions[0].pnl).toBeCloseTo(-220.15, 2)

    // the other 100 stay open at the original cost
    expect(eq.openPositions).toHaveLength(1)
    expect(eq.openPositions[0].quantity).toBe(100)
    expect(eq.openPositions[0].avgCost).toBeCloseTo(26.2008, 3)
  })

})
