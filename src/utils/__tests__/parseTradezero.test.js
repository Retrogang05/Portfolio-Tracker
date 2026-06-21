import { describe, it, expect } from 'vitest'
import { parseCSVText } from '../parseTradezero.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

const HEADER = 'Account,T/D,S/D,Currency,Type,Side,Symbol,Qty,Price,Exec Time,Comm,SEC,TAF,NSCC,Nasdaq,ECN Remove,ECN Add,Gross Proceeds,Net Proceeds,Clr Broker,Liq,Note'

function makeRow({ date, side, symbol, qty, price, time = '09:30:00', comm = 0, sec = 0, taf = 0, nscc = 0, nasdaq = 0, ecnRem = 0, ecnAdd = 0, gross, net }) {
  const grossVal = gross ?? (side === 'B' || side === 'BC' ? -(qty * price) : qty * price)
  const netVal   = net   ?? grossVal
  return `TZ123,${date},${date},USD,${symbol.match(/\d{6}[CP]/) ? 'Option' : 'Stock'},${side},${symbol},${qty},${price},${time},${comm},${sec},${taf},${nscc},${nasdaq},${ecnRem},${ecnAdd},${grossVal},${netVal},CLR,,`
}

function csv(...rows) {
  return [HEADER, ...rows].join('\n')
}

// ── Stock rows ─────────────────────────────────────────────────────────────────

const AAPL_BUY  = makeRow({ date:'6/20/2026', side:'B',  symbol:'AAPL', qty:100, price:150, net:-15000 })
const AAPL_SELL = makeRow({ date:'6/20/2026', side:'S',  symbol:'AAPL', qty:100, price:155, net:15500  })
const SPY_SHORT = makeRow({ date:'6/20/2026', side:'SS', symbol:'SPY',  qty:50,  price:540, net:27000  })
const SPY_COVER = makeRow({ date:'6/20/2026', side:'BC', symbol:'SPY',  qty:50,  price:535, net:-26750 })

// ── Option rows ────────────────────────────────────────────────────────────────

// AMD260626C00555000 → AMD, 2026-06-26, CALL, 555.0
const AMD_CALL_BUY  = makeRow({ date:'6/20/2026', side:'B', symbol:'AMD260626C00555000', qty:1, price:2.50, net:-250 })
const AMD_CALL_SELL = makeRow({ date:'6/20/2026', side:'S', symbol:'AMD260626C00555000', qty:1, price:3.00, net:300  })

