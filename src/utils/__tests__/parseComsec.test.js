import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseComsec } from '../parseComsec.js'

// ── Inline minimal CSV ─────────────────────────────────────────────────────────

const HEADER = 'Date,Reference,Details,Debit($),Credit($),Balance($)'

function csv(...rows) {
  return [HEADER, ...rows].join('\n')
}

const CS_BUY  = `27/10/2025,C167621111,B 625000 AXI @ 0.040000  ,25029.95,,0.00`
const CS_SELL = `20/10/2025,C167446668,S 44943 ARU @ 0.455000  ,,20419.12,-389.53`
const CS_DEP  = `01/10/2025,R68861685,Direct Transfer 067167 12483884 Drawer Miss DIVYA Mahajan,,25029.95,0.00`
const CS_WITH = `01/11/2025,P35195039,Direct Transfer - Payee MISS DIVYA MAHAJAN,389.53,,0.00`
const CS_DIV  = `15/10/2025,D00123456,AXI Dividend,,500.00,500.00`

// ── Inline tests ───────────────────────────────────────────────────────────────

describe('parseComsec (inline)', () => {

  it('parses a buy row correctly', async () => {
    const rows = await parseComsec(csv(CS_BUY))
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades).toHaveLength(1)
    const t = trades[0]
    expect(t.symbol).toBe('AXI')
    expect(t.action).toBe('BUY_TO_OPEN')
    expect(t.openClose).toBe('Open')
    expect(t.quantity).toBe(625000)
    expect(t.price).toBeCloseTo(0.04)
    expect(t.currency).toBe('AUD')
    // amount = -debit = -25029.95
    expect(t.amount).toBeCloseTo(-25029.95)
  })

  it('parses a sell row correctly', async () => {
    const rows = await parseComsec(csv(CS_SELL))
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades).toHaveLength(1)
    const t = trades[0]
    expect(t.symbol).toBe('ARU')
    expect(t.action).toBe('SELL_TO_CLOSE')
    expect(t.openClose).toBe('Close')
    expect(t.quantity).toBe(44943)
    expect(t.amount).toBeCloseTo(20419.12)
  })

  it('parses a capital introduction (R prefix)', async () => {
    const rows = await parseComsec(csv(CS_DEP))
    const mm   = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm).toHaveLength(1)
    expect(mm[0].subType).toBe('Capital Introduced')
    expect(mm[0].amount).toBeCloseTo(25029.95)
  })

  it('parses a withdrawal (P prefix)', async () => {
    const rows = await parseComsec(csv(CS_WITH))
    const mm   = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm).toHaveLength(1)
    expect(mm[0].subType).toBe('Withdrawal')
    expect(mm[0].amount).toBeCloseTo(-389.53)
  })

  it('parses DD/MM/YYYY dates correctly', async () => {
    const rows = await parseComsec(csv(CS_BUY))
    const t = rows[0]
    expect(t.date.getFullYear()).toBe(2025)
    expect(t.date.getMonth()).toBe(9)  // October = index 9
    expect(t.date.getDate()).toBe(27)
  })

  it('all Trade rows have AUD currency', async () => {
    const rows   = await parseComsec(csv(CS_BUY, CS_SELL))
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades.every(r => r.currency === 'AUD')).toBe(true)
  })

  it('each Trade row has required fields', async () => {
    const rows   = await parseComsec(csv(CS_BUY, CS_SELL))
    const trades = rows.filter(r => r.rowType === 'Trade')
    for (const r of trades) {
      expect(r).toHaveProperty('rowType')
      expect(r).toHaveProperty('date')
      expect(r).toHaveProperty('symbol')
      expect(r).toHaveProperty('quantity')
      expect(r).toHaveProperty('price')
      expect(r).toHaveProperty('amount')
      expect(r).toHaveProperty('openClose')
      expect(r).toHaveProperty('action')
      expect(r.instrumentType).toBe('Equity')
    }
  })

})

// ── Real-file smoke tests ─────────────────────────────────────────────────────

const REAL_CS_PATH = '/Users/harrysingh/Documents/Claude/Portfolio Transactions/COMSEC Transactions_4437691_07012019_24052026.csv'

describe('parseComsec (real file)', () => {

  it('parses without throwing', async () => {
    const text = readFileSync(REAL_CS_PATH, 'utf8')
    const rows = await parseComsec(text)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('all Trade rows are Equity with positive quantity', async () => {
    const text   = readFileSync(REAL_CS_PATH, 'utf8')
    const rows   = await parseComsec(text)
    const trades = rows.filter(r => r.rowType === 'Trade')
    expect(trades.length).toBeGreaterThan(0)
    expect(trades.every(r => r.instrumentType === 'Equity')).toBe(true)
    expect(trades.every(r => r.quantity > 0)).toBe(true)
  })

  it('every row has a valid date', async () => {
    const text = readFileSync(REAL_CS_PATH, 'utf8')
    const rows = await parseComsec(text)
    expect(rows.every(r => r.date instanceof Date && !isNaN(r.date))).toBe(true)
  })

  it('MoneyMovement rows exist (deposits, withdrawals)', async () => {
    const text = readFileSync(REAL_CS_PATH, 'utf8')
    const rows = await parseComsec(text)
    const mm   = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm.length).toBeGreaterThan(0)
  })

})
