import Papa from 'papaparse'

// Tradestation CSV columns:
// Account Number, Type, TradeInd, Transaction, Quantity, Cusip, ADP, Symbol,
// CallPut, UnderlyingSymbol, ExpireDate, StrikePrice, TD, SD, Activity Date,
// Price, Amount, CurrencyCode, Commission, Description, Activity Time, Order ID

const parseNum = s => {
  if (!s || s === '' || s === '--') return 0
  return parseFloat(String(s).replace(/,/g, ''))
}

function parseDate(dateStr, timeStr) {
  if (!dateStr) return new Date(NaN)
  if (timeStr) {
    // "6/18/2026 10:31:33:703" — last colon is milliseconds separator
    const cleaned = timeStr.replace(/(\d+):(\d+):(\d+):(\d+)$/, '$1:$2:$3.$4')
    const d = new Date(cleaned)
    if (!isNaN(d)) return d
  }
  return new Date(dateStr)
}

// Normalise "M/D/YYYY" → "YYYY-MM-DD" without any timezone conversion
function normaliseExpiry(str) {
  if (!str) return ''
  // Handle M/D/YYYY or MM/DD/YYYY
  const parts = str.trim().split('/')
  if (parts.length === 3) {
    const [m, d, y] = parts
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return str.trim()
}

function legKey(row) {
  return `${row.underlying}|${row.expiration}|${row.strike}|${row.callPut}`
}

// Two-pass: determine openClose for each row by simulating FIFO per contract
function assignOpenClose(rows) {
  // Sort ascending by date for simulation
  const sorted = [...rows].sort((a, b) => a.date - b.date)

  // net position per contract key: positive = long, negative = short
  const net = {}

  for (const r of sorted) {
    const k = legKey(r)
    if (net[k] === undefined) net[k] = 0

    const qty = r.quantity  // always positive at this point
    const isBuy = r._isBuy

    if (isBuy) {
      r.openClose = net[k] >= 0 ? 'Open' : 'Close'
      net[k] += qty
    } else {
      r.openClose = net[k] <= 0 ? 'Open' : 'Close'
      net[k] -= qty
    }
  }

  return rows
}

function mapRow(r) {
  const transaction = (r['Transaction'] || '').trim()
  const callPut     = (r['CallPut'] || '').trim().toUpperCase()
  const dateStr     = (r['Activity Date'] || '').trim()
  const timeStr     = (r['Activity Time'] || '').trim()
  const date        = parseDate(dateStr, timeStr)
  const isBuy       = transaction === 'Buy'
  const qty         = Math.abs(parseNum(r['Quantity'])) / 100  // shares → contracts
  const price       = Math.abs(parseNum(r['Price']))
  const rawAmount   = Math.abs(parseNum(r['Amount']))
  const commission  = Math.abs(parseNum(r['Commission']))
  const underlying  = (r['UnderlyingSymbol'] || '').trim()
  const expiration  = normaliseExpiry((r['ExpireDate'] || '').trim())
  const strike      = parseNum(r['StrikePrice'])

  // Determine row type — only option trades in this CSV
  const isOption = callPut === 'CALL' || callPut === 'PUT'
  const rowType  = isOption ? 'Trade' : 'Other'

  // Amount sign: sells are credits (+), buys are debits (-)
  // The Amount column is always stored as a positive number in Tradestation
  const amount = isBuy ? -rawAmount : rawAmount

  return {
    rowType,
    date,
    timestampSec:  Math.floor(date.getTime() / 1000).toString(),
    orderId:       (r['Order ID'] || '').trim(),
    subType:       '',
    _isBuy:        isBuy,
    openClose:     null,  // filled in by assignOpenClose
    action:        isBuy ? 'BUY_TO_OPEN' : 'SELL_TO_OPEN',  // placeholder, overwritten
    symbol:        (r['Symbol'] || '').trim(),
    underlying,
    instrumentType: isOption ? 'Equity Option' : 'Equity',
    quantity:      qty,
    expiration,
    strike,
    callPut:       callPut || null,
    price,
    commissions:   commission,
    fees:          0,
    amount,
    description:   (r['Description'] || '').trim(),
    isExpiration:  false,
  }
}

// Tradestation doesn't emit expiration rows. For any open positions whose
// expiry date has already passed, synthesise a worthless-expiration close so
// buildTrades can produce a closed P&L entry.
function addSyntheticExpirations(rows) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Simulate net quantity per contract key (same FIFO logic as assignOpenClose)
  const net = {}   // key → net qty (positive = long, negative = short)
  const openRows = {}  // key → last Open row (for prototype to clone)

  const sorted = [...rows].sort((a, b) => a.date - b.date)
  for (const r of sorted) {
    const k = legKey(r)
    if (net[k] === undefined) net[k] = 0
    // _origSign: +1 for buys, -1 for sells (regardless of Open/Close direction)
    // Accumulating signed qty gives the true net position
    net[k] += r._origSign * r.quantity
    if (r.openClose === 'Open') openRows[k] = r
  }

  const synthetic = []
  for (const [k, remaining] of Object.entries(net)) {
    if (Math.abs(remaining) < 0.0001) continue   // fully closed
    const proto = openRows[k]
    if (!proto) continue
    const expDate = new Date(proto.expiration)
    if (isNaN(expDate) || expDate >= today) continue  // not yet expired

    // Expiration date at end-of-day (after market close)
    const expCloseDate = new Date(expDate)
    expCloseDate.setHours(16, 0, 0, 0)

    synthetic.push({
      ...proto,
      rowType:      'Expiration',
      date:         expCloseDate,
      timestampSec: Math.floor(expCloseDate.getTime() / 1000).toString(),
      orderId:      '',
      quantity:     Math.abs(remaining),
      // Closing direction is opposite of the open
      openClose:    'Close',
      action:       remaining > 0 ? 'SELL_TO_CLOSE' : 'BUY_TO_CLOSE',
      price:        0,
      amount:       0,
      commissions:  0,
      fees:         0,
      isExpiration: true,
      _isBuy:       undefined,
      _origSign:    undefined,
    })
  }

  return [...rows, ...synthetic]
}

