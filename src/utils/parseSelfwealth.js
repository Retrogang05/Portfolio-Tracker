import Papa from 'papaparse'

// Selfwealth "Cash Report" CSV format:
//   TransactionDate, Comment, Credit, Debit, Balance
//
// Rows types detected from the Comment field:
//   "Order 1449: Sell 737 SXE @ $3.515"      → trade fill
//   "Order 1449: Brokerage SELL SXE"          → flat $9.50 brokerage fee
//   "Order 1442: Exchange Fees SELL ELPW"     → exchange fee (US stocks only)
//   "SXE DIVIDEND APR26/00804143"             → dividend income
//   "Withdrawal"                              → cash withdrawal
//   Opening/Closing Balance rows (no date)   → skip
//
// Multiple partial fills for the same Order # are consolidated into one
// Trade row with a weighted-average price and summed qty/amount/fees.

// Detect currency from filename: "... AUS.csv" → AUD, "... US.csv" → USD
function detectCurrency(filename) {
  if (/\bAUS\b/i.test(filename)) return 'AUD'
  if (/\bUS\b/i.test(filename))  return 'USD'
  return 'AUD'  // default
}

const parseNum = s => {
  if (!s || s === '') return 0
  return parseFloat(String(s).replace(/,/g, '')) || 0
}

function parseDate(str) {
  if (!str || !str.trim()) return new Date(NaN)
  // "2026-04-23 06:31:53" → ISO with T to avoid UTC mis-parse
  return new Date(str.trim().replace(' ', 'T'))
}

// Classify a Comment string into a typed object
function parseComment(comment) {
  const c = (comment || '').trim()

  // Trade fill: "Order 1449: Sell 737 SXE @ $3.515"
  const fillM = c.match(/^Order (\d+): (Buy|Sell) (\d+) (\S+) @ \$(.+)$/i)
  if (fillM) return {
    type: 'fill', orderId: fillM[1],
    action: fillM[2].toUpperCase(),
    quantity: parseInt(fillM[3], 10),
    symbol: fillM[4],
    price: parseFloat(fillM[5]),
  }

  // Brokerage: "Order 1449: Brokerage SELL SXE"
  const brokerM = c.match(/^Order (\d+): Brokerage (BUY|SELL) (\S+)$/i)
  if (brokerM) return { type: 'brokerage', orderId: brokerM[1] }

  // Exchange fee: "Order 1442: Exchange Fees SELL ELPW"
  const feeM = c.match(/^Order (\d+): Exchange Fees (BUY|SELL) (\S+)$/i)
  if (feeM) return { type: 'exchangeFee', orderId: feeM[1] }

  // Dividend: "SXE DIVIDEND APR26/..." or "DMP DIVIDEND 001352638193"
  const divM = c.match(/^(\S+)\s+DIVIDEND/i)
  if (divM) return { type: 'dividend', symbol: divM[1] }

  // Withdrawal / Withdrawals (singular & plural)
  if (/^Withdrawals?$/i.test(c)) return { type: 'withdrawal' }

  // Capital introduced: "Share invest", "Deposit", "Transfer in", "EFT Deposit", etc.
  if (/share invest|deposit|transfer in|eft/i.test(c)) return { type: 'deposit' }

  return { type: 'other' }
}

/**
 * Parse a single Selfwealth Cash Report CSV file.
 * Returns an array of normalised rows (same shape as parseTastyworks / parseIBKR).
 */
