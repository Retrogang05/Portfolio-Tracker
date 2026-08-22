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

// Detect currency from filename: "... AUS.csv" / "... (AU).csv" → AUD, "... US.csv" → USD
// Exported for testing.
export function detectCurrency(filename) {
  // AU / AUS must be tested first — a bare "US" test would not match either, but
  // keeping the order explicit guards against future marker variants.
  if (/\bAUS?\b/i.test(filename)) return 'AUD'
  if (/\bUS\b/i.test(filename))   return 'USD'
  return null   // ambiguous — caller falls back to content sniffing
}

// Fallback when the filename carries no market marker (newer Selfwealth exports are
// named "CashReport_<name>_<from>_<to>.csv" with no AUS/US suffix).
//
// The only trustworthy signal is the currency prefix Selfwealth started writing on
// fills in Jul 2026 — "@ US$10.405" / "@ A$3.51". Deliberately NOT keyed off the
// "Transfer 72,667.00 AUD TO USD" conversion lines: those name the transfer's
// direction, not the account's currency, and the identical line appears in BOTH
// files — as a debit in the AUD account and a credit in the USD one.
//
// Defaults to AUD, matching the long-standing behaviour for unmarked files.
export function detectCurrencyFromContent(text) {
  const sample = typeof text === 'string' ? text : ''
  if (/@\s*US\$/i.test(sample)) return 'USD'
  if (/@\s*A\$/i.test(sample))  return 'AUD'
  return 'AUD'
}

// "Exchange Fees" is a US-market-only charge (SEC/FINRA fee, levied on sales).
// Present → USD with certainty. Absent proves nothing: an AUD file has none, but so
// does a USD file containing only buys.
function hasExchangeFees(text) {
  return /Order \d+: Exchange Fees /i.test(text)
}

// Ticker shape across the whole file. Individually a ticker says little — CAT is both
// Catapult (ASX) and Caterpillar (US) — but the distribution separates the markets
// cleanly: ASX ordinary codes are 3 characters, while US tickers are mostly 4.
// Measured on this account: AU 861/861 three-char (0% four-char); US 87% four-char.
// Digits inside a 3-char code (360, 4DX, A2M) are an ASX tell — rare in US tickers.
function detectFromTickers(text) {
  const tickers = [...text.matchAll(/Order \d+: (?:Buy|Sell) \d+ ([A-Z0-9.]+) @/gi)]
    .map(m => m[1].toUpperCase())
  if (tickers.length < 5) return null          // too little evidence to call

  const long   = tickers.filter(t => t.length >= 4).length
  const digity = tickers.filter(t => t.length <= 3 && /\d/.test(t)).length
  const pctLong = long / tickers.length

  if (pctLong >= 0.30) return { currency: 'USD', confidence: 'low', sample: tickers.length }
  if (pctLong === 0 && digity > 0) return { currency: 'AUD', confidence: 'low', sample: tickers.length }
  if (pctLong <= 0.02) return { currency: 'AUD', confidence: 'low', sample: tickers.length }
  return null                                   // genuinely ambiguous — don't guess
}

/**
 * Resolve which market a Selfwealth export belongs to, most reliable signal first.
 *
 *   1. filename marker  "(AU)" / "AUS" / "US"      — deterministic, user controlled
 *   2. price prefix     "@ US$" / "@ A$"           — definitive, but only in exports
 *                                                     from ~31 Jul 2026 onward
 *   3. exchange fees    US-only charge             — definitive when present
 *   4. ticker shape     distribution across file   — statistical, low confidence
 *
 * Returns { currency, source, confidence }. `confidence` is 'high' for 1-3 and 'low'
 * for 4 or the bare default, so the UI can flag a guess instead of silently
 * mis-filing a whole account — the failure mode that motivated this.
 */
export function resolveMarket(filename, text) {
  const sample = typeof text === 'string' ? text : ''

  const byName = detectCurrency(filename ?? '')
  if (byName) return { currency: byName, source: 'filename', confidence: 'high' }

  if (/@\s*US\$/i.test(sample)) return { currency: 'USD', source: 'price prefix', confidence: 'high' }
  if (/@\s*A\$/i.test(sample))  return { currency: 'AUD', source: 'price prefix', confidence: 'high' }

  if (hasExchangeFees(sample)) return { currency: 'USD', source: 'exchange fees', confidence: 'high' }

  const byTicker = detectFromTickers(sample)
  if (byTicker) return { currency: byTicker.currency, source: `ticker shape (${byTicker.sample} fills)`, confidence: 'low' }

  return { currency: 'AUD', source: 'default', confidence: 'low' }
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
  //
  // Selfwealth began prefixing the price with a currency code on 31 Jul 2026:
  // "Order 1696: Buy 200 SNXX @ US$10.405". The prefix is optional so both the old
  // and new exports parse. Without this, newer fills fall through to the money-movement
  // branch and surface as Capital Introduced / Withdrawal instead of trades.
  const fillM = c.match(/^Order (\d+): (Buy|Sell) (\d+) (\S+) @ [A-Z]{0,3}\$(.+)$/i)
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
function _parseSelfwealth(source, currency) {
  return new Promise((resolve, reject) => {
    Papa.parse(source, {
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

// For testing: accepts a raw CSV string + explicit currency instead of a File object
export function parseCSVText(csvText, currency = 'USD') {
  return _parseSelfwealth(csvText, currency)
}

export async function parseSelfwealth(file) {
  const name = file?.name ?? ''

  // A filename marker is decisive and needs no content, so keep the File-object path
  // (Papa streams it directly, which is cheaper for large exports).
  const fromName = detectCurrency(name)
  if (fromName) {
    const rows = await _parseSelfwealth(file, fromName)
    return tagDetection(rows, { currency: fromName, source: 'filename', confidence: 'high' }, name)
  }

  // No marker — read the text so the market can be resolved from the content.
  const text = typeof file === 'string' ? file : await file.text()
  const detected = resolveMarket(name, text)
  const rows = await _parseSelfwealth(text, detected.currency)
  return tagDetection(rows, detected, name)
}

// Record how the market was resolved on every row, so the UI can show it and warn
// when the answer was a guess rather than a fact.
function tagDetection(rows, detected, fileName) {
  for (const r of rows) {
    r.currencySource     = detected.source
    r.currencyConfidence = detected.confidence
    r.sourceFile         = fileName
  }
  return rows
}
