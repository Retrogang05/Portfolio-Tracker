import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseCSVText } from '../parseTradestation.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

// Minimal "Historical Activity Report" format with metadata header block
const META = `# -----------------------------------------------,,,,,,,,,,
TradeStation Historical Activity Report,,,,,,,,,,
Report Type: Trades,,,,,,,,,,
Dates: 6/16/2026 - 6/28/2026,,,,,,,,,,
Account: 12059846,,,,,,,,,,
# -----------------------------------------------,,,,,,,,,,`

const HEADER = '"Date","Symbol","CUSIP","Side","Quantity","Price","Principal","Commission","Other Fees","Net Amount","Order ID"'

function row({ date, symbol, side, qty, price, principal, comm, other, net, id }) {
  return `"${date}","${symbol}","ABC123","${side}","${qty}","$${price}","${principal}","${comm}","${other}","${net}","${id}"`
}

function csv(...rows) {
  return [META, '', HEADER, ...rows].join('\n')
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

// Long call: buy to open, sell to close
const QQQ_C744_OPEN  = row({ date:'06/16/2026', symbol:'QQQ 260616C744', side:'',            qty:'1.00',  price:'1.92',  principal:'-$192.00', comm:'-$5.80', other:'-$0.03', net:'-$197.83', id:'111LEG1' })
const QQQ_C744_CLOSE = row({ date:'06/16/2026', symbol:'QQQ 260616C744', side:'SellToClose', qty:'-1.00', price:'1.54',  principal:'$154.00',  comm:'-$5.80', other:'-$0.04', net:'$148.16',  id:'222LEG1' })

// Short call: sell to open, buy to close
const SMH_C632_OPEN  = row({ date:'06/24/2026', symbol:'SMH 260626C632.5', side:'',          qty:'-2.00', price:'9.30',  principal:'$1,860.00', comm:'$0.00', other:'-$0.08', net:'$1,859.92', id:'333LEG1' })
const SMH_C635_OPEN  = row({ date:'06/24/2026', symbol:'SMH 260626C635',   side:'',          qty:'2.00',  price:'8.63',  principal:'-$1,726.00',comm:'$0.00', other:'-$0.03', net:'-$1,726.03',id:'333LEG2' })

// Expired option (NOW P93, expiry 06/18/2026 — already past)
const NOW_P93_OPEN   = row({ date:'06/18/2026', symbol:'NOW 260618P93',    side:'',          qty:'3.00',  price:'0.95',  principal:'-$285.00', comm:'-$7.40', other:'-$0.05', net:'-$292.45', id:'999LEG1' })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseTradestation (new Activity Report format)', () => {

  it('skips metadata header and parses option rows', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN, QQQ_C744_CLOSE))
    expect(rows.filter(r => !r.isExpiration)).toHaveLength(2)
  })

  it('parses symbol to get underlying, expiry, strike, callPut', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN))
    const r = rows.find(r => !r.isExpiration)
    expect(r.underlying).toBe('QQQ')
    expect(r.callPut).toBe('CALL')
    expect(r.strike).toBe(744)
    expect(r.expiration).toBe('2026-06-16')
  })

  it('handles decimal strikes (SMH 260626C632.5)', async () => {
    const rows = await parseCSVText(csv(SMH_C632_OPEN))
    const r = rows.find(r => !r.isExpiration)
    expect(r.strike).toBe(632.5)
  })

  it('empty Side + positive qty → BUY_TO_OPEN', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN))
    const r = rows.find(r => !r.isExpiration)
    expect(r.action).toBe('BUY_TO_OPEN')
    expect(r.openClose).toBe('Open')
    expect(r.quantity).toBe(1)
  })

  it('SellToClose → SELL_TO_CLOSE', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_CLOSE))
    const r = rows[0]
    expect(r.action).toBe('SELL_TO_CLOSE')
    expect(r.openClose).toBe('Close')
  })

  it('empty Side + negative qty → SELL_TO_OPEN (short)', async () => {
    const rows = await parseCSVText(csv(SMH_C632_OPEN))
    const r = rows.find(r => !r.isExpiration)
    expect(r.action).toBe('SELL_TO_OPEN')
    expect(r.openClose).toBe('Open')
    expect(r.quantity).toBe(2)
  })

  it('Net Amount is used as signed amount', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN, QQQ_C744_CLOSE))
    const open  = rows.find(r => r.action === 'BUY_TO_OPEN')
    const close = rows.find(r => r.action === 'SELL_TO_CLOSE')
    expect(open.amount).toBeCloseTo(-197.83)
    expect(close.amount).toBeCloseTo(148.16)
  })

  it('P&L of a round-trip = sum of amounts', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN, QQQ_C744_CLOSE))
    const pnl = rows.filter(r => !r.isExpiration).reduce((s, r) => s + r.amount, 0)
    // 148.16 − 197.83 = -49.67
    expect(pnl).toBeCloseTo(-49.67, 1)
  })

  it('adds synthetic expiration for past-expiry open (NOW P93)', async () => {
    const rows = await parseCSVText(csv(NOW_P93_OPEN))
    const expRow = rows.find(r => r.isExpiration)
    expect(expRow).toBeDefined()
    expect(expRow.underlying).toBe('NOW')
    expect(expRow.openClose).toBe('Close')
    expect(expRow.amount).toBe(0)
    expect(expRow.quantity).toBe(3)
  })

  it('does NOT add synthetic expiration for a fully closed position', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN, QQQ_C744_CLOSE))
    expect(rows.filter(r => r.isExpiration)).toHaveLength(0)
  })

  it('each row has required fields', async () => {
    const rows = await parseCSVText(csv(QQQ_C744_OPEN, QQQ_C744_CLOSE))
    for (const r of rows) {
      expect(r).toHaveProperty('rowType')
      expect(r).toHaveProperty('date')
      expect(r).toHaveProperty('underlying')
      expect(r).toHaveProperty('expiration')
      expect(r).toHaveProperty('strike')
      expect(r).toHaveProperty('callPut')
      expect(r).toHaveProperty('quantity')
      expect(r).toHaveProperty('amount')
      expect(r).toHaveProperty('openClose')
      expect(r).toHaveProperty('action')
    }
  })

  it('rejects a non-Tradestation CSV (no Date/Symbol header found)', async () => {
    const badCsv = 'foo,bar\n1,2\n3,4'
    await expect(parseCSVText(badCsv)).rejects.toThrow('Could not find column headers')
  })

})

