import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseAllIBKR } from '../parseIBKR.js'
import { fixture } from './fixtures.js'

// IBKR CSV is a multi-section file. The real export drives most assertions, but the
// multi-file and same-day-ordering rules below are exercised with minimal inline CSVs
// so they run even without the export on disk.

const REAL_IBKR_PATH = fixture('IBKR', /^U24130472\..*\.csv$/i)

describe.skipIf(!REAL_IBKR_PATH)('parseIBKR (real file)', () => {

  it('parses without throwing', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('every row has a rowType', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.every(r => typeof r.rowType === 'string' && r.rowType.length > 0)).toBe(true)
  })

  it('Trade rows have required fields', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows    = await parseAllIBKR(csvText)
    const trades  = rows.filter(r => r.rowType === 'Trade')

    expect(trades.length).toBeGreaterThan(0)

    for (const r of trades) {
      expect(r).toHaveProperty('underlying')
      expect(r).toHaveProperty('expiration')
      expect(r).toHaveProperty('openClose')
      expect(r.quantity).toBeGreaterThanOrEqual(0)
    }

    // Option-specific checks (only run if options present in this export)
    const optTrades = trades.filter(r => r.instrumentType === 'Equity Option')
    for (const r of optTrades) {
      expect(r.callPut === 'CALL' || r.callPut === 'PUT').toBe(true)
      expect(r).toHaveProperty('strike')
      expect(r.openClose === 'Open' || r.openClose === 'Close').toBe(true)
    }
  })

  it('every row has a valid date', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.every(r => r.date instanceof Date && !isNaN(r.date))).toBe(true)
  })

  it('no internal _signedQty fields leak out', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.every(r => r._signedQty === undefined)).toBe(true)
  })

  it('synthetic expirations have amount=0 and isExpiration=true', async () => {
    const csvText  = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows     = await parseAllIBKR(csvText)
    const expRows  = rows.filter(r => r.isExpiration)
    for (const r of expRows) {
      expect(r.amount).toBe(0)
      expect(r.openClose).toBe('Close')
      expect(r.rowType).toBe('Expiration')
    }
  })

  it('MoneyMovement rows have instrumentType Cash', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows    = await parseAllIBKR(csvText)
    const mm = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm.length).toBeGreaterThan(0)
    expect(mm.every(r => r.instrumentType === 'Cash')).toBe(true)
  })

})


// ── Inline: multi-file merging and same-day ordering ─────────────────────────

const IBKR_HEAD = [
  'Statement,Header,Field Name,Field Value',
  'Summary,Data,Base Currency,AUD',
  'Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount ,Commission,Net Amount',
].join('\n')

const ibkr = (...rows) => [IBKR_HEAD, ...rows].join('\n')

const equity = (date, side, qty, sym, price, net) =>
  `Transaction History,Data,${date},U***1,${sym} CORP,${side},${sym},${qty},${price},USD,${net},-1.0,${net}`

const option = (date, side, qty, occ, price, net) =>
  `Transaction History,Data,${date},U***1,${occ} desc,${side},${occ},${qty},${price},USD,${net},-1.0,${net}`

const equityTrades = (rows, sym) =>
  rows.filter(r => r.rowType === 'Trade' && r.instrumentType === 'Equity' && r.underlying === sym)