function parseRows(data) {
  const rows = data
    .map(mapRow)
    .filter(r => r.rowType === 'Trade' && (r.callPut === 'CALL' || r.callPut === 'PUT'))

  assignOpenClose(rows)

  // Tag each row with its directional sign before cleaning up _isBuy
  for (const r of rows) {
    r._origSign = r._isBuy ? 1 : -1
    if (r._isBuy) {
      r.action = r.openClose === 'Open' ? 'BUY_TO_OPEN' : 'BUY_TO_CLOSE'
    } else {
      r.action = r.openClose === 'Open' ? 'SELL_TO_OPEN' : 'SELL_TO_CLOSE'
    }
    delete r._isBuy
  }

  const withExpirations = addSyntheticExpirations(rows)

  // Clean up internal field
  for (const r of withExpirations) delete r._origSign

  return withExpirations
}

function _parsePapaResult({ data, errors }, resolve, reject) {
  if (errors.length) { reject(new Error(errors[0].message)); return }
  try {
    const rows = parseRows(data)
    console.log('[TS] parsed', data.length, 'raw rows →', rows.length, 'option rows')
    console.log('[TS] opens:', rows.filter(r => r.openClose === 'Open').length,
                'closes:', rows.filter(r => r.openClose === 'Close').length)
    console.log('[TS] sample legKey:', rows[0] ? `${rows[0].underlying}|${rows[0].expiration}|${rows[0].strike}|${rows[0].callPut}` : 'none')
    resolve(rows)
  } catch (e) { reject(e) }
}

// For testing: accepts a raw CSV string instead of a File object
export function parseCSVText(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim(),
      complete: r => _parsePapaResult(r, resolve, reject),
      error: reject,
    })
  })
}

export function parseAllTradestation(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim(),
      complete: r => _parsePapaResult(r, resolve, reject),
      error: reject,
    })
  })
}
