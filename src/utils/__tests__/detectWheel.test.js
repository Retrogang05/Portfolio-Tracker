import { describe, it, expect } from 'vitest'
import { detectWheels } from '../detectWheel.js'

// Minimal row builders — only the fields detectWheel / buildEquityTrades read.
const d = s => new Date(`${s}T00:00:00`)

const share = (date, action, qty, price, amount, rowType = 'Trade') => ({
  rowType, date: d(date), underlying: 'BE', symbol: 'BE',
  instrumentType: 'Equity', action, openClose: action.includes('_TO_OPEN') ? 'Open' : 'Close',
  quantity: qty, price, amount, commissions: 0, fees: 0, callPut: null, strike: 0, expiration: '',
})

const shortPut = (date, strike, expiration, amount) => ({
  rowType: 'Trade', date: d(date), underlying: 'BE', symbol: `BE ${expiration} P${strike}`,
  instrumentType: 'Equity Option', action: 'SELL_TO_OPEN', openClose: 'Open',
  quantity: 1, price: 1, amount, commissions: 0, fees: 0,
  callPut: 'PUT', strike, expiration,
})

const expiry = (date, strike, expiration, callPut) => ({
  rowType: 'Expiration', date: d(date), underlying: 'BE', symbol: `BE ${expiration} ${callPut}${strike}`,
  instrumentType: 'Equity Option', action: 'BUY_TO_CLOSE', openClose: 'Close',
  quantity: 1, price: 0, amount: 0, commissions: 0, fees: 0,
  callPut, strike, expiration, isExpiration: true,
})

describe('detectWheel — stock leg P&L', () => {

  // The bug this covers: a wheel's shares can arrive by put assignment OR be bought
  // outright, and the two need not be equal. Netting only the assignment rows credits
  // every share of proceeds against the assigned shares' cost alone.
  //
  // Real case (BE): 100 bought on market for $23,175 and 100 assigned at $280 for
  // $40,452, then all 200 called away for $79,726. Netting assignments alone gave
  // $39,274; matched lot by lot it is $16,098 — the market-bought cost was ignored.
  it('counts shares bought on the market, not just assigned ones', () => {
    const rows = [
      share('2026-06-29', 'BUY_TO_OPEN', 100, 266, -26600),
      shortPut('2026-07-01', 280, '7/2/26', 500),
      expiry('2026-07-02', 280, '7/2/26', 'PUT'),
      share('2026-07-02', 'BUY_TO_OPEN', 100, 280, -28000, 'Assignment'),
      share('2026-09-25', 'SELL_TO_CLOSE', 200, 280, 56000, 'Assignment'),
    ]
    const w = detectWheels(rows).find(x => x.underlying === 'BE')

    // 100 @ 266 + 100 @ 280 = 54,600 cost against 56,000 proceeds
    expect(w.equityPnL).toBeCloseTo(1400, 2)
    // NOT the assignment-only figure, which ignores the market purchase
    expect(w.equityPnL).not.toBeCloseTo(28000, 2)
  })

  it('leaves unsold lots out of realised P&L', () => {
    const rows = [
      shortPut('2026-07-01', 280, '7/2/26', 500),
      expiry('2026-07-02', 280, '7/2/26', 'PUT'),
      share('2026-07-02', 'BUY_TO_OPEN', 100, 280, -28000, 'Assignment'),
    ]
    const w = detectWheels(rows).find(x => x.underlying === 'BE')
    // shares still held — a cost with no matching sale is not a loss
    expect(w.equityPnL).toBe(0)
    expect(w.totalPremium).toBeCloseTo(500, 2)
    expect(w.status).toBe('Active')
  })

  it('marks the wheel complete once the shares are gone', () => {
    const rows = [
      shortPut('2026-07-01', 280, '7/2/26', 500),
      expiry('2026-07-02', 280, '7/2/26', 'PUT'),
      share('2026-07-02', 'BUY_TO_OPEN', 100, 280, -28000, 'Assignment'),
      share('2026-09-25', 'SELL_TO_CLOSE', 100, 290, 29000, 'Assignment'),
    ]
    const w = detectWheels(rows).find(x => x.underlying === 'BE')
    expect(w.equityPnL).toBeCloseTo(1000, 2)
    expect(w.totalWheelPnL).toBeCloseTo(1500, 2)
    expect(w.status).toBe('Complete')
  })

  // Shares sold on the open market rather than called away still close the stock leg.
  it('counts a market sale of assigned shares', () => {
    const rows = [
      shortPut('2026-07-01', 280, '7/2/26', 500),
      expiry('2026-07-02', 280, '7/2/26', 'PUT'),
      share('2026-07-02', 'BUY_TO_OPEN', 100, 280, -28000, 'Assignment'),
      share('2026-08-04', 'SELL_TO_CLOSE', 100, 310, 31000),
    ]
    const w = detectWheels(rows).find(x => x.underlying === 'BE')
    expect(w.equityPnL).toBeCloseTo(3000, 2)
    expect(w.status).toBe('Complete')
  })

})