describe('parseAllIBKR — history split across several exports', () => {

  // Direction is inferred from the running position, so files must be merged BEFORE
  // that runs. Parsing each alone and concatenating shows the later file's sell against
  // a zero position and labels it SELL_TO_OPEN — inventing a short, and downstream a
  // phantom open holding. Measured on the real split exports, doing this wrong moved
  // realised P&L by ~$4.9k and invented two positions.
  it('treats a sell in a later file as closing a buy from an earlier one', async () => {
    const fy1 = ibkr(equity('2026-03-02', 'Buy',  '100.0', 'AAPL', '200.0', '-20000'))
    const fy2 = ibkr(equity('2026-08-04', 'Sell', '-100.0', 'AAPL', '210.0', '21000'))

    const merged = await parseAllIBKR([fy1, fy2])
    const t = equityTrades(merged, 'AAPL')
    expect(t).toHaveLength(2)
    expect(t.find(r => r.subType === 'Buy').action).toBe('BUY_TO_OPEN')
    expect(t.find(r => r.subType === 'Sell').action).toBe('SELL_TO_CLOSE')
  })

  it('drops duplicate transactions when exports overlap', async () => {
    const a = ibkr(equity('2026-03-02', 'Buy', '100.0', 'AAPL', '200.0', '-20000'))
    const once  = await parseAllIBKR([a])
    const twice = await parseAllIBKR([a, a])
    expect(twice).toHaveLength(once.length)
  })

  // Identical transactions legitimately repeat within one export — two equal transfers
  // on the same day, or an order filling in equal clips. The real exports contain both
  // (three identical LITE sells on 28 Apr; paired ORCL/SMR/SPXW fills). Collapsing them
  // silently loses real money: it cost $100,000 of deposits in one account and ~$2,800
  // of option P&L in another.
  it('keeps genuine repeats inside a single export', async () => {
    const csv = ibkr(
      `Transaction History,Data,2026-08-12,U***1,Electronic Fund Transfer,Deposit,-,-,-,-,100000.0,-,100000.0`,
      `Transaction History,Data,2026-08-12,U***1,Electronic Fund Transfer,Deposit,-,-,-,-,100000.0,-,100000.0`,
    )
    const rows = await parseAllIBKR(csv)
    const deposits = rows.filter(r => r.rowType === 'MoneyMovement' && r.subType === 'Deposit')
    expect(deposits).toHaveLength(2)
    expect(deposits.reduce((s, r) => s + r.amount, 0)).toBe(200000)
  })

  // Overlap must still collapse: the repeat count kept is the highest seen in ANY ONE
  // file, not the sum across files.
  it('keeps repeats once, not twice, when the same export is supplied twice', async () => {
    const csv = ibkr(
      `Transaction History,Data,2026-08-12,U***1,Electronic Fund Transfer,Deposit,-,-,-,-,100000.0,-,100000.0`,
      `Transaction History,Data,2026-08-12,U***1,Electronic Fund Transfer,Deposit,-,-,-,-,100000.0,-,100000.0`,
    )
    const rows = await parseAllIBKR([csv, csv])
    const total = rows
      .filter(r => r.rowType === 'MoneyMovement' && r.subType === 'Deposit')
      .reduce((s, r) => s + r.amount, 0)
    expect(total).toBe(200000)
  })

  it('still accepts a single file passed unwrapped', async () => {
    const a = ibkr(equity('2026-03-02', 'Buy', '100.0', 'AAPL', '200.0', '-20000'))
    expect(await parseAllIBKR(a)).toHaveLength((await parseAllIBKR([a])).length)
  })

})

describe('parseAllIBKR — same-day ordering', () => {

  // IBKR rows carry a date but no time, and the export is newest-first, so a same-day
  // buy+sell pair arrives sell-first. The account is cash-only and cannot short.
  it('orders a same-day equity buy before the sell', async () => {
    const csv = ibkr(
      equity('2026-06-12', 'Sell', '-200.0', 'HOOD', '95.5', '19100'),
      equity('2026-06-12', 'Buy',  '200.0',  'HOOD', '91.0', '-18200'),
    )
    const t = equityTrades(await parseAllIBKR(csv), 'HOOD')
    expect(t.find(r => r.subType === 'Buy').action).toBe('BUY_TO_OPEN')
    expect(t.find(r => r.subType === 'Sell').action).toBe('SELL_TO_CLOSE')
  })

  // Regression: ordering was a pairwise special-case that compared only equity-trade
  // pairs and returned 0 otherwise. That is not transitive — with an option row O at
  // the same date, cmp(buy,O)=0 and cmp(O,sell)=0 while cmp(buy,sell)<0 — so the sort
  // was free to leave the buy after the sell. A real HOOD round trip hit exactly this.
  it('still orders the buy first when an option row shares the date', async () => {
    const csv = ibkr(
      equity('2026-06-12', 'Sell', '-200.0', 'HOOD', '95.5', '19100'),
      option('2026-06-12', 'Sell', '-1.0', 'HOOD  260619P00090000', '1.5', '150'),
      equity('2026-06-12', 'Buy',  '200.0',  'HOOD', '91.0', '-18200'),
    )
    const t = equityTrades(await parseAllIBKR(csv), 'HOOD')
    expect(t.find(r => r.subType === 'Buy').action).toBe('BUY_TO_OPEN')
    expect(t.find(r => r.subType === 'Sell').action).toBe('SELL_TO_CLOSE')
  })

  // Premium selling opens with a SELL, so options must keep their recorded order.
  it('leaves a same-day option sell-to-open then buy-to-close alone', async () => {
    const csv = ibkr(
      option('2026-06-12', 'Sell', '-1.0', 'AAPL  260619P00200000', '2.0', '200'),
      option('2026-06-12', 'Buy',  '1.0',  'AAPL  260619P00200000', '1.0', '-100'),
    )
    const rows = (await parseAllIBKR(csv)).filter(r => r.rowType === 'Trade' && r.callPut === 'PUT')
    expect(rows.find(r => r.subType === 'Sell').action).toBe('SELL_TO_OPEN')
    expect(rows.find(r => r.subType === 'Buy').action).toBe('BUY_TO_CLOSE')
  })

})
