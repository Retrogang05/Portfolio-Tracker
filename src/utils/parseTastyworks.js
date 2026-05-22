import Papa from 'papaparse'

// Tastytrade transaction history CSV columns:
// Date/Time, Transaction Code, Transaction Subcode, Symbol, Buy/Sell,
// Open/Close, Quantity, Expiration Date, Strike, Call/Put, Price, Fees, Amount,
// Description, Account Reference

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

function transformRows(rows) {
  // Keep only trade rows (ignore Money Movement, Receive Deliver, etc.)
  const trades = rows.filter(r => {
    const code = (r['Transaction Code'] || r['Type'] || '').trim()
    return code === 'Trade'
  })

  return trades.map(r => ({
    date: parseDate(r['Date/Time'] || r['Date'] || ''),
    subcode: (r['Transaction Subcode'] || '').trim(),
    symbol: (r['Symbol'] || '').trim(),
    underlying: extractUnderlying(r),
    buySell: (r['Buy/Sell'] || '').trim(),
    openClose: (r['Open/Close'] || '').trim(),
    quantity: parseFloat(r['Quantity'] || 0),
    expiration: (r['Expiration Date'] || '').trim(),
    strike: parseFloat(r['Strike'] || 0),
    callPut: (r['Call/Put'] || '').trim(),
    price: parseFloat(r['Price'] || 0),
    fees: parseFloat(r['Fees'] || 0),
    amount: parseFloat((r['Amount'] || '0').replace(/,/g, '')),
    description: (r['Description'] || '').trim(),
  }))
}

function parseDate(str) {
  // Tastytrade format: "2024-01-15T10:30:00+0000" or "2024-01-15 10:30:00"
  return new Date(str.replace(' ', 'T'))
}

function extractUnderlying(r) {
  // If the Symbol column is the option symbol, parse the underlying from Description
  // e.g. "Sold 1 AAPL 02/16/2024 185.00 C @ 2.50"
  const desc = (r['Description'] || '').trim()
  const underlying = (r['Underlying Symbol'] || '').trim()
  if (underlying) return underlying

  // Try to extract from description: second word after "Bought"/"Sold"
  const match = desc.match(/^(?:Bought|Sold)\s+\d+\s+(\w+)/i)
  if (match) return match[1]

  // Fallback: use the Symbol field (strip option suffix if present)
  const sym = (r['Symbol'] || '').trim()
  // Option symbols look like "AAPL  240216C00185000"
  return sym.split(/\s+/)[0] || sym
}