// ── PMCC ──────────────────────────────────────────────────────────────────────

const call = (date, strike, expiration, action, amount, extra = {}) => ({
  rowType: 'Trade', date: d(date), underlying: 'GEV', symbol: `GEV ${expiration} C${strike}`,
  instrumentType: 'Equity Option', action,
  openClose: action.endsWith('_TO_OPEN') ? 'Open' : 'Close',
  quantity: 1, price: 1, amount, commissions: 0, fees: 0,
  callPut: 'CALL', strike, expiration, ...extra,
})

describe('detectWheel — PMCC long leg', () => {

  // Selling the LEAPS is usually the bulk of a PMCC's P&L. The close was detected as a
  // bare boolean and its amount never read, so GEV — bought at $138.50, sold at $191.00
  // for a $7,906 gain — displayed as an open position $19.5k down.
  it('counts the proceeds when the LEAPS is sold', () => {
    const rows = [
      call('2026-09-16', 890, '3/19/27', 'BUY_TO_OPEN', -19542),
      call('2026-09-21', 1020, '9/25/26', 'SELL_TO_OPEN', 460),
      { ...call('2026-09-25', 1020, '9/25/26', 'BUY_TO_CLOSE', 0), rowType: 'Expiration', isExpiration: true },
      call('2026-10-08', 890, '3/19/27', 'SELL_TO_CLOSE', 27448),
    ]
    const p = detectWheels(rows).find(x => x.type === 'PMCC')

    expect(p.longClosed).toBe(true)
    expect(p.longLeg.proceeds).toBeCloseTo(27448, 0)
    expect(p.longLegPnL).toBeCloseTo(7906, 0)
    expect(p.premiumCollected).toBeCloseTo(460, 0)
    expect(p.realisedPnL).toBeCloseTo(8366, 0)
    expect(p.status).toBe('Complete')
  })

  // While the LEAPS is held its cost is not a loss, so realised P&L is premium only.
  it('reports premium only while the LEAPS is still held', () => {
    const rows = [
      call('2026-09-16', 890, '3/19/27', 'BUY_TO_OPEN', -19542),
      call('2026-09-21', 1020, '9/25/26', 'SELL_TO_OPEN', 460),
      { ...call('2026-09-25', 1020, '9/25/26', 'BUY_TO_CLOSE', 0), rowType: 'Expiration', isExpiration: true },
    ]
    const p = detectWheels(rows).find(x => x.type === 'PMCC')

    expect(p.longClosed).toBe(false)
    expect(p.longLegPnL).toBe(0)
    expect(p.realisedPnL).toBeCloseTo(460, 0)
    expect(p.status).toBe('Active')
  })

  it('handles a LEAPS that expired rather than being sold', () => {
    const rows = [
      call('2026-01-05', 890, '3/19/26', 'BUY_TO_OPEN', -19542),
      call('2026-02-02', 1020, '2/06/26', 'SELL_TO_OPEN', 460),
      { ...call('2026-02-06', 1020, '2/06/26', 'BUY_TO_CLOSE', 0), rowType: 'Expiration', isExpiration: true },
      { ...call('2026-03-19', 890, '3/19/26', 'SELL_TO_CLOSE', 0), rowType: 'Expiration', isExpiration: true },
    ]
    const p = detectWheels(rows).find(x => x.type === 'PMCC')

    expect(p.longClosed).toBe(true)
    expect(p.longLegPnL).toBeCloseTo(-19542, 0)   // expired worthless
    expect(p.realisedPnL).toBeCloseTo(-19082, 0)
  })

})
