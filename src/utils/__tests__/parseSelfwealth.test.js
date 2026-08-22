import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseCSVText, parseSelfwealth, detectCurrency, resolveMarket } from '../parseSelfwealth.js'
import { fixture } from './fixtures.js'

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

const REAL_US_PATH  = fixture('SelfWealth', /Divya.*\(US\)\.csv$/i)
const REAL_AUS_PATH = fixture('SelfWealth', /Divya.*\(AU\)\.csv$/i)

describe.skipIf(!REAL_US_PATH)('parseSelfwealth (real US file)', () => {

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

describe.skipIf(!REAL_AUS_PATH)('parseSelfwealth (real AUS file)', () => {

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

// ── Market detection & format regressions ─────────────────────────────────────
//
// Both bugs these cover shipped to a live account. Neither had coverage, because
// the real-file paths had rotted to ENOENT and the suite read as "failing" rather
// than "not running".

const swFill = (order, side, qty, sym, price) =>
  `2026-08-05 05:16:02,"Order ${order}: ${side} ${qty} ${sym} @ ${price}",1277.00,,137167.00`

describe('parseSelfwealth — price format', () => {

  // Selfwealth began writing "@ US$10.405" on 31 Jul 2026. The fill regex required a
  // bare "@ $", so newer fills fell through to the money-movement branch and showed up
  // as Capital Introduced / Withdrawal instead of trades.
  it('parses fills with a US$ currency prefix', async () => {
    const rows = await parseCSVText(csv(swFill(1697, 'Sell', 100, 'SNXX', 'US$12.77')), 'USD')
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades).toHaveLength(1)
    expect(trades[0].symbol).toBe('SNXX')
    expect(trades[0].price).toBeCloseTo(12.77, 4)
  })

  it('parses fills with an A$ prefix and still parses the bare $ form', async () => {
    const withA = await parseCSVText(csv(swFill(1, 'Buy', 10, 'CBA', 'A$5.00')), 'AUD')
    expect(withA.filter(r => r.rowType === 'Trade')).toHaveLength(1)
    const bare  = await parseCSVText(csv(swFill(2, 'Buy', 10, 'CBA', '$5.00')), 'AUD')
    expect(bare.filter(r => r.rowType === 'Trade')).toHaveLength(1)
  })

  it('does not misfile a prefixed fill as a money movement', async () => {
    const rows = await parseCSVText(csv(swFill(1697, 'Sell', 100, 'SNXX', 'US$12.77')), 'USD')
    expect(rows.filter(r => r.rowType === 'MoneyMovement')).toHaveLength(0)
  })

})

describe('parseSelfwealth — market detection', () => {

  it('layer 1: reads the marker out of the filename', () => {
    expect(detectCurrency('CashReport 2026 (AU).csv')).toBe('AUD')
    expect(detectCurrency('CashReport 2026 AUS.csv')).toBe('AUD')
    expect(detectCurrency('CashReport 2026 US.csv')).toBe('USD')
    expect(detectCurrency('CashReport_2020_2026.csv')).toBeNull()
  })

  it('layer 2: falls back to the price prefix, marked high confidence', () => {
    const r = resolveMarket('unmarked.csv', csv(swFill(1, 'Sell', 100, 'SNXX', 'US$12.77')))
    expect(r.currency).toBe('USD')
    expect(r.confidence).toBe('high')
  })

  it('layer 3: falls back to Exchange Fees, a US-only charge', () => {
    const text = csv(
      swFill(1, 'Sell', 100, 'AAPL', '$252.84'),
      '2026-08-05 05:16:08,Order 1: Exchange Fees SELL AAPL,,0.24,142266.08',
    )
    const r = resolveMarket('unmarked.csv', text)
    expect(r.currency).toBe('USD')
    expect(r.confidence).toBe('high')
  })

  it('layer 4: falls back to ticker shape, marked LOW confidence', () => {
    const asx = csv(...['BHP','CSL','WTC','A2M','4DX','CXO'].map((t,i) => swFill(i, 'Buy', 10, t, '$5.00')))
    const au  = resolveMarket('unmarked.csv', asx)
    expect(au.currency).toBe('AUD')
    expect(au.confidence).toBe('low')

    const us = resolveMarket('unmarked.csv',
      csv(...['AAPL','MSFT','NVDA','TSLA','GOOG','AMZN'].map((t,i) => swFill(i, 'Buy', 10, t, '$5.00'))))
    expect(us.currency).toBe('USD')
    expect(us.confidence).toBe('low')
  })

  // Regression: an AUD account's "Transfer 72,667.00 AUD TO USD" lines name the
  // transfer's direction, not the account's currency, and the identical line appears
  // in the USD export too. Keying off them filed the whole AUD account as USD.
  it('ignores AUD->USD transfer lines when resolving the market', () => {
    const text = csv(
      '2024-05-23 08:24:03,"Transfer 72,667.00 AUD TO USD. 1 AUD = 0.655559 USD",47637.51,,47637.51',
      ...['BHP','CSL','WTC','A2M','4DX','CXO'].map((t,i) => swFill(i, 'Buy', 10, t, '$5.00')),
    )
    expect(resolveMarket('unmarked.csv', text).currency).toBe('AUD')
  })

  it('a filename marker outranks conflicting content', () => {
    const usLooking = csv(swFill(1, 'Sell', 100, 'SNXX', 'US$12.77'))
    expect(resolveMarket('CashReport (AU).csv', usLooking).currency).toBe('AUD')
  })

  it('defaults to AUD at low confidence when there is no evidence at all', () => {
    // A dormant account's export has no fills, so layers 2-4 are all blind.
    const r = resolveMarket('unmarked.csv', csv('2026-07-27 06:32:30,THE A2 MILK COMP 001359495370,1174.36,,1357.87'))
    expect(r.currency).toBe('AUD')
    expect(r.confidence).toBe('low')
  })

})
