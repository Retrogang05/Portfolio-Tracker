/**
 * Export Tax Centre CGT data to a formatted Excel workbook (.xlsx).
 *
 * Sheets produced:
 *   1. Summary    — FY-level totals (gains, losses, discount, net CGT)
 *   2. CGT Events — one row per disposal, all portfolios
 *   3. FY20XX     — one sheet per financial year with per-year totals
 */
import * as XLSX from 'xlsx'

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDateStr(d) {
  if (!d || isNaN(d)) return ''
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Set a number-format code on a cell (in-place). */
function setFmt(ws, r, c, fmt) {
  const ref = XLSX.utils.encode_cell({ r, c })
  if (ws[ref]) ws[ref].z = fmt
}

/** Apply AUD currency format to a range of columns in a given row. */
function applyAUDFmt(ws, r, cols) {
  for (const c of cols) setFmt(ws, r, c, '_($#,##0.00_);_($#,##0.00_)')
}

/** Apply 4-decimal format to FX rate cells. */
function applyFXFmt(ws, r, cols) {
  for (const c of cols) setFmt(ws, r, c, '0.0000')
}

/** Bold a row of cells. */
function boldRow(ws, r, numCols) {
  for (let c = 0; c < numCols; c++) {
    const ref = XLSX.utils.encode_cell({ r, c })
    if (!ws[ref]) continue
    ws[ref].s = { ...(ws[ref].s ?? {}), font: { bold: true } }
  }
}

/** Colour a single cell: 'green' | 'red' | 'blue' | 'orange'. */
const COLOUR = {
  green:  '059669',
  red:    'DC2626',
  blue:   '3B82F6',
  orange: 'F97316',
  grey:   '94A3B8',
  white:  'FFFFFF',
}

function colourCell(ws, r, c, rgb) {
  const ref = XLSX.utils.encode_cell({ r, c })
  if (!ws[ref]) return
  ws[ref].s = { ...(ws[ref].s ?? {}), font: { ...(ws[ref].s?.font ?? {}), bold: false, color: { rgb } } }
}

function colourPnL(ws, r, c, value) {
  if (typeof value !== 'number') return
  colourCell(ws, r, c, value >= 0 ? COLOUR.green : COLOUR.red)
}

// ── Sheet builders ────────────────────────────────────────────────────────

function buildSummarySheet(fyList, generatedAt) {
  const AUD_COLS = [1, 2, 3, 4, 5, 6]

  const rows = [
    ['CGT Summary — All Portfolios'],
    [`Generated: ${generatedAt}`],
    [],
    [
      'Financial Year',
      'Gross Capital Gains (AUD)',
      'Capital Losses (AUD)',
      '50% CGT Discount (AUD)',
      'Taxable Gains (AUD)',
      'Taxable Losses (AUD)',
      'Net Capital Gain (AUD)',
      'CGT Events',
    ],
    ...fyList.map(fy => [
      `FY${fy.fy}`,
      fy.grossGains,
      fy.grossLosses,           // negative
      -fy.discountApplied,      // show as negative (reduction)
      fy.taxableGains,
      fy.taxableLosses,         // negative
      fy.netTaxable,
      fy.count,
    ]),
    [],
    [
      'TOTAL',
      fyList.reduce((s, fy) => s + fy.grossGains, 0),
      fyList.reduce((s, fy) => s + fy.grossLosses, 0),
      -fyList.reduce((s, fy) => s + fy.discountApplied, 0),
      fyList.reduce((s, fy) => s + fy.taxableGains, 0),
      fyList.reduce((s, fy) => s + fy.taxableLosses, 0),
      fyList.reduce((s, fy) => s + fy.netTaxable, 0),
      fyList.reduce((s, fy) => s + fy.count, 0),
    ],
    [],
    ['⚠ This file is a guide only and does not constitute tax advice. Verify with your accountant.'],
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Column widths
  ws['!cols'] = [
    { wch: 18 }, { wch: 28 }, { wch: 24 }, { wch: 26 },
    { wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 12 },
  ]

  // Bold title and header
  boldRow(ws, 0, 1)
  boldRow(ws, 3, 8)

  // Number formats on data rows (row 4 onward)
  for (let r = 4; r < 4 + fyList.length; r++) {
    applyAUDFmt(ws, r, AUD_COLS)
    // Colour P&L columns
    const fy = fyList[r - 4]
    colourCell(ws, r, 1, COLOUR.green)                                       // gross gains
    colourCell(ws, r, 2, fy.grossLosses  < 0 ? COLOUR.red : COLOUR.grey)    // losses
    colourCell(ws, r, 3, fy.discountApplied > 0 ? COLOUR.blue : COLOUR.grey)// discount
    colourPnL(ws, r, 6, fy.netTaxable)                                       // net
  }

  // Totals row
  const totRow = 4 + fyList.length + 1
  boldRow(ws, totRow, 8)
  applyAUDFmt(ws, totRow, AUD_COLS)
  const netTotal = fyList.reduce((s, fy) => s + fy.netTaxable, 0)
  colourPnL(ws, totRow, 6, netTotal)

  return ws
}

/** Build columns for the CGT events table. */
const EVENT_HEADERS = [
  'Portfolio', 'Asset Type', 'CGT Event', 'Symbol', 'Description',
  'Acquired', 'Disposed', 'Days Held',
  'Source Ccy', 'FX Rate (Buy)', 'FX Rate (Sell)',
  'Cost Basis (AUD)', 'Proceeds (AUD)', 'Fees (AUD)',
  'P&L (AUD)', 'CGT Disc Eligible', 'Discount (AUD)', 'Taxable (AUD)',
  'Expired?', 'FY',
]
const EVENT_AUD_COLS  = [11, 12, 13, 14, 16, 17]
const EVENT_FX_COLS   = [9, 10]
const EVENT_COL_WIDTHS = [
  14, 10, 12, 10, 24,
  14, 14, 10,
  8,  12, 12,
  20, 20, 14,
  16, 18, 16, 18,
  10, 8,
]

function cgtEventLabel(ev) {
  if (ev.assetClass !== 'Option') return 'A1 – Disposal'
  return ev.isShortOption ? 'D2 – Grant' : 'A1 – Disposal'
}

function evToRow(ev, includeFY = true) {
  const row = [
    ev.portfolio,
    ev.assetClass,
    cgtEventLabel(ev),
    ev.symbol,
    ev.description !== ev.symbol ? (ev.description ?? '') : '',
    fmtDateStr(ev.buyDate),
    fmtDateStr(ev.sellDate),
    ev.daysHeld,
    ev.sourceCurrency,
    ev.fxRateBuy  ?? '',
    ev.fxRateSell ?? '',
    ev.costBasisAUD,
    ev.saleProceedsAUD,
    ev.totalFeesAUD > 0 ? ev.totalFeesAUD : '',
    ev.pnlAUD,
    ev.isDiscountEligible ? 'Yes' : 'No',
    ev.discountAUD > 0 ? ev.discountAUD : '',
    ev.taxableGainAUD,
    ev.isExpiration ? 'Yes' : '',
  ]
  if (includeFY) row.push(`FY${ev.fy}`)
  return row
}

function applyEventFormats(ws, numDataRows, headerRow = 0, includeFY = true) {
  // Bold header
  boldRow(ws, headerRow, includeFY ? 18 : 17)

  // Freeze first row (header)
  ws['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 }

  for (let i = 0; i < numDataRows; i++) {
    const r = headerRow + 1 + i
    applyAUDFmt(ws, r, EVENT_AUD_COLS)
    applyFXFmt(ws,  r, EVENT_FX_COLS)
  }
}

function buildEventsSheet(events, includeFY = true) {
  const headers = includeFY ? EVENT_HEADERS : EVENT_HEADERS.slice(0, -1)
  const rows    = events.map(ev => evToRow(ev, includeFY))
  const ws      = XLSX.utils.aoa_to_sheet([headers, ...rows])

  ws['!cols'] = (includeFY ? EVENT_COL_WIDTHS : EVENT_COL_WIDTHS.slice(0, -1))
    .map(wch => ({ wch }))

  applyEventFormats(ws, rows.length, 0, includeFY)
  return ws
}

function buildFYSheet(events, fy) {
  const headers = EVENT_HEADERS.slice(0, -1) // no FY column

  const dataRows = events.map(ev => evToRow(ev, false))

  // Blank row + totals
  const blankRow    = Array(headers.length).fill('')
  const totalsLabel = Array(headers.length).fill('')
  totalsLabel[0]  = 'TOTAL'
  totalsLabel[11] = events.reduce((s, e) => s + e.costBasisAUD,    0)
  totalsLabel[12] = events.reduce((s, e) => s + e.saleProceedsAUD, 0)
  totalsLabel[13] = events.reduce((s, e) => s + e.totalFeesAUD,    0)
  totalsLabel[14] = events.reduce((s, e) => s + e.pnlAUD,          0)
  totalsLabel[16] = events.reduce((s, e) => s + e.discountAUD,     0)
  totalsLabel[17] = events.reduce((s, e) => s + e.taxableGainAUD,  0)

  const allRows = [headers, ...dataRows, blankRow, totalsLabel]
  const ws      = XLSX.utils.aoa_to_sheet(allRows)

  ws['!cols'] = EVENT_COL_WIDTHS.slice(0, -1).map(wch => ({ wch }))

  applyEventFormats(ws, dataRows.length, 0, false)

  // Bold + colour totals row
  const totRow = 1 + dataRows.length + 1  // header + data + blank
  boldRow(ws, totRow, headers.length)
  applyAUDFmt(ws, totRow, EVENT_AUD_COLS)
  const net = totalsLabel[17]
  colourPnL(ws, totRow, 14, net)
  colourPnL(ws, totRow, 17, net)

  return ws
}

// ── Main export entry point ───────────────────────────────────────────────

/**
 * @param {object}   taxData  - { events, fyList } from buildTaxData
 * @param {object}   filters  - { fy: 'all'|'FY2026', portfolio: 'all'|name, assetClass: 'all'|class }
 */
export function exportTaxToExcel(taxData, filters = {}) {
  if (!taxData) return

  const { fy = 'all', portfolio = 'all', assetClass = 'all' } = filters

  // Apply same filters as the UI
  const events = (taxData.events ?? []).filter(ev => {
    if (fy        !== 'all' && `FY${ev.fy}` !== fy)        return false
    if (portfolio !== 'all' && ev.portfolio  !== portfolio) return false
    if (assetClass !== 'all' && ev.assetClass !== assetClass) return false
    return true
  })

  // Recalculate FY totals for filtered events (may be subset of full fyList)
  const fyMap = {}
  for (const ev of events) {
    if (!fyMap[ev.fy]) {
      fyMap[ev.fy] = {
        fy: ev.fy, grossGains: 0, grossLosses: 0,
        discountApplied: 0, taxableGains: 0, taxableLosses: 0,
        netTaxable: 0, count: 0,
      }
    }
    const row = fyMap[ev.fy]
    row.count++
    if (ev.pnlAUD > 0) {
      row.grossGains      += ev.pnlAUD
      row.discountApplied += ev.discountAUD
      row.taxableGains    += ev.taxableGainAUD
    } else {
      row.grossLosses  += ev.pnlAUD
      row.taxableLosses += ev.taxableGainAUD
    }
    row.netTaxable = row.taxableGains + row.taxableLosses
  }
  const fyList = Object.values(fyMap).sort((a, b) => a.fy.localeCompare(b.fy))

  const generatedAt = new Date().toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const wb = XLSX.utils.book_new()

  // Sheet 1: Summary
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(fyList, generatedAt), 'Summary')

  // Sheet 2: All CGT Events
  XLSX.utils.book_append_sheet(wb, buildEventsSheet(events, true), 'CGT Events')

  // Sheet per FY
  const fyYears = [...new Set(events.map(e => e.fy))].sort()
  for (const fyYear of fyYears) {
    const fyEvents = events.filter(e => e.fy === fyYear)
    XLSX.utils.book_append_sheet(wb, buildFYSheet(fyEvents, fyYear), `FY${fyYear}`)
  }

  // Write + download
  const fyRange  = fyYears.length === 1
    ? `FY${fyYears[0]}`
    : `FY${fyYears[0]}-${fyYears[fyYears.length - 1]}`
  const datePart = new Date().toISOString().slice(0, 10)
  const filename = `CGT_${fyRange}_${datePart}.xlsx`

  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 100)
}
