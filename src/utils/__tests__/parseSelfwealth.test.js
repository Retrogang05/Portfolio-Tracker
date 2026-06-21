import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseCSVText, parseSelfwealth } from '../parseSelfwealth.js'

// ── Inline minimal CSV ─────────────────────────────────────────────────────────

const HEADER = 'TransactionDate,Comment,Credit,Debit,Balance * Please note, this is not a bank statement.'

function csv(...rows) {
  return [HEADER, ',Opening Balance,,,0.000000', ...rows].join('\n')
}

const SW_BUY  = `2025-07-07 11:59:58,"Order 100: Buy 4240 CAT @ $5.795",,24570.80,1221.600000`
const SW_BROK = `2025-07-07 11:59:58,Order 100: Brokerage BUY CAT,,9.50,1212.100000`
const SW_SELL = `2025-07-08 09:00:00,"Order 101: Sell 4240 CAT @ $6.00",25440.00,,26652.100000`
const SW_SBROK= `2025-07-08 09:00:00,Order 101: Brokerage SELL CAT,,9.50,26642.600000`
const SW_DIV  = `2025-08-01 00:00:00,TEA DIVIDEND APR26/00804143,792.00,,27434.600000`
const SW_DEP  = `2025-07-01 00:00:00,Savings,25000.00,,25000.000000`
const SW_WITH = `2025-09-01 00:00:00,Withdrawals,50.00,,24950.000000`

// ── Inline tests ───────────────────────────────────────────────────────────────

describe('parseSelfwealth (inline)', () => {

  it('consolidates buy fill + brokerage into one Trade row', async () => {
    const rows = await parseCSVText(csv(SW_BUY, SW_BROK), 'AUD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades).toHaveLength(1)
    const t = trades[0]
    expect(t.symbol).toBe('CAT')
    expect(t.action).toBe('BUY_TO_OPEN')
    expect(t.openClose).toBe('Open')
    expect(t.quantity).toBe(4240)
    expect(t.currency).toBe('AUD')
    // amount = -(debit + brokerage) = -(24570.80 + 9.50) = -24580.30
    expect(t.amount).toBeCloseTo(-24580.30)
  })

  it('consolidates sell fill + brokerage into one Trade row', async () => {
    const rows = await parseCSVText(csv(SW_SELL, SW_SBROK), 'AUD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades).toHaveLength(1)
    const t = trades[0]
    expect(t.action).toBe('SELL_TO_CLOSE')
    expect(t.openClose).toBe('Close')
    // amount = +(credit - brokerage) = +(25440 - 9.50) = 25430.50
    expect(t.amount).toBeCloseTo(25430.50)
  })

  it('buy+sell round-trip P&L', async () => {
    const rows = await parseCSVText(csv(SW_BUY, SW_BROK, SW_SELL, SW_SBROK), 'AUD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades).toHaveLength(2)
    const pnl = trades.reduce((s, r) => s + r.amount, 0)
    // Sell 25430.50 - Buy 24580.30 = 850.20
    expect(pnl).toBeCloseTo(850.20, 0)
  })

  it('classifies dividend as MoneyMovement / Dividend', async () => {
    const rows = await parseCSVText(csv(SW_DIV), 'AUD')
    const mm = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm).toHaveLength(1)
    expect(mm[0].subType).toBe('Dividend')
    expect(mm[0].amount).toBeCloseTo(792)
  })

  it('classifies deposit as MoneyMovement / Capital Introduced', async () => {
    const rows = await parseCSVText(csv(SW_DEP), 'AUD')
    const mm = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm).toHaveLength(1)
    expect(mm[0].subType).toBe('Capital Introduced')
    expect(mm[0].amount).toBeCloseTo(25000)
  })

  it('classifies withdrawal as MoneyMovement / Withdrawal', async () => {
    const rows = await parseCSVText(csv(SW_WITH), 'AUD')
    const mm = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm).toHaveLength(1)
    expect(mm[0].subType).toBe('Withdrawal')
  })

})

// ── Real-file smoke tests ─────────────────────────────────────────────────────

const REAL_US_PATH  = '/Users/harrysingh/Documents/Claude/Portfolio Transactions/CashReport-Divya Mahajan2023-01-01-2026-06-21 US.csv'
const REAL_AUS_PATH = '/Users/harrysingh/Documents/Claude/Portfolio Transactions/CashReport-Divya Mahajan2025-07-01-2026-06-30 AUS.csv'

describe('parseSelfwealth (real US file)', () => {

  it('parses without throwing', async () => {
    const text = readFileSync(REAL_US_PATH, 'utf8')
    const rows = await parseCSVText(text, 'USD')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('all Trade rows are Equity with correct currency', async () => {
    const text   = readFileSync(REAL_US_PATH, 'utf8')
    const rows   = await parseCSVText(text, 'USD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades.length).toBeGreaterThan(0)
    expect(trades.every(r => r.instrumentType === 'Equity')).toBe(true)
    expect(trades.every(r => r.currency === 'USD')).toBe(true)
  })

  it('every Trade row has quantity > 0 and a valid date', async () => {
    const text   = readFileSync(REAL_US_PATH, 'utf8')
    const rows   = await parseCSVText(text, 'USD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades.every(r => r.quantity > 0)).toBe(true)
    expect(trades.every(r => r.date instanceof Date && !isNaN(r.date))).toBe(true)
  })

})

describe('parseSelfwealth (real AUS file)', () => {

  it('parses without throwing', async () => {
    const text = readFileSync(REAL_AUS_PATH, 'utf8')
    const rows = await parseCSVText(text, 'AUD')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('all Trade rows have AUD currency', async () => {
    const text   = readFileSync(REAL_AUS_PATH, 'utf8')
    const rows   = await parseCSVText(text, 'AUD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades.length).toBeGreaterThan(0)
    expect(trades.every(r => r.currency === 'AUD')).toBe(true)
  })

})
