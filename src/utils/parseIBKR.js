import Papa from 'papaparse'

const parseNum = s => {
  if (!s || s === '-' || s === '') return 0
  return parseFloat(String(s).replace(/,/g, ''))
}

function parseDate(str) {
  if (!str || str === '-') return new Date(NaN)
  return new Date(str + 'T12:00:00') // noon avoids DST edge cases
}

// "ALAB  260717C00210000" → { underlying, expiration, callPut, strike }
// IBKR OCC symbol: ticker (padded) + YYMMDD + C/P + strike*1000
function parseOptionSymbol(symbol) {
  const match = (symbol || '').trim().match(/^(\S+)\s+(\d{6})([CP])(\d+)$/)
  if (!match) return null
  const [, root, d, cp, strikeStr] = match
  const mm = parseInt(d.slice(2, 4), 10)
  const dd = parseInt(d.slice(4, 6), 10)
  const yy = parseInt(d.slice(0, 2), 10)
  return {
    underlying: root,
    expiration: `${mm}/${dd}/${yy}`, // match Tastytrade "M/D/YY" format
    callPut: cp === 'C' ? 'CALL' : 'PUT',
    strike: parseInt(strikeStr, 10) / 1000,
  }
}

function mapRow(r, idx) {
  const txType = (r['Transaction Type'] || '').trim()
  const symbol  = (r['Symbol']           || '').trim()
  const qty     = parseNum(r['Quantity'])
  const price   = parseNum(r['Price'])
  const comm    = parseNum(r['Commission'])
  const net     = parseNum(r['Net Amount'])
  const date    = parseDate(r['Date'])
  const desc    = (r['Description'] || '').trim()
  const ts      = Math.floor(date.getTime() / 1000).toString()

  // Skip FX noise and pure accounting entries
  const skipTypes = ['Forex Trade Component', 'Adjustment', 'FX Translation', 'Transfer']
  if (skipTypes.includes(txType)) return null
  if (symbol === 'AUD.USD' || symbol === 'USD.AUD') return null

  // ── Money movements ──────────────────────────────────────────────────────────
  const mmTypes = ['Credit Interest', 'Debit Interest', 'Dividend',
                   'Foreign Tax Withholding', 'Deposit', 'Electronic Fund Transfer', 'Withdrawal']
  if (mmTypes.includes(txType)) {
    return {
      rowType: 'MoneyMovement',
      date, timestampSec: ts, orderId: `IBKR-mm-${idx}`,
      subType: txType, action: '',
      symbol: symbol !== '-' ? symbol : '',
      underlying: symbol !== '-' ? symbol : '',
      instrumentType: 'Cash',
      openClose: null, quantity: 0,
      expiration: '', strike: 0, callPut: null,
      price: 0, commissions: 0, fees: 0,
      amount: net, description: desc, isExpiration: false,
    }
  }

  // ── Assignment / Exercise (equity delivery via option) ───────────────────────
  if (txType === 'Assignment' || txType === 'Exercise') {
    return {
      rowType: txType,
      date, timestampSec: ts, orderId: `IBKR-${txType.toLowerCase()}-${idx}`,
      subType: txType,
      action: qty < 0 ? 'SELL_TO_CLOSE' : 'BUY_TO_OPEN',
      symbol, underlying: symbol,
      instrumentType: 'Equity',
      openClose: qty < 0 ? 'Close' : 'Open',
      quantity: Math.abs(qty), expiration: '', strike: 0, callPut: null,
      price: Math.abs(price), commissions: comm, fees: 0,
      amount: net, description: desc, isExpiration: false,
    }
  }

  // ── Trades (Buy / Sell) ───────────────────────────────────────────────────────
  if (txType !== 'Buy' && txType !== 'Sell') return null
  if (!symbol || symbol === '-') return null

  const optInfo = parseOptionSymbol(symbol)
  const isOption = optInfo !== null
  const dateStr  = (r['Date'] || '').slice(0, 10)

  const base = {
    rowType: 'Trade',
    date, timestampSec: ts,
    // stable group key: same symbol on same day groups partial fills together
    orderId: `${dateStr}|${symbol}`,
    subType: txType,
    action: qty >= 0 ? 'BUY' : 'SELL', // refined by inferOpenClose later
    symbol,
    instrumentType: isOption ? 'Option' : 'Equity',
    openClose: null,          // set by inferOpenClose
    _signedQty: qty,          // signed, for position tracking (stripped later)
    quantity: Math.abs(qty),
    price: Math.abs(price),
    commissions: comm, fees: 0,
    amount: net,
    description: desc,
    isExpiration: false,
  }

  if (isOption) {
    return { ...base, underlying: optInfo.underlying, expiration: optInfo.expiration,
             callPut: optInfo.callPut, strike: optInfo.strike }
  }
  return { ...base, underlying: symbol, expiration: '', callPut: null, strike: 0 }
}

