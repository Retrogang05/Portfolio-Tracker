import Papa from 'papaparse'

// Tradestation "Historical Activity Report" CSV format:
//
//   # -----------------------------------------------
//   TradeStation Historical Activity Report
//   Report Type: Trades
//   ...
//   # -----------------------------------------------
//
//   "Date","Symbol","CUSIP","Side","Quantity","Price","Principal","Commission","Other Fees","Net Amount","Order ID"
//   "06/16/2026","PLTR 260618P132","...","","1.00","$2.00","-$200.00","-$5.80","-$0.03","-$205.83","1234LEG1"
//   "06/16/2026","PLTR 260618P132","...","SellToClose","-1.00","$2.11","$211.00","-$5.80","-$0.04","$205.16","1234LEG2"
//
// Side: '' = open (direction from Quantity sign), 'SellToClose', 'BuyToClose'
// Symbol: "<UNDERLYING> <YYMMDD><C|P><STRIKE>" e.g. "PLTR 260618P132", "GLW 260626C202.5"

const parseNum = s => {
  if (!s || s === '' || s === '--') return 0
  return parseFloat(String(s).replace(/[$,]/g, ''))
}

// "PLTR 260618P132" → { underlying, expiration, callPut, strike }
function parseSymbol(symbol) {
  const match = (symbol || '').trim().match(/^([A-Z]+)\s+(\d{2})(\d{2})(\d{2})([CP])([\d.]+)$/)
  if (!match) return null
  const [, underlying, yy, mm, dd, cp, strikeStr] = match
  return {
    underlying,
    expiration: `${2000 + parseInt(yy, 10)}-${mm}-${dd}`,
    callPut: cp === 'C' ? 'CALL' : 'PUT',
    strike: parseFloat(strikeStr),
  }
}

// TradeStation appends a per-leg suffix to the Order ID — "1287151306LEG1",
// "1287151306LEG2" — so every leg of one order carries a DIFFERENT id. Strategy
// detection groups by order id, so each leg of a spread was classified as a
// standalone single-leg trade: an Iron Condor showed up as four separate long/short
// calls and puts. Strip the suffix so the id identifies the ORDER, which is what the
// field is for; the leg is already identified by its symbol.
function normaliseOrderId(raw) {
  return (raw || '').trim().replace(/LEG\d+$/i, '')
}

// "06/16/2026" → Date (MM/DD/YYYY, local midnight)
function parseDate(dateStr) {
  if (!dateStr) return new Date(NaN)
  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return new Date(NaN)
  const [m, d, y] = parts
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
}

// Equity (share) rows carry a bare padded ticker — "FIG   " — rather than an option
// symbol, a real numeric CUSIP, and an explicit Side. Unlike IBKR, direction never has
// to be inferred from a running position: TradeStation states it outright.
//   Buy   → open a long        Sell  → close a long
//   Short → open a short       Cover → close a short
const EQUITY_SIDES = {
  BUY:   { openClose: 'Open',  action: 'BUY_TO_OPEN'   },
  SELL:  { openClose: 'Close', action: 'SELL_TO_CLOSE' },
  SHORT: { openClose: 'Open',  action: 'SELL_TO_OPEN'  },
  COVER: { openClose: 'Close', action: 'BUY_TO_CLOSE'  },
}

function mapEquityRow(r, symbol, date) {
  const side = (r['Side'] || '').trim().toUpperCase()
  const spec = EQUITY_SIDES[side]
  if (!spec) return null   // not a share trade we understand

  const ticker = symbol.trim()
  if (!/^[A-Z.]+$/.test(ticker)) return null

  const net = parseNum(r['Net Amount'])   // already signed, net of all fees

  return {
    rowType:        'Trade',
    date,
    timestampSec:   Math.floor(date.getTime() / 1000).toString(),
    orderId:        normaliseOrderId(r['Order ID']),
    subType:        side.charAt(0) + side.slice(1).toLowerCase(),
    action:         spec.action,
    symbol:         ticker,
    underlying:     ticker,
    instrumentType: 'Equity',
    openClose:      spec.openClose,
    quantity:       Math.abs(parseNum(r['Quantity'])),
    expiration:     '',
    strike:         0,
    callPut:        null,
    price:          Math.abs(parseNum(r['Price'])),
    commissions:    parseNum(r['Commission']),
    fees:           parseNum(r['Other Fees']),
    amount:         net,
    description:    `${side.charAt(0) + side.slice(1).toLowerCase()} ${ticker}`,
    isExpiration:   false,
  }
}