// ── Real-file smoke tests ─────────────────────────────────────────────────────

const REAL_TS_PATH = '/Users/harrysingh/Documents/Claude/Portfolio Transactions/trades_activity_12059846_29MAY2026_28JUN2026.csv'

describe('parseTradestation (real Activity Report file)', () => {

  it('parses without throwing', async () => {
    const text = readFileSync(REAL_TS_PATH, 'utf8')
    const rows = await parseCSVText(text)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('produces 67 option rows from 67 raw rows', async () => {
    const text  = readFileSync(REAL_TS_PATH, 'utf8')
    const rows  = await parseCSVText(text)
    const trades = rows.filter(r => !r.isExpiration)
    expect(trades).toHaveLength(67)
  })

  it('generates synthetic expirations for past-expiry open positions', async () => {
    const text   = readFileSync(REAL_TS_PATH, 'utf8')
    const rows   = await parseCSVText(text)
    const expRows = rows.filter(r => r.isExpiration)
    expect(expRows.length).toBeGreaterThan(0)
    expRows.forEach(r => {
      expect(r.amount).toBe(0)
      expect(r.openClose).toBe('Close')
    })
  })

  it('all rows have valid dates and non-null underlying', async () => {
    const text = readFileSync(REAL_TS_PATH, 'utf8')
    const rows = await parseCSVText(text)
    expect(rows.every(r => r.date instanceof Date && !isNaN(r.date))).toBe(true)
    expect(rows.every(r => typeof r.underlying === 'string' && r.underlying.length > 0)).toBe(true)
  })

  it('produces 33 closed trades through buildTrades', async () => {
    const { buildTrades } = await import('../calculatePnL.js')
    const { tagRowsWithStrategy } = await import('../identifyStrategy.js')
    const text   = readFileSync(REAL_TS_PATH, 'utf8')
    const rows   = await parseCSVText(text)
    const tagged = tagRowsWithStrategy(rows)
    const { closedTrades } = buildTrades(tagged)
    expect(closedTrades).toHaveLength(33)
  })

})
