import Papa from 'papaparse'

const MONTHS = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                 Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }

function parseRBIText(text) {
  const { data } = Papa.parse(text.trim(), { header: false, skipEmptyLines: true })
  const rates = {}
  for (const row of data.slice(1)) {  // skip header
    const dateStr = (row[0] ?? '').replace(/"/g, '').trim()
    const rate    = parseFloat((row[1] ?? '').toString().replace(/"/g, '').trim())
    if (!dateStr || isNaN(rate)) continue
    // "25-Jun-2026" → "2026-06-25"
    const parts = dateStr.split('-')
    if (parts.length !== 3) continue
    const [d, m, y] = parts
    const mm = MONTHS[m]
    if (!mm) continue
    rates[`${y}-${mm}-${d.padStart(2, '0')}`] = rate
  }
  if (!Object.keys(rates).length) throw new Error('No valid RBI rates found. Make sure this is the RBI Reference Rate CSV.')
  return rates
}

export function parseRBI(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      complete: ({ data }) => {
        try {
          const rates = {}
          for (const row of data.slice(1)) {
            const dateStr = (row[0] ?? '').replace(/"/g, '').trim()
            const rate    = parseFloat((row[1] ?? '').toString().replace(/"/g, '').trim())
            if (!dateStr || isNaN(rate)) continue
            const parts = dateStr.split('-')
            if (parts.length !== 3) continue
            const [d, m, y] = parts
            const mm = MONTHS[m]
            if (!mm) continue
            rates[`${y}-${mm}-${d.padStart(2, '0')}`] = rate
          }
          if (!Object.keys(rates).length) throw new Error('No valid RBI rates found. Make sure this is the RBI Reference Rate CSV.')
          resolve(rates)
        } catch (e) { reject(e) }
      },
      error: reject,
    })
  })
}

export { parseRBIText }