// Past-expiry option with no close (expiry: 6/18/2026)
const QQQ_PUT_BUY = makeRow({ date:'6/18/2026', side:'B', symbol:'QQQ260618P00735000', qty:2, price:2.15, net:-430 })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseTradezero', () => {

  // ── OCC symbol parsing ──────────────────────────────────────────────────────

  it('parses AMD OCC option symbol correctly', async () => {
    const rows = await parseCSVText(csv(AMD_CALL_BUY))
    const r = rows.find(r => !r.isExpiration)

    expect(r.underlying).toBe('AMD')
    expect(r.callPut).toBe('CALL')
    expect(r.strike).toBe(555)
    expect(r.expiration).toBe('2026-06-26')
    expect(r.instrumentType).toBe('Equity Option')
  })

  it('parses QQQ PUT OCC symbol correctly', async () => {
    const rows = await parseCSVText(csv(QQQ_PUT_BUY))
    const r = rows.find(r => !r.isExpiration)

    expect(r.underlying).toBe('QQQ')
    expect(r.callPut).toBe('PUT')
    expect(r.strike).toBe(735)
    expect(r.expiration).toBe('2026-06-18')
  })

  // ── Long equity ─────────────────────────────────────────────────────────────

  it('classifies equity B as BUY_TO_OPEN', async () => {
    const rows = await parseCSVText(csv(AAPL_BUY, AAPL_SELL))
    const buy  = rows.find(r => r.action === 'BUY_TO_OPEN')
    const sell = rows.find(r => r.action === 'SELL_TO_CLOSE')
    expect(buy).toBeDefined()
    expect(sell).toBeDefined()
    expect(buy.instrumentType).toBe('Equity')
    expect(buy.underlying).toBe('AAPL')
  })

  // ── Short equity ─────────────────────────────────────────────────────────────

  it('classifies SS as SELL_TO_OPEN and BC as BUY_TO_CLOSE', async () => {
    const rows = await parseCSVText(csv(SPY_SHORT, SPY_COVER))
    const short = rows.find(r => r.action === 'SELL_TO_OPEN')
    const cover = rows.find(r => r.action === 'BUY_TO_CLOSE')
    expect(short).toBeDefined()
    expect(cover).toBeDefined()
  })

  // ── Option open/close ────────────────────────────────────────────────────────

  it('options round-trip: buy opens, sell closes', async () => {
    const rows = await parseCSVText(csv(AMD_CALL_BUY, AMD_CALL_SELL))
    const tradeRows = rows.filter(r => !r.isExpiration)
    const open  = tradeRows.find(r => r.openClose === 'Open')
    const close = tradeRows.find(r => r.openClose === 'Close')
    expect(open).toBeDefined()
    expect(close).toBeDefined()
  })

  // ── Amount / Net Proceeds ───────────────────────────────────────────────────

  it('uses Net Proceeds as amount (negative for buy, positive for sell)', async () => {
    const rows = await parseCSVText(csv(AMD_CALL_BUY, AMD_CALL_SELL))
    const tradeRows = rows.filter(r => !r.isExpiration)
    const buyRow  = tradeRows.find(r => r.openClose === 'Open')
    const sellRow = tradeRows.find(r => r.openClose === 'Close')

    expect(buyRow.amount).toBeCloseTo(-250)
    expect(sellRow.amount).toBeCloseTo(300)
  })

  // ── Synthetic expiration ─────────────────────────────────────────────────────

  it('adds synthetic expiration for past-expiry open option', async () => {
    const rows = await parseCSVText(csv(QQQ_PUT_BUY))
    const expRow = rows.find(r => r.isExpiration)

    expect(expRow).toBeDefined()
    expect(expRow.underlying).toBe('QQQ')
    expect(expRow.openClose).toBe('Close')
    expect(expRow.amount).toBe(0)
    expect(expRow.quantity).toBe(2)
    expect(expRow.rowType).toBe('Expiration')
  })

  it('does NOT add synthetic expiration for a fully closed option', async () => {
    const rows = await parseCSVText(csv(AMD_CALL_BUY, AMD_CALL_SELL))
    const expRows = rows.filter(r => r.isExpiration)
    expect(expRows).toHaveLength(0)
  })

  // ── Required fields ──────────────────────────────────────────────────────────

  it('each row has required fields', async () => {
    const rows = await parseCSVText(csv(AAPL_BUY, AAPL_SELL, AMD_CALL_BUY, AMD_CALL_SELL))
    for (const r of rows) {
      expect(r).toHaveProperty('rowType')
      expect(r).toHaveProperty('date')
      expect(r).toHaveProperty('underlying')
      expect(r).toHaveProperty('instrumentType')
      expect(r).toHaveProperty('quantity')
      expect(r).toHaveProperty('price')
      expect(r).toHaveProperty('amount')
      expect(r).toHaveProperty('openClose')
      expect(r).toHaveProperty('action')
      expect(r._signedQty).toBeUndefined()  // internal field cleaned up
    }
  })

  // ── P&L ──────────────────────────────────────────────────────────────────────

  it('option round-trip P&L: sell proceeds minus buy cost', async () => {
    const rows = await parseCSVText(csv(AMD_CALL_BUY, AMD_CALL_SELL))
    const pnl = rows.filter(r => !r.isExpiration).reduce((s, r) => s + r.amount, 0)
    // 300 − 250 = 50
    expect(pnl).toBeCloseTo(50)
  })

  it('short-sell equity P&L: short proceeds minus cover cost', async () => {
    const rows = await parseCSVText(csv(SPY_SHORT, SPY_COVER))
    const pnl = rows.reduce((s, r) => s + r.amount, 0)
    // Shorted at 27000, covered at 26750 → profit 250
    expect(pnl).toBeCloseTo(250)
  })

  // ── Mixed file: both equity and options ──────────────────────────────────────

  it('parses a mixed file with both equity and options', async () => {
    const rows = await parseCSVText(csv(AAPL_BUY, AMD_CALL_BUY, AMD_CALL_SELL, AAPL_SELL))
    const equityRows = rows.filter(r => r.instrumentType === 'Equity')
    const optionRows = rows.filter(r => r.instrumentType === 'Equity Option')
    expect(equityRows.length).toBeGreaterThanOrEqual(2)
    expect(optionRows.length).toBeGreaterThanOrEqual(2)
  })

})