// Consolidate same-day partial fills of the same instrument in the same direction
// into a single row (weighted-average price, summed qty/amount/commissions).
// IBKR splits large orders into many partial fills that are logically one purchase.
function consolidatePartialFills(rows) {
  const tradeRows    = rows.filter(r => r.rowType === 'Trade')
  const nonTradeRows = rows.filter(r => r.rowType !== 'Trade')

  // Group by date + symbol + openClose direction
  const groups = new Map()
  for (const row of tradeRows) {
    const dateStr  = row.date.toISOString().slice(0, 10)
    const dir      = (row._signedQty ?? 0) >= 0 ? 'buy' : 'sell'
    const key = `${dateStr}|${row.symbol}|${dir}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const merged = []
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue }

    const totalQty   = group.reduce((s, r) => s + r.quantity, 0)
    const totalAmt   = group.reduce((s, r) => s + r.amount, 0)
    const totalComm  = group.reduce((s, r) => s + r.commissions, 0)
    const wAvgPrice  = group.reduce((s, r) => s + r.price * r.quantity, 0) / totalQty
    const descriptions = [...new Set(group.map(r => r.description))].join(' / ')

    merged.push({
      ...group[0],               // keep all fields from first fill
      quantity:    totalQty,
      amount:      totalAmt,
      price:       wAvgPrice,
      commissions: totalComm,
      description: descriptions,
      // _signedQty: sum (used for position tracking before this step)
      _signedQty:  group.reduce((s, r) => s + (r._signedQty ?? 0), 0),
    })
  }

  return [...nonTradeRows, ...merged].sort((a, b) => a.date - b.date)
}

// FIFO position tracking: infers openClose + action from net position changes
function inferOpenClose(tradeRows) {
  const sorted = [...tradeRows].sort((a, b) => a.date - b.date)
  const positions = {}

  for (const row of sorted) {
    const key = row.instrumentType === 'Equity'
      ? row.underlying
      : `${row.underlying}|${row.expiration}|${row.strike}|${row.callPut}`

    const pos = positions[key] ?? 0
    const qty = row._signedQty

    if (pos === 0 || Math.sign(pos) === Math.sign(qty)) {
      row.openClose = 'Open'
      row.action = qty > 0 ? 'BUY_TO_OPEN' : 'SELL_TO_OPEN'
    } else {
      row.openClose = 'Close'
      row.action = qty > 0 ? 'BUY_TO_CLOSE' : 'SELL_TO_CLOSE'
    }
    positions[key] = pos + qty
  }
}

// IBKR exports don't always include expiration rows. For any option position
// still open past its expiry date, synthesise a worthless-expiration close.
function addSyntheticExpirations(rows) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const optionTrades = rows.filter(r => r.rowType === 'Trade' && r.callPut)

  // Track net signed qty per contract key
  const net = {}
  const openRows = {}

  const sorted = [...optionTrades].sort((a, b) => a.date - b.date)
  for (const r of sorted) {
    const k = `${r.underlying}|${r.expiration}|${r.strike}|${r.callPut}`
    if (net[k] === undefined) net[k] = 0
    const signed = r.openClose === 'Open'
      ? (r.action.startsWith('BUY') ? r.quantity : -r.quantity)
      : (r.action.startsWith('BUY') ? r.quantity : -r.quantity)
    net[k] += signed
    if (r.openClose === 'Open') openRows[k] = r
  }

  const synthetic = []
  for (const [k, remaining] of Object.entries(net)) {
    if (Math.abs(remaining) < 0.0001) continue
    const proto = openRows[k]
    if (!proto) continue
    // IBKR expiration strings are "M/D/YY" — parse carefully
    const expDate = new Date(proto.expiration)
    if (isNaN(expDate) || expDate >= today) continue

    const expCloseDate = new Date(expDate)
    expCloseDate.setHours(16, 0, 0, 0)

    synthetic.push({
      ...proto,
      rowType:      'Expiration',
      date:         expCloseDate,
      timestampSec: Math.floor(expCloseDate.getTime() / 1000).toString(),
      orderId:      '',
      quantity:     Math.abs(remaining),
      openClose:    'Close',
      action:       remaining > 0 ? 'SELL_TO_CLOSE' : 'BUY_TO_CLOSE',
      price:        0,
      amount:       0,
      commissions:  0,
      fees:         0,
      isExpiration: true,
    })
  }

  return [...rows, ...synthetic]
}

export function parseAllIBKR(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: ({ data }) => {
        try {
          // Find the Transaction History header row embedded in the multi-section file
          const headerRow = data.find(r =>
            r[0] === 'Transaction History' && r[1] === 'Header'
          )
          if (!headerRow) {
            throw new Error('Could not find Transaction History section. Make sure this is an IBKR Transaction History export.')
          }

          const cols = headerRow.slice(2) // ['Date', 'Account', 'Description', ...]

          // Extract and map all data rows
          const rows = data
            .filter(r => r[0] === 'Transaction History' && r[1] === 'Data')
            .map((r, i) => {
              const obj = {}
              cols.forEach((col, j) => { obj[col] = (r[j + 2] || '').trim() })
              return mapRow(obj, i)
            })
            .filter(Boolean)

          // Merge same-day partial fills before inferring direction,
          // so position tracking sees the consolidated quantities
          const consolidated = consolidatePartialFills(rows)

          // Infer open/close for trade rows using position tracking
          const tradeRows = consolidated.filter(r => r.rowType === 'Trade')
          inferOpenClose(tradeRows)

          // Strip internal field
          consolidated.forEach(r => { delete r._signedQty })

          resolve(addSyntheticExpirations(consolidated))
        } catch (e) {
          reject(e)
        }
      },
      error: reject,
    })
  })
}
