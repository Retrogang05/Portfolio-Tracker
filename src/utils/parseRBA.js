/**
 * Parse the RBA F11.1 Exchange Rates CSV file.
 *
 * CSV format (rba.gov.au → Statistics → F11.1 → Download CSV):
 *   Row 0:   F11.1  EXCHANGE RATES          ← title row
 *   Row 1:   Title, A$1=USD, ...            ← column label row
 *   Rows 2-8: metadata (Description, Frequency, Type, Units, Source,
 *             Publication date, Series ID)
 *   Row 9+:  03-Jan-2023, 0.6828, ...       ← data rows (DD-MMM-YYYY)
 *
 * Only column 0 (date) and column 1 (A$1=USD rate) are used.
 * Metadata rows are skipped automatically — they don't match the date pattern.
 *
 * Returns rateMap: { 'YYYY-MM-DD': number }
 * where number is the A$1=USD rate (e.g. 0.6828 → 1 AUD = 0.6828 USD)
 *
 * To convert USD → AUD:  aud = usd / rate
 * To convert AUD → USD:  usd = aud * rate
 *
 * NOTE: Previously used the SheetJS (xlsx) library to read the XLS version
 * of this file.  Switched to PapaParse + CSV to eliminate two HIGH-severity
 * CVEs in xlsx@0.18.5 (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9).
 */
import Papa from 'papaparse'

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4,  Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

/** Parse "DD-MMM-YYYY" → UTC midnight Date, or null if not a data row. */
function parseRBADate(str) {
  if (!str || typeof str !== 'string') return null
  const m = str.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)
  if (!m) return null
  const month = MONTHS[m[2]]
  if (month === undefined) return null
  return new Date(Date.UTC(+m[3], month, +m[1]))
}

export function parseRBA(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: ({ data }) => {
        try {
          const rateMap = {}

          for (const row of data) {
            const date = parseRBADate(row[0])
            if (!date) continue                          // skip all metadata rows

            const rate = parseFloat(row[1])
            if (!isFinite(rate) || rate <= 0) continue  // skip blank/zero cells

            rateMap[date.toISOString().slice(0, 10)] = rate  // 'YYYY-MM-DD'
          }

          if (Object.keys(rateMap).length < 10) {
            throw new Error(
              'Fewer than 10 exchange rate rows found. ' +
              'Make sure this is the RBA F11.1 Exchange Rates CSV ' +
              '(rba.gov.au → Statistics → F11.1 → Download CSV).'
            )
          }

          resolve(rateMap)
        } catch (err) {
          reject(err)
        }
      },
      error: reject,
    })
  })
}

/**
 * Look up the A$1=USD rate for a date.
 * Falls back to the average of the last 5 available days if the exact date
 * is missing (e.g. weekends, public holidays).
 */
export function getFxRate(date, rateMap) {
  if (!date || isNaN(date) || !rateMap) return null
  const key = date.toISOString().slice(0, 10)

  if (rateMap[key]) return rateMap[key]

  // Fallback: average of last 5 available days before this date
  const allDates = Object.keys(rateMap).sort()
  const before   = allDates.filter(d => d <= key).slice(-5)
  if (!before.length) return null
  return before.reduce((s, d) => s + rateMap[d], 0) / before.length
}

/**
 * Convert a USD amount to AUD using the RBA rate on the given date.
 * If no rate is available, returns the amount unchanged (1:1 fallback).
 */
export function usdToAud(usdAmount, date, rateMap) {
  const rate = getFxRate(date, rateMap)
  if (!rate) return usdAmount
  return usdAmount / rate
}
