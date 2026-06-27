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

// "06/16/2026" → Date (MM/DD/YYYY, local midnight)
function parseDate(dateStr) {
  if (!dateStr) return new Date(NaN)
  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return new Date(NaN)
  const [m, d, y] = parts
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
}

function mapRow(r) {
  const symbol  = (r['Symbol']   || '').trim()
  const optInfo = parseSymbol(symbol)
  if (!optInfo) return null   // skip non-option rows

  const date = parseDate((r['Date'] || '').trim())
  if (isNaN(date)) return null

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
    orderId:        (r['Order ID'] || '').trim(),
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

// For options past expiry with no close in the CSV, synthesise a worthless
// expiration row so buildTrades can produce a closed P&L entry.
function addSyntheticExpirations(rows) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const net = {}
  const openRows = {}

  for (const r of [...rows].sort((a, b) => a.date - b.date)) {
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
function _parsePapaResult({ data }, resolve, reject) {
  try {
    const headerIdx = data.findIndex(r => r[0] === 'Date' && r[1] === 'Symbol')
    if (headerIdx === -1) {
      reject(new Error('Could not find column headers. Make sure this is a Tradestation Historical Activity Report CSV.'))
      return
    }

    const headers = data[headerIdx].map(h => h.trim())
    const rows = data
      .slice(headerIdx + 1)
      .map(cells => {
        const obj = {}
        headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim() })
        return mapRow(obj)
      })
      .filter(Boolean)

    const withExp = addSyntheticExpirations(rows)
    console.log('[TS] parsed', data.length - headerIdx - 1, 'raw rows →', rows.length, 'option rows')
    console.log('[TS] opens:', rows.filter(r => r.openClose === 'Open').length,
                'closes:', rows.filter(r => r.openClose === 'Close').length)
    console.log('[TS] expirations:', withExp.filter(r => r.isExpiration).length)
    resolve(withExp)
  } catch (e) { reject(e) }
}

export function parseCSVText(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: false, skipEmptyLines: true,
      complete: r => _parsePapaResult(r, resolve, reject),
      error: reject,
    })
  })
}

export function parseAllTradestation(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false, skipEmptyLines: true,
      complete: r => _parsePapaResult(r, resolve, reject),
      error: reject,
    })
  })
}