function mapRow(r) {
  const symbol  = (r['Symbol']   || '').trim()
  const date = parseDate((r['Date'] || '').trim())
  if (isNaN(date)) return null

  const optInfo = parseSymbol(symbol)
  if (!optInfo) return mapEquityRow(r, symbol, date)

  const side   = (r['Side'] || '').trim()   // '', 'SellToClose', 'BuyToClose'
  const rawQty = parseNum(r['Quantity'])     // signed: positive=buy, negative=sell
  const qty    = Math.abs(rawQty)
  const net    = parseNum(r['Net Amount'])   // already signed, net of all fees

  let openClose, action
  if (side === 'SellToClose') {
    openClose = 'Close'; action = 'SELL_TO_CLOSE'
  } else if (side === 'BuyToClose') {
    openClose = 'Close'; action = 'BUY_TO_CLOSE'
  } else {
    openClose = 'Open'
    action = rawQty < 0 ? 'SELL_TO_OPEN' : 'BUY_TO_OPEN'
  }

  return {
    rowType:        'Trade',
    date,
    timestampSec:   Math.floor(date.getTime() / 1000).toString(),
    orderId:        normaliseOrderId(r['Order ID']),
    subType:        side,
    action,
    symbol,
    underlying:     optInfo.underlying,
    instrumentType: 'Equity Option',
    openClose,
    quantity:       qty,
    expiration:     optInfo.expiration,
    strike:         optInfo.strike,
    callPut:        optInfo.callPut,
    price:          Math.abs(parseNum(r['Price'])),
    commissions:    parseNum(r['Commission']),
    fees:           parseNum(r['Other Fees']),
    amount:         net,
    description:    `${side || 'Open'} ${symbol}`,
    isExpiration:   false,
  }
}

// "YYYY-MM-DD" in LOCAL time — option expirations are parsed as local calendar dates,
// so comparing via toISOString() would shift a day in any non-UTC timezone.
function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// TradeStation does not label assignments — a share delivery from an exercised short
// option is written as an ordinary Buy/Sell. Recover them, because an assignment is a
// different event from a market trade: it drives the wheel / covered-call lifecycle.
//
// A row is only treated as an assignment when ALL of these hold:
//   • no commission and no Order ID   — brokers do not charge for a delivery
//   • price is exactly a strike we were SHORT, expiring that very day
//   • direction agrees — a short CALL delivers shares (sell), a short PUT takes them (buy)
//   • quantity is exactly contracts x 100
//   • no opposing share trade in the same name that day
//
// The last two matter most. Loosening them mislabels ordinary same-day round trips
// that happen to touch a strike price: this account has eight such pairs (KRE, EWZ,
// BABA, V, AMZN, SPY, HD, COST) which are NOT assignments.
function markAssignments(rows) {
  const shortLegs = new Map()   // underlying|expiry|strike|callPut -> contracts
  for (const r of rows) {
    if (!r.callPut || r.isExpiration || r.action !== 'SELL_TO_OPEN') continue
    const k = `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`
    shortLegs.set(k, (shortLegs.get(k) ?? 0) + r.quantity)
  }

  const shareRows = rows.filter(r => r.instrumentType === 'Equity')

  for (const r of shareRows) {
    if (Math.abs(r.commissions ?? 0) > 0.005 || r.orderId) continue

    const delivered = r.action.startsWith('SELL')       // shares leaving = short call
    const callPut   = delivered ? 'CALL' : 'PUT'
    const contracts = shortLegs.get(`${r.underlying}|${localISODate(r.date)}|${r.price}|${callPut}`)
    if (!contracts) continue
    if (Math.abs(r.quantity - contracts * 100) > 0.001) continue

    const hasOpposingSameDay = shareRows.some(x =>
      x !== r &&
      x.underlying === r.underlying &&
      localISODate(x.date) === localISODate(r.date) &&
      x.action.startsWith('SELL') !== delivered
    )
    if (hasOpposingSameDay) continue

    r.rowType     = 'Assignment'
    r.subType     = 'Assignment'
    r.description = delivered
      ? `Assigned — ${r.quantity} ${r.underlying} called away @ $${r.price}`
      : `Assigned — ${r.quantity} ${r.underlying} put to us @ $${r.price}`
  }

  return rows
}

