import Papa from 'papaparse'

// Actual Tastytrade CSV columns (from real export):
// Date, Type, Sub Type, Action, Symbol, Instrument Type, Description,
// Value, Quantity, Average Price, Commissions, Fees, Multiplier,
// Root Symbol, Underlying Symbol, Expiration Date, Strike Price,
// Call or Put, Order #, Total, Currency

// ── Shared helpers ────────────────────────────────────────────────────────────

const parseNum = s => {
  if (!s || s === '--' || s === '') return 0
  return parseFloat(String(s).replace(/,/g, ''))
}

function parseDate(str) {
  return new Date(str)
}

function rowType(r) {
  const type    = (r['Type']     || '').trim()
  const subType = (r['Sub Type'] || '').trim()
  const instr   = (r['Instrument Type'] || '').trim()
  if (type === 'Trade')                                            return 'Trade'
  if (type === 'Receive Deliver' && subType === 'Expiration')     return 'Expiration'
  if (type === 'Receive Deliver' && subType === 'Assignment')     return 'Assignment'
  if (type === 'Receive Deliver' && instr === 'Equity')           return 'EquityDelivery'
  if (type === 'Money Movement')                                   return 'MoneyMovement'
  return 'Other'
}

function mapRow(r) {
  const action  = (r['Action']      || '').trim()
  const callPut = (r['Call or Put'] || '').trim().toUpperCase()
  const date    = parseDate(r['Date'] || '')
  return {
    rowType:        rowType(r),
    date,
    timestampSec:   Math.floor(date.getTime() / 1000).toString(),
    orderId:        (r['Order #']           || '').trim(),
    subType:        (r['Sub Type']          || '').trim(),
    action,
    symbol:         (r['Symbol']            || '').trim(),
    underlying:     (r['Underlying Symbol'] || '').trim() || (r['Symbol'] || '').trim(),
    instrumentType: (r['Instrument Type']   || '').trim(),
    openClose:      action.includes('OPEN') ? 'Open' : action.includes('CLOSE') ? 'Close' : null,
    quantity:       Math.abs(parseNum(r['Quantity'])),
    expiration:     (r['Expiration Date']   || '').trim(),
    strike:         parseNum(r['Strike Price']),
    callPut:        callPut || null,
    price:          Math.abs(parseNum(r['Average Price'])),
    commissions:    parseNum(r['Commissions']),
    fees:           parseNum(r['Fees']),
    amount:         parseNum(r['Total']),
    description:    (r['Description']       || '').trim(),
    isExpiration:   (r['Type'] || '').trim() === 'Receive Deliver' && (r['Sub Type'] || '').trim() === 'Expiration',
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Used by the P&L pipeline — returns only option trade + expiration rows.
 */
export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: ({ data, errors }) => {
        if (errors.length) { reject(new Error(errors[0].message)); return }
        try {
          resolve(
            data.map(mapRow)
              .filter(r => (r.rowType === 'Trade' || r.rowType === 'Expiration') &&
                           (r.callPut === 'CALL' || r.callPut === 'PUT'))
          )
        } catch (e) { reject(e) }
      },
      error: reject,
    })
  })
}

/**
 * Used by the Wheel/PMCC detector — returns ALL rows with rowType set.
 * Consumers filter by rowType as needed.
 */
export function parseAllCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: ({ data, errors }) => {
        if (errors.length) { reject(new Error(errors[0].message)); return }
        try { resolve(data.map(mapRow)) } catch (e) { reject(e) }
      },
      error: reject,
    })
  })
}
