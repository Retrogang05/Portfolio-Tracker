import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseCSVText } from '../parseTradestation.js'
import { fixture } from './fixtures.js'

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

const REAL_TS_PATH = fixture('TradeStation', /^trades_activity.*\.csv$/i)

describe.skipIf(!REAL_TS_PATH)('parseTradestation (real Activity Report file)', () => {

  it('parses without throwing', async () => {
    const text = readFileSync(REAL_TS_PATH, 'utf8')
    const rows = await parseCSVText(text)
    expect(rows.length).toBeGreaterThan(0)
  })

  // Deliberately not asserting an exact row count: the fixture is whichever export
  // is on disk, and its date range changes with every re-download. Assert the
  // invariants that must hold for ANY export instead.
  it('every non-expiration row is a well-formed option or share row', async () => {
    const text  = readFileSync(REAL_TS_PATH, 'utf8')
    const rows  = await parseCSVText(text)
    const trades = rows.filter(r => !r.isExpiration)
    expect(trades.length).toBeGreaterThan(0)
    expect(trades.every(r => r.quantity > 0)).toBe(true)
    expect(trades.every(r => r.openClose === 'Open' || r.openClose === 'Close')).toBe(true)

    // The report mixes options and shares; each must be well-formed in its own way.
    const options = trades.filter(r => r.instrumentType === 'Equity Option')
    const shares  = trades.filter(r => r.instrumentType === 'Equity')
    expect(options.length + shares.length).toBe(trades.length)
    expect(options.length).toBeGreaterThan(0)
    expect(options.every(r => r.callPut === 'CALL' || r.callPut === 'PUT')).toBe(true)
    expect(options.every(r => r.expiration && r.strike > 0)).toBe(true)
    expect(shares.every(r => r.callPut === null && r.strike === 0)).toBe(true)
    expect(shares.every(r => /^[A-Z.]+$/.test(r.underlying))).toBe(true)
  })

  it('reads share trades, including assignment deliveries', async () => {
    const text   = readFileSync(REAL_TS_PATH, 'utf8')
    const rows   = await parseCSVText(text)
    const shares = rows.filter(r => r.instrumentType === 'Equity')
    expect(shares.length).toBeGreaterThan(0)
    // Direction comes from TradeStation's explicit Side, never inferred
    expect(shares.every(r => ['BUY_TO_OPEN','SELL_TO_CLOSE','SELL_TO_OPEN','BUY_TO_CLOSE'].includes(r.action))).toBe(true)
    // Buys cost money, sells raise it
    expect(shares.filter(r => r.action.startsWith('BUY')).every(r => r.amount <= 0)).toBe(true)
    expect(shares.filter(r => r.action.startsWith('SELL')).every(r => r.amount >= 0)).toBe(true)
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

  it('runs end-to-end through buildTrades producing coherent closed trades', async () => {
    const { buildTrades } = await import('../calculatePnL.js')
    const { tagRowsWithStrategy } = await import('../identifyStrategy.js')
    const text   = readFileSync(REAL_TS_PATH, 'utf8')
    const rows   = await parseCSVText(text)
    const tagged = tagRowsWithStrategy(rows)
    const { closedTrades } = buildTrades(tagged)
    expect(closedTrades.length).toBeGreaterThan(0)
    expect(closedTrades.every(t => t.strategyName)).toBe(true)
    expect(closedTrades.every(t => Number.isFinite(t.pnl))).toBe(true)
    expect(closedTrades.every(t => t.closeDate >= t.openDate)).toBe(true)
  })

})


// ── Share trades and assignment recovery ─────────────────────────────────────

const TS_HEAD = [
  '# -----------------------------------------------',
  'TradeStation Historical Activity Report',
  'Report Type: Trades',
  '# -----------------------------------------------',
  '',
  '"Date","Symbol","CUSIP","Side","Quantity","Price","Principal","Commission","Other Fees","Net Amount","Order ID"',
].join('\n')

const ts = (...rows) => [TS_HEAD, ...rows].join('\n')

// Share row. Assignments carry no commission and no Order ID.
const share = (date, side, qty, sym, price, net, { comm = '$0.00', order = '' } = {}) =>
  `"${date}","${sym.padEnd(6)}","123456789","${side}","${qty}","${price}","$0.00","${comm}","$0.00","${net}","${order.padEnd(20)}"`

const shortCall = (date, occ, qty, price, net) =>
  `"${date}","${occ}","696!!VK~8","","${qty}","${price}","$0.00","-$1.00","$0.00","${net}","1234LEG1            "`

describe('parseTradestation — share trades', () => {

  it('reads share rows, which were previously discarded entirely', async () => {
    const rows = await parseCSVText(ts(
      share('08/19/2026', 'Buy', '100.00', 'CSCO', '$111.56', '-$11,161.25', { comm: '-$5.00', order: '1298811437' }),
    ))
    const shares = rows.filter(r => r.instrumentType === 'Equity')
    expect(shares).toHaveLength(1)
    expect(shares[0].underlying).toBe('CSCO')
    expect(shares[0].quantity).toBe(100)
    expect(shares[0].amount).toBeCloseTo(-11161.25, 2)
  })

  // Direction is stated by TradeStation, never inferred from a running position.
  it('maps Buy/Sell/Short/Cover to the right open-close direction', async () => {
    const rows = await parseCSVText(ts(
      share('08/01/2026', 'Buy',   '100.00',  'AAA', '$10.00', '-$1,000.00', { comm: '-$1.00', order: '1' }),
      share('08/02/2026', 'Sell',  '-100.00', 'AAA', '$11.00',  '$1,100.00', { comm: '-$1.00', order: '2' }),
      share('08/03/2026', 'Short', '-100.00', 'BBB', '$20.00',  '$2,000.00', { comm: '-$1.00', order: '3' }),
      share('08/04/2026', 'Cover', '100.00',  'BBB', '$19.00', '-$1,900.00', { comm: '-$1.00', order: '4' }),
    ))
    const by = a => rows.find(r => r.action === a)
    expect(by('BUY_TO_OPEN').openClose).toBe('Open')
    expect(by('SELL_TO_CLOSE').openClose).toBe('Close')
    expect(by('SELL_TO_OPEN').openClose).toBe('Open')
    expect(by('BUY_TO_CLOSE').openClose).toBe('Close')
  })

})

describe('parseTradestation — assignment recovery', () => {

  // A short call assigned at expiry: shares leave at exactly the strike, with no
  // commission and no Order ID. TradeStation writes it as a plain Sell.
  it('recognises a short call assigned at expiry', async () => {
    const rows = await parseCSVText(ts(
      shortCall('07/27/2026', 'FIG 260731C24', '-1.00', '$0.48', '$45.21'),
      share('07/31/2026', 'Sell', '-100.00', 'FIG', '$24.00', '$2,399.93'),
    ))
    const a = rows.filter(r => r.rowType === 'Assignment')
    expect(a).toHaveLength(1)
    expect(a[0].underlying).toBe('FIG')
    expect(a[0].quantity).toBe(100)
    expect(a[0].description).toMatch(/called away/)
  })

  it('recognises a short put assigned at expiry', async () => {
    const rows = await parseCSVText(ts(
      `"08/10/2026","CSCO 260814P113","172!!W#$2","","-2.00","$1.26","$252.00","-$3.00","-$0.06","$248.94","1295298252LEG2      "`,
      share('08/14/2026', 'Buy', '200.00', 'CSCO', '$113.00', '-$22,600.00'),
    ))
    const a = rows.filter(r => r.rowType === 'Assignment')
    expect(a).toHaveLength(1)
    expect(a[0].description).toMatch(/put to us/)
  })

  // Direction must agree: a short CALL delivers shares. A BUY at a call strike is not
  // an assignment of that call.
  it('does not treat a buy at a short call strike as an assignment', async () => {
    const rows = await parseCSVText(ts(
      shortCall('07/27/2026', 'FIG 260731C24', '-1.00', '$0.48', '$45.21'),
      share('07/31/2026', 'Buy', '100.00', 'FIG', '$24.00', '-$2,400.00'),
    ))
    expect(rows.filter(r => r.rowType === 'Assignment')).toHaveLength(0)
  })

  // Ordinary same-day round trips can touch a strike by coincidence. This account has
  // eight such pairs; none are assignments.
  it('does not treat a same-day round trip at a strike as an assignment', async () => {
    const rows = await parseCSVText(ts(
      shortCall('08/10/2026', 'COST 260814C942.5', '-3.00', '$1.00', '$300.00'),
      share('08/14/2026', 'Short', '-300.00', 'COST', '$942.50', '$282,744.11'),
      share('08/14/2026', 'Cover', '300.00',  'COST', '$945.00', '-$283,500.00'),
    ))
    expect(rows.filter(r => r.rowType === 'Assignment')).toHaveLength(0)
  })

  it('requires the share count to equal contracts x 100', async () => {
    const rows = await parseCSVText(ts(
      shortCall('07/27/2026', 'FIG 260731C24', '-1.00', '$0.48', '$45.21'),
      share('07/31/2026', 'Sell', '-300.00', 'FIG', '$24.00', '$7,200.00'),
    ))
    expect(rows.filter(r => r.rowType === 'Assignment')).toHaveLength(0)
  })

  it('leaves a commissioned share trade at a strike price alone', async () => {
    const rows = await parseCSVText(ts(
      shortCall('07/27/2026', 'FIG 260731C24', '-1.00', '$0.48', '$45.21'),
      share('07/31/2026', 'Sell', '-100.00', 'FIG', '$24.00', '$2,399.93', { comm: '-$5.00', order: '999' }),
    ))
    expect(rows.filter(r => r.rowType === 'Assignment')).toHaveLength(0)
  })

})

// ── Order ID grouping ─────────────────────────────────────────────────────────

describe('parseTradestation — multi-leg order grouping', () => {

  // TradeStation appends LEG1/LEG2/... to the Order ID, giving every leg of one order
  // a different id. Strategy detection groups by order id, so each leg of a spread was
  // classified as a standalone single-leg trade — an Iron Condor appeared as four
  // separate long/short calls and puts, and the strategy breakdown was meaningless.
  it('strips the per-leg suffix so one order has one id', async () => {
    const rows = await parseCSVText(ts(
      `"08/10/2026","CSCO 260814P113","172!!W#$2","","-2.00","$1.26","$252.00","-$3.00","-$0.06","$248.94","1295298252LEG2      "`,
      `"08/10/2026","CSCO 260814P109","172!!W!}2","","2.00","$0.63","-$126.00","-$3.00","-$0.04","-$129.04","1295298252LEG1      "`,
    ))
    // both legs are past expiry with no close, so synthetic expirations are added too
    const opens = rows.filter(r => !r.isExpiration)
    expect(opens).toHaveLength(2)
    expect(new Set(opens.map(r => r.orderId)).size).toBe(1)
    expect(opens[0].orderId).toBe('1295298252')
  })

  it('classifies the legs as one spread rather than two single-leg trades', async () => {
    const { tagRowsWithStrategy } = await import('../identifyStrategy.js')
    const rows = await parseCSVText(ts(
      `"08/10/2026","CSCO 260814P113","172!!W#$2","","-2.00","$1.26","$252.00","-$3.00","-$0.06","$248.94","1295298252LEG2      "`,
      `"08/10/2026","CSCO 260814P109","172!!W!}2","","2.00","$0.63","-$126.00","-$3.00","-$0.04","-$129.04","1295298252LEG1      "`,
    ))
    const tagged = tagRowsWithStrategy(rows)
    const names = new Set(tagged.filter(r => r.strategyName).map(r => r.strategyName))
    expect(names).toEqual(new Set(['Bull Put Spread']))
  })

  it('leaves an order id without a leg suffix untouched', async () => {
    const rows = await parseCSVText(ts(
      share('08/19/2026', 'Buy', '100.00', 'CSCO', '$111.56', '-$11,161.25', { comm: '-$5.00', order: '1298811437' }),
    ))
    expect(rows[0].orderId).toBe('1298811437')
  })

})

// ── Multi-file merging ────────────────────────────────────────────────────────

describe('parseTradestation — history split across exports', () => {

  // Assignment recovery matches a share delivery against the short option leg it came
  // from, and that leg can sit in an earlier export. Parsing files separately misses
  // it: on the real exports, merging finds 5 assignments where the later file alone
  // finds 4.
  it('matches an assignment against a short leg opened in an earlier file', async () => {
    const fy1 = ts(shortCall('06/27/2026', 'FIG 260731C24', '-1.00', '$0.48', '$45.21'))
    const fy2 = ts(share('07/31/2026', 'Sell', '-100.00', 'FIG', '$24.00', '$2,399.93'))

    // separately, the delivery has no short leg to match
    expect((await parseCSVText(fy2)).filter(r => r.rowType === 'Assignment')).toHaveLength(0)

    // merged, it is recognised
    const merged = await parseCSVText([fy1, fy2])
    expect(merged.filter(r => r.rowType === 'Assignment')).toHaveLength(1)
  })

  it('collapses transactions duplicated across overlapping exports', async () => {
    const a = ts(share('08/19/2026', 'Buy', '100.00', 'CSCO', '$111.56', '-$11,161.25', { comm: '-$5.00', order: '1298811437' }))
    const once = await parseCSVText([a])
    expect(await parseCSVText([a, a])).toHaveLength(once.length)
  })

  // Identical fills legitimately repeat within one export — an order filling in equal
  // clips at one price. Collapsing those would lose real trades.
  it('keeps identical fills that repeat inside one export', async () => {
    const csv = ts(
      share('08/19/2026', 'Buy', '100.00', 'CSCO', '$111.56', '-$11,161.25', { comm: '-$5.00', order: '1298811437' }),
      share('08/19/2026', 'Buy', '100.00', 'CSCO', '$111.56', '-$11,161.25', { comm: '-$5.00', order: '1298811437' }),
    )
    const shares = (await parseCSVText(csv)).filter(r => r.instrumentType === 'Equity')
    expect(shares).toHaveLength(2)
  })

  it('still accepts a single export passed unwrapped', async () => {
    const a = ts(share('08/19/2026', 'Buy', '100.00', 'CSCO', '$111.56', '-$11,161.25', { comm: '-$5.00', order: '1' }))
    expect(await parseCSVText(a)).toHaveLength((await parseCSVText([a])).length)
  })

})
