import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../parseTradestation.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

const HEADER = 'Account Number,Type,TradeInd,Transaction,Quantity,Cusip,ADP,Symbol,CallPut,UnderlyingSymbol,ExpireDate,StrikePrice,TD,SD,Activity Date,Price,Amount,CurrencyCode,Commission,Description,Activity Time,Order ID'

function makeRow({ tx, qty, symbol, callPut, underlying, expiry, strike, price, amount, comm, time }) {
  return `12059846,Margin,T,${tx},${qty},,,${symbol},${callPut},${underlying},${expiry},${strike}.0000,${expiry},${expiry},${expiry},${price},${amount},USD,${comm},${callPut} ${underlying} ${strike}.0000,${expiry} ${time},ORDER1`
}

function csv(...rows) {
  return [HEADER, ...rows].join('\n')
}

// ── Contract helpers ──────────────────────────────────────────────────────────

const QQQ_P735_BUY  = makeRow({ tx:'Buy',  qty:200, symbol:'QQQ260618P735', callPut:'PUT',  underlying:'QQQ',  expiry:'6/18/2026', strike:735, price:2.15, amount:436.63, comm:6.63, time:'10:28:29:140' })
const QQQ_P735_SELL = makeRow({ tx:'Sell', qty:200, symbol:'QQQ260618P735', callPut:'PUT',  underlying:'QQQ',  expiry:'6/18/2026', strike:735, price:2.4,  amount:473.35, comm:6.65, time:'10:31:33:703' })
const NOW_P93_BUY   = makeRow({ tx:'Buy',  qty:300, symbol:'NOW260618P93',  callPut:'PUT',  underlying:'NOW',  expiry:'6/18/2026', strike:93,  price:0.95, amount:292.45, comm:7.45, time:'09:35:01:093' })
const CRWV_C122_BUY  = makeRow({ tx:'Buy',  qty:400, symbol:'CRWV260618C122', callPut:'CALL', underlying:'CRWV', expiry:'6/18/2026', strike:122, price:3.25, amount:1308.26, comm:8.26, time:'09:42:43:567' })
const CRWV_C122_SELL1 = makeRow({ tx:'Sell', qty:300, symbol:'CRWV260618C122', callPut:'CALL', underlying:'CRWV', expiry:'6/18/2026', strike:122, price:2.21, amount:655.52,  comm:7.48, time:'09:49:37:847' })
const CRWV_C122_SELL2 = makeRow({ tx:'Sell', qty:100, symbol:'CRWV260618C122', callPut:'CALL', underlying:'CRWV', expiry:'6/18/2026', strike:122, price:2.29, amount:223.16,  comm:5.84, time:'09:49:03:323' })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseTradestation', () => {

  it('parses a single buy→sell round-trip', async () => {
    const rows = await parseCSVText(csv(QQQ_P735_BUY, QQQ_P735_SELL))

    expect(rows).toHaveLength(2)

    const buyRow  = rows.find(r => r.action === 'BUY_TO_OPEN')
    const sellRow = rows.find(r => r.action === 'SELL_TO_CLOSE')

    expect(buyRow).toBeDefined()
    expect(sellRow).toBeDefined()
  })

  it('maps option fields correctly', async () => {
    const rows = await parseCSVText(csv(QQQ_P735_BUY))
    const r = rows[0]

    expect(r.underlying).toBe('QQQ')
    expect(r.callPut).toBe('PUT')
    expect(r.strike).toBe(735)
    expect(r.expiration).toBe('2026-06-18')
    expect(r.quantity).toBe(2)            // 200 shares / 100 = 2 contracts
    expect(r.price).toBe(2.15)
    expect(r.amount).toBeCloseTo(-436.63) // buy = negative (debit)
    expect(r.commissions).toBe(6.63)
    expect(r.rowType).toBe('Trade')
  })

  it('amount is positive for sells', async () => {
    const rows = await parseCSVText(csv(QQQ_P735_SELL))
    const r = rows[0]
    expect(r.amount).toBeCloseTo(473.35)
  })

  it('assigns Open to first occurrence and Close to the matching sell', async () => {
    // CSV is newest-first (sell then buy) — parser must sort chronologically
    const rows = await parseCSVText(csv(QQQ_P735_SELL, QQQ_P735_BUY))

    const buy  = rows.find(r => r.action.startsWith('BUY'))
    const sell = rows.find(r => r.action.startsWith('SELL'))

    expect(buy.openClose).toBe('Open')
    expect(sell.openClose).toBe('Close')
  })

  it('handles partial fills correctly (CRWV: buy 4, sell 1+3)', async () => {
    const rows = await parseCSVText(csv(CRWV_C122_BUY, CRWV_C122_SELL1, CRWV_C122_SELL2))

    const opens  = rows.filter(r => r.openClose === 'Open')
    const closes = rows.filter(r => r.openClose === 'Close')

    expect(opens).toHaveLength(1)
    expect(closes).toHaveLength(2)
    expect(opens[0].quantity).toBe(4)  // 400 / 100
  })

  it('adds a synthetic expiration for an open position past expiry', async () => {
    // NOW P93 bought June 18 2026 (already expired) with no close
    const rows = await parseCSVText(csv(NOW_P93_BUY))

    const expRow = rows.find(r => r.isExpiration)
    expect(expRow).toBeDefined()
    expect(expRow.underlying).toBe('NOW')
    expect(expRow.openClose).toBe('Close')
    expect(expRow.amount).toBe(0)
    expect(expRow.quantity).toBe(3)  // 300 / 100
  })

  it('does NOT add synthetic expiration for a fully closed position', async () => {
    const rows = await parseCSVText(csv(QQQ_P735_BUY, QQQ_P735_SELL))
    const expRows = rows.filter(r => r.isExpiration)
    expect(expRows).toHaveLength(0)
  })

  it('ignores non-option rows (empty callPut)', async () => {
    // A row that would be a stock — should not appear in output
    const stockRow = `12059846,Margin,T,Buy,100,,,AAPL,,AAPL,,0.0000,6/18/2026,6/22/2026,6/18/2026,150,15000,USD,1,,6/18/2026 10:00:00:000,ORDER2`
    const rows = await parseCSVText(csv(stockRow, QQQ_P735_BUY))
    // Only the option row should come through
    expect(rows.every(r => r.callPut === 'PUT' || r.callPut === 'CALL')).toBe(true)
  })

  it('each row has required fields', async () => {
    const rows = await parseCSVText(csv(QQQ_P735_BUY, QQQ_P735_SELL))
    for (const r of rows) {
      expect(r).toHaveProperty('rowType')
      expect(r).toHaveProperty('date')
      expect(r).toHaveProperty('underlying')
      expect(r).toHaveProperty('expiration')
      expect(r).toHaveProperty('strike')
      expect(r).toHaveProperty('callPut')
      expect(r).toHaveProperty('quantity')
      expect(r).toHaveProperty('price')
      expect(r).toHaveProperty('amount')
      expect(r).toHaveProperty('openClose')
      expect(r).toHaveProperty('action')
      expect(r._isBuy).toBeUndefined()     // internal field must be cleaned up
      expect(r._origSign).toBeUndefined()  // internal field must be cleaned up
    }
  })

  it('P&L of a round-trip is credit minus debit', async () => {
    const rows = await parseCSVText(csv(QQQ_P735_BUY, QQQ_P735_SELL))
    const pnl = rows.reduce((s, r) => s + r.amount, 0)
    // Sell 473.35 − Buy 436.63 = 36.72
    expect(pnl).toBeCloseTo(36.72, 1)
  })

})