export function parseSelfwealth(file) {
  const currency = detectCurrency(file.name)

  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      // Strip "* Please note, this is not a bank statement." from Balance header
      transformHeader: h => h.split('*')[0].trim(),
      complete: ({ data }) => {
        try {
          const result = []
          // orderId → { fills[], fees, date, symbol, action }
          const orderMap = new Map()
          // dividend / withdrawal / deposit rows
          const mmRows   = []

          for (const row of data) {
            const dateStr = (row['TransactionDate'] || '').trim()
            if (!dateStr) continue  // Opening / Closing Balance rows have no date

            const date    = parseDate(dateStr)
            const credit  = parseNum(row['Credit'])
            const debit   = parseNum(row['Debit'])
            const comment = (row['Comment'] || '').trim()
            const parsed  = parseComment(comment)

            if (parsed.type === 'fill') {
              if (!orderMap.has(parsed.orderId)) {
                orderMap.set(parsed.orderId, {
                  fills: [], fees: 0, date, symbol: null, action: null,
                })
              }
              const ord = orderMap.get(parsed.orderId)
              ord.fills.push({ qty: parsed.quantity, price: parsed.price, credit, debit })
              if (!ord.symbol) ord.symbol = parsed.symbol
              if (!ord.action) ord.action = parsed.action
              if (isNaN(ord.date)) ord.date = date

            } else if (parsed.type === 'brokerage' || parsed.type === 'exchangeFee') {
              if (!orderMap.has(parsed.orderId)) {
                orderMap.set(parsed.orderId, {
                  fills: [], fees: 0, date, symbol: null, action: null,
                })
              }
              // Brokerage & exchange fees are always debits
              orderMap.get(parsed.orderId).fees += debit

            } else if (['dividend', 'withdrawal', 'deposit'].includes(parsed.type)) {
              mmRows.push({ date, credit, debit, parsed, comment })
            } else if (parsed.type === 'other' && (credit > 0 || debit > 0)) {
              // No stock code → likely a cash movement; amount sign decides direction
              mmRows.push({ date, credit, debit, parsed: { type: 'cashflow' }, comment })
            }
          }

          // ── Convert each order group into one Trade row ─────────────────────
          for (const [orderId, ord] of orderMap) {
            if (!ord.fills.length || !ord.symbol || !ord.action) continue

            const totalQty    = ord.fills.reduce((s, f) => s + f.qty, 0)
            const totalCredit = ord.fills.reduce((s, f) => s + f.credit, 0)
            const totalDebit  = ord.fills.reduce((s, f) => s + f.debit, 0)
            const wAvgPrice   = ord.fills.reduce((s, f) => s + f.price * f.qty, 0) / totalQty
            const isBuy       = ord.action === 'BUY'

            // amount sign convention matches buildEquityTrades:
            //   buy  → negative (cash out: stock cost + fees)
            //   sell → positive (cash in: proceeds – fees)
            const amount = isBuy
              ? -(totalDebit  + ord.fees)
              : +(totalCredit - ord.fees)

            const ts = Math.floor(ord.date.getTime() / 1000).toString()

            result.push({
              rowType:        'Trade',
              date:           ord.date,
              timestampSec:   ts,
              orderId:        `SW-${orderId}`,
              subType:        isBuy ? 'Buy' : 'Sell',
              action:         isBuy ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE',
              symbol:         ord.symbol,
              underlying:     ord.symbol,
              instrumentType: 'Equity',
              openClose:      isBuy ? 'Open' : 'Close',
              quantity:       totalQty,
              expiration:     '', strike: 0, callPut: null,
              price:          wAvgPrice,
              commissions:    -(ord.fees),  // negative cost — for fee display in table
              fees:           0,
              amount,
              currency,
              description:    `Order ${orderId}: ${isBuy ? 'Buy' : 'Sell'} ${totalQty} ${ord.symbol}`,
              isExpiration:   false,
            })
          }

          // ── Money movement rows ─────────────────────────────────────────────
          for (const { date, credit, debit, parsed, comment } of mmRows) {
            const ts      = Math.floor(date.getTime() / 1000).toString()
            const amount  = credit - debit
            const subType = parsed.type === 'dividend'   ? 'Dividend'
                          : parsed.type === 'withdrawal' ? 'Withdrawal'
                          : parsed.type === 'cashflow'   ? (amount >= 0 ? 'Capital Introduced' : 'Withdrawal')
                          :                                'Capital Introduced'
            result.push({
              rowType:        'MoneyMovement',
              date,  timestampSec: ts,
              orderId:        `SW-mm-${ts}-${subType}`,
              subType,        action: '',
              symbol:         parsed.symbol ?? '',
              underlying:     parsed.symbol ?? '',
              instrumentType: 'Cash',
              openClose:      null, quantity: 0,
              expiration:     '', strike: 0, callPut: null,
              price:          0, commissions: 0, fees: 0,
              amount,         currency,
              description:    comment,
              isExpiration:   false,
            })
          }

          resolve(result.sort((a, b) => a.date - b.date))
        } catch (e) {
          reject(e)
        }
      },
      error: reject,
    })
  })
}
