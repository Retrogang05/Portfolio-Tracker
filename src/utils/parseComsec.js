/**
 * Parse a CommSec "Account Transactions" CSV export.
 *
 * Format:
 *   Date,Reference,Details,Debit($),Credit($),Balance($)
 *   23/10/2025,C167621111,B 625000 AXI @ 0.040000,25029.95,,25029.95
 *
 * Reference prefixes:
 *   C → Trade (Buy or Sell)
 *   R → Receipt / Direct Transfer in  → Capital Introduced
 *   P → Payment / Direct Transfer out → Withdrawal
 *
 * All amounts are AUD.  CommSec brokerage is already reflected in Debit/Credit
 * (gross trade value ± brokerage = net Debit or Credit shown in the file).
 */
import Papa from 'papaparse'

const parseNum = s => {
  if (!s || String(s).trim() === '') return 0
  return parseFloat(String(s).replace(/[$,]/g, '')) || 0
}

/** DD/MM/YYYY → Date (local midnight) */
function parseDate(str) {
  if (!str || !str.trim()) return new Date(NaN)
  const parts = str.trim().split('/')
  if (parts.length !== 3) return new Date(NaN)
  const [d, m, y] = parts.map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Parse Details field for trade rows:
 *   "B 625000 AXI @ 0.040000  "  →  { action:'BUY',  qty:625000, symbol:'AXI', price:0.04 }
 *   "S 44943 ARU @ 0.455000  "   →  { action:'SELL', qty:44943,  symbol:'ARU', price:0.455 }
 */
function parseTradeDetails(details) {
  const m = (details || '').trim().match(/^(B|S)\s+(\d[\d,]*)\s+(\S+)\s+@\s+([\d.]+)/i)
  if (!m) return null
  return {
    action:   m[1].toUpperCase() === 'B' ? 'BUY' : 'SELL',
    quantity: parseInt(m[2].replace(/,/g, ''), 10),
    symbol:   m[3],
    price:    parseFloat(m[4]),
  }
}

/**
 * Parse a CommSec Account Transactions CSV.
 * Returns a normalised rows array (same shape as parseTastyworks / parseSelfwealth).
 */
export function parseComsec(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: ({ data }) => {
        try {
          const result = []

          for (const row of data) {
            const ref     = (row['Reference'] || '').trim()
            const details = (row['Details']   || '').trim()
            const dateStr = (row['Date']       || '').trim()
            if (!ref || !dateStr) continue

            const date  = parseDate(dateStr)
            if (isNaN(date)) continue

            const debit  = parseNum(row['Debit($)'])
            const credit = parseNum(row['Credit($)'])
            const ts     = Math.floor(date.getTime() / 1000).toString()

            // ── Trade row (C prefix) ────────────────────────────────────
            if (ref.startsWith('C')) {
              const trade = parseTradeDetails(details)
              if (!trade || trade.quantity <= 0 || trade.price <= 0) continue

              const isBuy    = trade.action === 'BUY'
              const netAmt   = isBuy ? debit : credit          // gross price + brokerage (buy) or gross – brokerage (sell)
              const gross    = trade.quantity * trade.price    // price × qty, no brokerage
              const brokerage = parseFloat(Math.abs(netAmt - gross).toFixed(2))

              // amount sign convention: buy = negative (cash out), sell = positive (cash in)
              const amount = isBuy ? -netAmt : +netAmt

              result.push({
                rowType:        'Trade',
                date,
                timestampSec:   ts,
                orderId:        ref,
                subType:        isBuy ? 'Buy' : 'Sell',
                action:         isBuy ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE',
                symbol:         trade.symbol,
                underlying:     trade.symbol,
                instrumentType: 'Equity',
                openClose:      isBuy ? 'Open' : 'Close',
                quantity:       trade.quantity,
                expiration:     '', strike: 0, callPut: null,
                price:          trade.price,
                commissions:    -brokerage,  // negative = cost, matches parseSelfwealth convention
                fees:           0,
                amount,
                currency:       'AUD',
                description:    details,
                isExpiration:   false,
              })

            // ── Capital Introduced (R prefix) ──────────────────────────
            } else if (ref.startsWith('R')) {
              const amount = credit > 0 ? credit : -debit
              if (amount === 0) continue
              result.push({
                rowType:        'MoneyMovement',
                date, timestampSec: ts,
                orderId:        ref,
                subType:        'Capital Introduced',
                action:         '',
                symbol: '', underlying: '', instrumentType: 'Cash',
                openClose: null, quantity: 0,
                expiration: '', strike: 0, callPut: null,
                price: 0, commissions: 0, fees: 0,
                amount, currency: 'AUD',
                description: details,
                isExpiration: false,
              })

            // ── Withdrawal (P prefix) ──────────────────────────────────
            } else if (ref.startsWith('P')) {
              const amount = debit > 0 ? -debit : credit
              if (amount === 0) continue
              result.push({
                rowType:        'MoneyMovement',
                date, timestampSec: ts,
                orderId:        ref,
                subType:        'Withdrawal',
                action:         '',
                symbol: '', underlying: '', instrumentType: 'Cash',
                openClose: null, quantity: 0,
                expiration: '', strike: 0, callPut: null,
                price: 0, commissions: 0, fees: 0,
                amount, currency: 'AUD',
                description: details,
                isExpiration: false,
              })

            // ── Dividend (credit row whose Details contains "Dividend") ──
            } else if (credit > 0 && /dividend/i.test(details)) {
              // Extract symbol — CommSec typically formats as "AXI Dividend" or "BHP Dividend"
              const symM = details.match(/^([A-Z][A-Z0-9]{0,5})\s+dividend/i)
              const sym  = symM ? symM[1].toUpperCase() : ''
              result.push({
                rowType:        'MoneyMovement',
                date, timestampSec: ts,
                orderId:        ref || `CS-div-${ts}`,
                subType:        'Dividend',
                action:         '',
                symbol:         sym, underlying: sym,
                instrumentType: 'Cash',
                openClose: null, quantity: 0,
                expiration: '', strike: 0, callPut: null,
                price: 0, commissions: 0, fees: 0,
                amount:         credit,
                currency:       'AUD',
                description:    details,
                isExpiration:   false,
              })

            // ── Unknown row with a cash movement ──────────────────────
            } else if (credit > 0 || debit > 0) {
              const amount = credit - debit
              if (amount === 0) continue
              result.push({
                rowType:        'MoneyMovement',
                date, timestampSec: ts,
                orderId:        `CS-mm-${ts}`,
                subType:        amount >= 0 ? 'Capital Introduced' : 'Withdrawal',
                action:         '',
                symbol: '', underlying: '', instrumentType: 'Cash',
                openClose: null, quantity: 0,
                expiration: '', strike: 0, callPut: null,
                price: 0, commissions: 0, fees: 0,
                amount, currency: 'AUD',
                description: details,
                isExpiration: false,
              })
            }
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