// For options past expiry with no close in the CSV, synthesise a worthless
// expiration row so buildTrades can produce a closed P&L entry.
function addSyntheticExpirations(rows) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const net = {}
  const openRows = {}

  // Options only — share rows have no expiry to run past.
  const optionRows = rows.filter(r => r.callPut != null)

  for (const r of [...optionRows].sort((a, b) => a.date - b.date)) {
    const k = `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`
    if (net[k] === undefined) net[k] = 0
    // BUY actions add to position; SELL actions subtract
    net[k] += r.action.startsWith('BUY') ? r.quantity : -r.quantity
    if (r.openClose === 'Open') openRows[k] = r
  }

  const synthetic = []
  for (const [k, remaining] of Object.entries(net)) {
    if (Math.abs(remaining) < 0.0001) continue   // fully closed
    const proto = openRows[k]
    if (!proto) continue
    // expiration is ISO "YYYY-MM-DD" → parse as UTC midnight to avoid timezone shifts
    const expDate = new Date(proto.expiration + 'T00:00:00Z')
    if (isNaN(expDate) || expDate.getTime() >= today.getTime()) continue

    const closeDate = new Date(expDate)
    closeDate.setUTCHours(21, 0, 0, 0)  // ~4 pm ET

    synthetic.push({
      ...proto,
      rowType:      'Expiration',
      date:         closeDate,
      timestampSec: Math.floor(closeDate.getTime() / 1000).toString(),
      orderId:      '',
      quantity:     Math.abs(remaining),
      openClose:    'Close',
      action:       remaining > 0 ? 'SELL_TO_CLOSE' : 'BUY_TO_CLOSE',
      price:        0, amount: 0, commissions: 0, fees: 0,
      isExpiration: true,
    })
  }

  return [...rows, ...synthetic]
}

// The report has a metadata header block before the actual CSV columns.
// Parse header:false, find the "Date" row, then manually map columns.
// Map one parsed CSV into raw rows. Assignment recovery and synthetic expirations are
// deliberately NOT done here — both span the whole account history (a short leg opened
// in one export can be assigned in the next, and expirations depend on the net position
// across every file), so they run once after all files are merged.
// ── Cash Activity report ─────────────────────────────────────────────────────
//
// A separate TradeStation export ("Report Type: Cash Activity") carrying the money
// that is not a trade: deposits, transfers, interest, dividends, withholding and
// platform charges. Four columns — Date, Description, Amount, Currency — and the
// description is all there is to classify on.

// Description prefix → money-movement subType. Order matters: the more specific
// patterns must win (NRA WITHHOLD: DIVIDEND is a withholding, not a dividend).
const CASH_RULES = [
  [/^ACATS JOURNAL/i,                    'Deposit'],          // account transfer in
  [/^CASH RECEIVED WIRE/i,               'Deposit'],
  [/^JNL FRM /i,                         'Deposit'],          // journal from another account
  [/^JNL TO /i,                          'Withdrawal'],       // journal to another account
  [/^\d+\.\d+%\d{2}\/\d{2}-\d{2}\/\d{2}/, 'Debit Interest'],  // "11.75000%07/01-07/31  $6848"
  [/^FPL (REVENUE|INTEREST CR)/i,        'Credit Interest'],  // fully-paid lending income
  [/^NRA WITHHOLD/i,                     'Foreign Tax Withholding'],
  [/^TRADESTATION/i,                     'Fee'],              // platform and market-data charges
]

