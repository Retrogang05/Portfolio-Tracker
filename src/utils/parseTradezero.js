import Papa from 'papaparse'

// TradeZero CSV columns:
// Account, T/D, S/D, Currency, Type, Side, Symbol, Qty, Price, Exec Time,
// Comm, SEC, TAF, NSCC, Nasdaq, ECN Remove, ECN Add, Gross Proceeds, Net Proceeds,
// Clr Broker, Liq, Note
//
// Side: B = Buy long, S = Sell long, SS = Short Sell, BC = Buy to Cover
// Options symbol: OCC format — e.g. AMD260626C00555000
//   = <underlying><YYMMDD><C|P><8-digit strike×1000>

const parseNum = s => {
  if (!s || s === '' || s === '-') return 0
  return parseFloat(String(s).replace(/,/g, ''))
}

// T/D is "M/DD/YYYY", Exec Time is "HH:MM:SS"
function parseDate(tdStr, timeStr) {
  if (!tdStr) return new Date(NaN)
  const d = new Date(`${tdStr} ${timeStr || ''}`.trim())
  if (!isNaN(d)) return d
  return new Date(tdStr)
}

// OCC option symbol parser: AMD260626C00555000
function parseOptionSymbol(symbol) {
  const match = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/)
  if (!match) return null
  const [, underlying, yy, mm, dd, cp, strikeStr] = match
  const year = 2000 + parseInt(yy, 10)
  // ISO date avoids any timezone shifting when used as a string key
  const expiration = `${year}-${mm}-${dd}`
  return {
    underlying,
    expiration,
    callPut: cp === 'C' ? 'CALL' : 'PUT',
    strike: parseInt(strikeStr, 10) / 1000,
  }
}

function mapRow(r, idx) {
  const side   = (r['Side']   || '').trim()   // B, S, SS, BC
  const symbol = (r['Symbol'] || '').trim()
  const qty    = Math.abs(parseNum(r['Qty']))
  const price  = Math.abs(parseNum(r['Price']))
  const comm   = Math.abs(parseNum(r['Comm']))
  const sec    = Math.abs(parseNum(r['SEC']))
  const taf    = Math.abs(parseNum(r['TAF']))
  const nscc   = Math.abs(parseNum(r['NSCC']))
  const nasdaq = Math.abs(parseNum(r['Nasdaq']))
  const ecnRem = Math.abs(parseNum(r['ECN Remove']))
  const ecnAdd = Math.abs(parseNum(r['ECN Add']))
  // Net Proceeds: already signed (negative = outflow/buy, positive = inflow/sell)
  const net    = parseNum(r['Net Proceeds'])
  const date   = parseDate((r['T/D'] || '').trim(), (r['Exec Time'] || '').trim())
  const ts     = Math.floor(date.getTime() / 1000).toString()

  if (!symbol || !side) return null

  // B = buy long, BC = buy to cover short → adding to position (+)
  // S = sell long, SS = short sell → reducing / shorting (-)
  const isBuy     = side === 'B' || side === 'BC'
  const signedQty = isBuy ? qty : -qty

  const optInfo = parseOptionSymbol(symbol)
  const isOption = optInfo !== null

  const base = {
    rowType:        'Trade',
    date,
    timestampSec:   ts,
    orderId:        `${(r['T/D'] || '').trim()}|${symbol}|${ts}`,
    subType:        side,
    action:         isBuy ? 'BUY' : 'SELL',   // refined by inferOpenClose
    symbol,
    instrumentType: isOption ? 'Equity Option' : 'Equity',
    openClose:      null,                        // set by inferOpenClose
    _signedQty:     signedQty,
    quantity:       qty,
    price,
    commissions:    comm,
    fees:           sec + taf + nscc + nasdaq + ecnRem + ecnAdd,
    amount:         net,                         // Net Proceeds: already net of all fees
    description:    '',
    isExpiration:   false,
  }

  if (isOption) {
    return { ...base, underlying: optInfo.underlying, expiration: optInfo.expiration,
             callPut: optInfo.callPut, strike: optInfo.strike }
  }
  return { ...base, underlying: symbol, expiration: '', callPut: null, strike: 0 }
}

