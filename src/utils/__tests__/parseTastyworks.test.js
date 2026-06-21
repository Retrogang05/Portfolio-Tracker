import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseCSV, parseAllCSV } from '../parseTastyworks.js'

// ── Inline minimal CSV ─────────────────────────────────────────────────────────

const HEADER = 'Date,Type,Sub Type,Action,Symbol,Instrument Type,Description,Value,Quantity,Average Price,Commissions,Fees,Multiplier,Root Symbol,Underlying Symbol,Expiration Date,Strike Price,Call or Put,Order #,Total,Currency'

function row({ date = '2026-06-18T10:00:00+1000', type = 'Trade', subType = '', action, symbol, instr = 'Equity Option', qty, price, comm = '--', fees = '0', strike, callPut, expiry, total, underlying }) {
  return `${date},${type},${subType},${action},${symbol},${instr},,${price},${qty},${price},${comm},${fees},100,,${underlying},${expiry},${strike},${callPut},,${total},USD`
}

const TT_BUY  = row({ action:'BUY_TO_OPEN',   symbol:'QQQ   260618P00735000', qty:2, price:2.15, strike:735, callPut:'PUT',  expiry:'6/18/26', total:'-436.63', underlying:'QQQ' })
const TT_SELL = row({ action:'SELL_TO_CLOSE',  symbol:'QQQ   260618P00735000', qty:2, price:2.40, strike:735, callPut:'PUT',  expiry:'6/18/26', total:'473.35',  underlying:'QQQ' })
const TT_EXP  = row({ type:'Receive Deliver', subType:'Expiration', action:'BUY_TO_CLOSE', symbol:'FIG   260618C00021000', qty:2, price:0, strike:21, callPut:'CALL', expiry:'6/19/26', total:'0.00', underlying:'FIG' })

function csv(...rows) {
  return [HEADER, ...rows].join('\n')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseTastyworks (inline)', () => {

  it('parseCSV returns only option Trade + Expiration rows', async () => {
    const rows = await parseCSV(csv(TT_BUY, TT_SELL))
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.rowType === 'Trade')).toBe(true)
  })

  it('maps fields correctly for a BUY_TO_OPEN', async () => {
    const rows = await parseCSV(csv(TT_BUY))
    const r = rows[0]
    expect(r.action).toBe('BUY_TO_OPEN')
    expect(r.openClose).toBe('Open')
    expect(r.underlying).toBe('QQQ')
    expect(r.callPut).toBe('PUT')
    expect(r.strike).toBe(735)
    expect(r.quantity).toBe(2)
    expect(r.amount).toBeCloseTo(-436.63)
  })

  it('maps fields correctly for a SELL_TO_CLOSE', async () => {
    const rows = await parseCSV(csv(TT_SELL))
    const r = rows[0]
    expect(r.action).toBe('SELL_TO_CLOSE')
    expect(r.openClose).toBe('Close')
    expect(r.amount).toBeCloseTo(473.35)
  })

  it('classifies Expiration rows correctly', async () => {
    const rows = await parseCSV(csv(TT_EXP))
    expect(rows[0].isExpiration).toBe(true)
    expect(rows[0].rowType).toBe('Expiration')
    expect(rows[0].openClose).toBe('Close')
  })

  it('parseAllCSV includes all row types', async () => {
    const rows = await parseAllCSV(csv(TT_BUY, TT_SELL, TT_EXP))
    expect(rows).toHaveLength(3)
  })

  it('each row has required fields', async () => {
    const rows = await parseCSV(csv(TT_BUY, TT_SELL))
    for (const r of rows) {
      expect(r).toHaveProperty('rowType')
      expect(r).toHaveProperty('date')
      expect(r).toHaveProperty('underlying')
      expect(r).toHaveProperty('callPut')
      expect(r).toHaveProperty('strike')
      expect(r).toHaveProperty('quantity')
      expect(r).toHaveProperty('amount')
      expect(r).toHaveProperty('openClose')
      expect(r).toHaveProperty('action')
    }
  })

})

// ── Real-file smoke tests ─────────────────────────────────────────────────────

const REAL_TT_PATH = '/Users/harrysingh/Documents/Claude/Portfolio Transactions/tastytrade_transactions_history_x6AB16463_251231_to_260620.csv'

describe('parseTastyworks (real file)', () => {

  it('parses without throwing', async () => {
    const csvText = readFileSync(REAL_TT_PATH, 'utf8')
    const rows = await parseCSV(csvText)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('all returned rows are option Trades or Expirations', async () => {
    const csvText = readFileSync(REAL_TT_PATH, 'utf8')
    const rows = await parseCSV(csvText)
    expect(rows.every(r => r.rowType === 'Trade' || r.rowType === 'Expiration')).toBe(true)
    expect(rows.every(r => r.callPut === 'CALL' || r.callPut === 'PUT')).toBe(true)
  })

  it('each row has a valid date', async () => {
    const csvText = readFileSync(REAL_TT_PATH, 'utf8')
    const rows = await parseCSV(csvText)
    expect(rows.every(r => r.date instanceof Date && !isNaN(r.date))).toBe(true)
  })

  it('every Trade row has non-zero quantity', async () => {
    const csvText = readFileSync(REAL_TT_PATH, 'utf8')
    const rows    = await parseCSV(csvText)
    const trades  = rows.filter(r => r.rowType === 'Trade')
    expect(trades.every(r => r.quantity > 0)).toBe(true)
  })

  it('opens and closes are both present', async () => {
    const csvText = readFileSync(REAL_TT_PATH, 'utf8')
    const rows    = await parseCSV(csvText)
    const trades  = rows.filter(r => r.rowType === 'Trade')
    const opens   = trades.filter(r => r.openClose === 'Open')
    const closes  = trades.filter(r => r.openClose === 'Close')
    expect(opens.length).toBeGreaterThan(0)
    expect(closes.length).toBeGreaterThan(0)
  })

})