function classifyCash(desc, amount) {
  for (const [re, subType] of CASH_RULES) if (re.test(desc)) return subType
  // "CISCO SYS INC              200" — a company name and a share count, paid in.
  if (amount > 0 && /\s\d+$/.test(desc)) return 'Dividend'
  return amount >= 0 ? 'Deposit' : 'Withdrawal'
}

function cashRowsFrom(data, headerIdx) {
  const headers = data[headerIdx].map(h => h.trim())
  const raw = data.slice(headerIdx + 1).map(cells => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim() })
    return obj
  }).filter(o => o.Date && o.Description)

  // Same-day entries under one description that sum to zero are bookkeeping, not
  // money: "SHORT ACCT. MARK TO MARKET" and the monthly "TradeStation Charges" both
  // post as an exact +/- pair. Drop those. Only zero-sum groups go — two
  // "JNL TO 210WRF95" -$20,000 rows on 8 Jul are two real withdrawals, and
  // collapsing same-day duplicates wholesale would lose $20,000.
  const groups = new Map()
  for (const o of raw) {
    const k = `${o.Date}|${o.Description}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(o)
  }
  const kept = []
  for (const g of groups.values()) {
    const net = g.reduce((s, o) => s + parseNum(o.Amount), 0)
    if (g.length > 1 && Math.abs(net) < 0.005) continue
    kept.push(...g)
  }

  // "FPL Revenue" and "FPL INTEREST CR" post the SAME lending income twice. The
  // proof is the withholding beside them: on 4 Aug, $0.08 is 30% (the NRA rate) of
  // one $0.25 line, not of both. Keep the credit; drop the revenue line it mirrors.
  const fplCredits = new Set(
    kept.filter(o => /^FPL INTEREST CR/i.test(o.Description))
        .map(o => `${o.Date}|${parseNum(o.Amount)}`)
  )
  const deduped = kept.filter(o =>
    !(/^FPL REVENUE/i.test(o.Description) && fplCredits.has(`${o.Date}|${parseNum(o.Amount)}`))
  )

  const rows = deduped.map((o, i) => {
    const date   = parseDate(o.Date)
    const amount = parseNum(o.Amount)
    const desc   = o.Description.replace(/\s+/g, ' ').trim()
    const subType = classifyCash(desc, amount)
    // A dividend line names the company rather than the ticker; keep the name so the
    // dividend report groups it as something other than "?".
    const payer = subType === 'Dividend' ? desc.replace(/\s+\d+$/, '').trim() : ''
    return {
      rowType:        'MoneyMovement',
      date,
      timestampSec:   Math.floor(date.getTime() / 1000).toString(),
      orderId:        `TS-cash-${i}`,
      subType,
      action:         '',
      symbol:         payer,
      underlying:     payer,
      instrumentType: 'Cash',
      openClose:      null,
      quantity:       0,
      expiration:     '',
      strike:         0,
      callPut:        null,
      price:          0,
      commissions:    0,
      fees:           0,
      amount,
      currency:       (o.Currency || 'USD').trim(),
      description:    desc,
      isExpiration:   false,
    }
  })

  // Withholding on a dividend carries no payer of its own. Borrow it from the
  // dividend paid the same day, so the dividend report can net the two.
  for (const w of rows) {
    if (w.subType !== 'Foreign Tax Withholding' || !/DIVIDEND/i.test(w.description)) continue
    const div = rows.find(d => d.subType === 'Dividend' && +d.date === +w.date)
    if (div) { w.symbol = div.symbol; w.underlying = div.underlying }
  }

  return rows
}

// Map one parsed CSV into raw rows. Detects which of TradeStation's report types it
// is from the column header: the Trades report and the Cash Activity report are
// separate exports, uploaded together.
//
// Assignment recovery and synthetic expirations are deliberately NOT done here —
// both span the whole account history (a short leg opened in one export can be
// assigned in the next, and expirations depend on the net position across every
// file), so they run once after all files are merged.
function rawRowsFrom(data) {
  const cashIdx = data.findIndex(r => r[0] === 'Date' && r[1] === 'Description')
  if (cashIdx !== -1) return cashRowsFrom(data, cashIdx)

  const headerIdx = data.findIndex(r => r[0] === 'Date' && r[1] === 'Symbol')
  if (headerIdx === -1) {
    throw new Error('Could not find column headers. Make sure this is a Tradestation Trades or Cash Activity report CSV.')
  }

  const headers = data[headerIdx].map(h => h.trim())
  return data
    .slice(headerIdx + 1)
    .map(cells => {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim() })
      return mapRow(obj)
    })
    .filter(Boolean)
}

// Identity of a transaction, for collapsing rows that appear in two overlapping exports.
function rowIdentity(r) {
  return [
    r.date?.getTime(), r.symbol, r.subType, r.action,
    r.quantity, r.price, r.amount, r.orderId,
  ].join('|')
}

// Merge exports, allowing each distinct transaction the HIGHEST number of times it
// appears in any single file.
//
// Not a plain Set: identical fills legitimately repeat within one export — an order
// filling in equal clips at one price — and collapsing those loses real trades.
// Counting per file keeps genuine repeats while still discarding the copies an
// overlapping date range brings.
function mergeFiles(perFile) {
  const allowed = new Map()
  for (const fileRows of perFile) {
    const counts = new Map()
    for (const r of fileRows) {
      const id = rowIdentity(r)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const [id, n] of counts) {
      if (n > (allowed.get(id) ?? 0)) allowed.set(id, n)
    }
  }

  const emitted = new Map()
  const rows = []
  for (const fileRows of perFile) {
    for (const r of fileRows) {
      const id = rowIdentity(r)
      const n = emitted.get(id) ?? 0
      if (n >= (allowed.get(id) ?? 0)) continue
      emitted.set(id, n + 1)
      rows.push(r)
    }
  }
  return rows.sort((a, b) => a.date - b.date)
}

function finalise(rows) {
  // Recover assignments before synthesising expirations, so a short leg that was
  // assigned is not also reported as having expired worthless.
  markAssignments(rows)

  const withExp = addSyntheticExpirations(rows)
  console.log('[TS] parsed', rows.length, 'rows →',
              rows.filter(r => r.callPut != null).length, 'option,',
              rows.filter(r => r.instrumentType === 'Equity').length, 'share,',
              rows.filter(r => r.rowType === 'Assignment').length, 'assignments,',
              withExp.filter(r => r.isExpiration).length, 'expirations')
  return withExp
}

function papaParse(source) {
  return new Promise((resolve, reject) => {
    Papa.parse(source, {
      header: false, skipEmptyLines: true,
      complete: ({ data }) => {
        try { resolve(rawRowsFrom(data)) } catch (e) { reject(e) }
      },
      error: reject,
    })
  })
}

export async function parseCSVText(csvTextOrTexts) {
  const texts = Array.isArray(csvTextOrTexts) ? csvTextOrTexts : [csvTextOrTexts]
  return finalise(mergeFiles(await Promise.all(texts.map(papaParse))))
}

/**
 * Parse one or more Tradestation Historical Activity Reports into a single row set.
 *
 * History may be split across exports (e.g. per financial year). They must be handed
 * over together: assignment recovery matches a share delivery against the short option
 * leg it came from, and synthetic expirations depend on the net position — both of
 * which span files.
 */
export async function parseAllTradestation(fileOrFiles) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]
  if (!files.length) return []
  return finalise(mergeFiles(await Promise.all(files.map(papaParse))))
}