// FIFO position tracking: infers openClose + action from net position changes.
// Handles both long (B/S) and short (SS/BC) directions.
function inferOpenClose(tradeRows) {
  const sorted    = [...tradeRows].sort((a, b) => a.date - b.date)
  const positions = {}

  for (const row of sorted) {
    const key = row.instrumentType === 'Equity Option'
      ? `${row.underlying}|${row.expiration}|${row.strike}|${row.callPut}`
      : row.underlying

    const pos = positions[key] ?? 0
    const qty = row._signedQty   // signed (+buy, -sell/short)

    if (pos === 0 || Math.sign(pos) === Math.sign(qty)) {
      row.openClose = 'Open'
      row.action    = qty > 0 ? 'BUY_TO_OPEN' : 'SELL_TO_OPEN'
    } else {
      row.openClose = 'Close'
      row.action    = qty > 0 ? 'BUY_TO_CLOSE' : 'SELL_TO_CLOSE'
    }
    positions[key] = pos + qty
  }
}

// Synthesise worthless-expiration close rows for any option positions that are
// still open past their expiry date (TradeZero doesn't emit expiration events).
function addSyntheticExpirations(rows) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const optionTrades = rows.filter(r => r.instrumentType === 'Equity Option')
  const net      = {}
  const openRows = {}

  const sorted = [...optionTrades].sort((a, b) => a.date - b.date)
  for (const r of sorted) {
    const k = `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`
    if (net[k] === undefined) net[k] = 0
    net[k] += r._signedQty
    if (r.openClose === 'Open') openRows[k] = r
  }

  const synthetic = []
  for (const [k, remaining] of Object.entries(net)) {
    if (Math.abs(remaining) < 0.0001) continue
    const proto = openRows[k]
    if (!proto) continue
    // expiration is stored as ISO "YYYY-MM-DD" → parse as UTC midnight
    const expDate = new Date(proto.expiration + 'T00:00:00Z')
    if (isNaN(expDate) || expDate.getTime() >= today.getTime()) continue

    const expCloseDate = new Date(expDate)
    expCloseDate.setUTCHours(21, 0, 0, 0)   // ~4pm ET in UTC

    synthetic.push({
      ...proto,
      rowType:       'Expiration',
      date:          expCloseDate,
      timestampSec:  Math.floor(expCloseDate.getTime() / 1000).toString(),
      orderId:       '',
      quantity:      Math.abs(remaining),
      _signedQty:    remaining > 0 ? -Math.abs(remaining) : Math.abs(remaining),
      openClose:     'Close',
      action:        remaining > 0 ? 'SELL_TO_CLOSE' : 'BUY_TO_CLOSE',
      price:         0,
      amount:        0,
      commissions:   0,
      fees:          0,
      isExpiration:  true,
    })
  }

  return [...rows, ...synthetic]
}

function _processData(data, errors, resolve, reject) {
  if (errors.length) { reject(new Error(errors[0].message)); return }
  try {
    const rows = data.map(mapRow).filter(Boolean)
    inferOpenClose(rows)
    const withExp = addSyntheticExpirations(rows)
    withExp.forEach(r => { delete r._signedQty })
    resolve(withExp)
  } catch (e) { reject(e) }
}

// For testing: accepts a raw CSV string instead of a File object
export function parseCSVText(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim(),
      complete: ({ data, errors }) => _processData(data, errors, resolve, reject),
      error: reject,
    })
  })
}

export function parseAllTradezero(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim(),
      complete: ({ data, errors }) => _processData(data, errors, resolve, reject),
      error: reject,
    })
  })
}
