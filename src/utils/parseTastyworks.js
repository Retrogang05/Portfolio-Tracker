import Papa from 'papaparse'

// Actual Tastytrade CSV columns (from real export):
// Date, Type, Sub Type, Action, Symbol, Instrument Type, Description,
// Value, Quantity, Average Price, Commissions, Fees, Multiplier,
// Root Symbol, Underlying Symbol, Expiration Date, Strike Price,
// Call or Put, Order #, Total, Currency

export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: ({ data, errors }) => {
        if (errors.length) {
          reject(new Error(errors[0].message))
          return
        }
        try {
          resolve(transformRows(data))
        } catch (e) {
          reject(e)
        }
      },
      error: reject,
    })
  })
}

const parseNum = s => {
  if (!s || s === '--' || s === '') return 0
  return parseFloat(String(s).replace(/,/g, ''))
}

function transformRows(rows) {
  return rows
    .filter(r => {
      const type = (r['Type'] || '').trim()
      const subType = (r['Sub Type'] || '').trim()
      // Trades + expiration events (treated as $0 close)
      return (
        type === 'Trade' ||
        (type === 'Receive Deliver' && subType === 'Expiration')
      )
    })
    .map(r => {
      const action = (r['Action'] || '').trim() // BUY_TO_OPEN, SELL_TO_OPEN, BUY_TO_CLOSE, SELL_TO_CLOSE
      const callPut = (r['Call or Put'] || '').trim().toUpperCase() // 'CALL' or 'PUT'
      const isExpiration = (r['Type'] || '').trim() === 'Receive Deliver'

      const date = parseDate(r['Date'] || '')
      return {
        date,
        // Seconds-precision string used as fallback group key for same-moment trades
        timestampSec: Math.floor(date.getTime() / 1000).toString(),
        orderId: (r['Order #'] || '').trim(),
        subType: (r['Sub Type'] || '').trim(),
        action,
        symbol: (r['Symbol'] || '').trim(),
        underlying: (r['Underlying Symbol'] || '').trim(),
        openClose: action.includes('OPEN') ? 'Open' : 'Close',
        quantity: Math.abs(parseNum(r['Quantity'])),
        expiration: (r['Expiration Date'] || '').trim(),
        strike: parseNum(r['Strike Price']),
        callPut,
        price: Math.abs(parseNum(r['Average Price'])),
        commissions: parseNum(r['Commissions']),
        fees: parseNum(r['Fees']),
        // Total is the net cash flow (Value + Commissions + Fees)
        amount: parseNum(r['Total']),
        isExpiration,
      }
    })
    // Keep only options rows (skip stock rows from assignments, etc.)
    .filter(r => r.callPut === 'CALL' || r.callPut === 'PUT')
}

function parseDate(str) {
  // Tastytrade format: "2026-05-01T07:00:00+1000"
  return new Date(str)
}
