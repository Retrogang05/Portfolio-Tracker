import { useState, useRef } from 'react'
import { exportTaxToExcel } from '../utils/exportTaxToExcel'

const PAGE = 30

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtAUD(n, forceSign = false) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  let str
  if (abs >= 1_000_000) str = `$${(abs / 1_000_000).toFixed(2)}M`
  else if (abs >= 10_000) str = `$${Math.round(abs / 1000)}k`
  else str = `$${abs.toFixed(2)}`
  if (n < 0) return `-${str}`
  if (forceSign && n > 0) return `+${str}`
  return str
}

function fmtAUDFull(n) {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', minimumFractionDigits: 2,
  }).format(n)
}

function clr(n) {
  if (n == null) return 'text-slate-300'
  return n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-slate-400'
}

// ── RBA file drop zone ─────────────────────────────────────────────────────
function RBAUpload({ onFile, error }) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)

  function handleDrop(e) {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }
  function handleChange(e) {
    const f = e.target.files[0]
    if (f) onFile(f)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        drag
          ? 'border-violet-500 bg-violet-900/20'
          : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'
      }`}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={handleChange} />
      <p className="text-3xl mb-3">📊</p>
      <p className="text-slate-300 font-medium">Drop RBA Exchange Rate file here</p>
      <p className="text-slate-500 text-sm mt-1">or click to browse</p>
      <p className="text-slate-600 text-xs mt-3">
        Download from rba.gov.au → Statistics → Exchange Rates → F11.1 → <strong className="text-slate-500">Download CSV</strong>
      </p>
      {error && (
        <p className="mt-3 text-red-400 text-sm bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
      )}
    </div>
  )
}

// ── Tile card ──────────────────────────────────────────────────────────────
function Tile({ label, value, sub, color = 'text-slate-200', hint }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${color} truncate`}>{value}</p>
      {sub  && <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>}
      {hint && <p className="text-xs text-slate-600 mt-0.5 italic truncate">{hint}</p>}
    </div>
  )
}

// ── FY summary table ────────────────────────────────────────────────────────
function FYTable({ fyList }) {
  if (!fyList.length) return null
  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <h3 className="text-slate-300 font-semibold mb-4">Financial Year Summary</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
              <th className="px-3 py-2 text-left">FY</th>
              <th className="px-3 py-2 text-right">Gross Gains</th>
              <th className="px-3 py-2 text-right">Gross Losses</th>
              <th className="px-3 py-2 text-right">50% Discount</th>
              <th className="px-3 py-2 text-right">Taxable Gains</th>
              <th className="px-3 py-2 text-right">Net CGT</th>
              <th className="px-3 py-2 text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            {fyList.map(fy => (
              <tr key={fy.fy} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                <td className="px-3 py-2.5 font-semibold text-slate-200">FY{fy.fy}</td>
                <td className="px-3 py-2.5 text-right text-emerald-400">{fmtAUDFull(fy.grossGains)}</td>
                <td className="px-3 py-2.5 text-right text-red-400">{fmtAUDFull(fy.grossLosses)}</td>
                <td className="px-3 py-2.5 text-right text-blue-400">
                  {fy.discountApplied > 0 ? `-${fmtAUDFull(fy.discountApplied)}` : '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-slate-300">{fmtAUDFull(fy.taxableGains)}</td>
                <td className={`px-3 py-2.5 text-right font-bold ${clr(fy.netTaxable)}`}>
                  {fmtAUDFull(fy.netTaxable)}
                </td>
                <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{fy.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function TaxCentre({
  portfolios,
  portfolioBrokers,
  portfolioNames,
  rbaRates,
  onRBAFile,
  rbaError,
  rbaFileName,
  taxData,   // { events, fyList } — pre-computed in App
}) {
  const [filterFY,        setFilterFY]        = useState('all')
  const [filterPortfolio, setFilterPortfolio] = useState('all')
  const [filterClass,     setFilterClass]     = useState('all')
  const [sortKey,         setSortKey]         = useState('sellDate')
  const [sortDir,         setSortDir]         = useState(-1)
  const [page,            setPage]            = useState(0)
  const [showRBAUpdate,   setShowRBAUpdate]   = useState(false)

  function handleRBAFile(file) {
    onRBAFile(file)
    setShowRBAUpdate(false)
  }

  const noPortfolioData = portfolios.every(p =>
    !p.equityData && !p.equityDataAUS && !p.equityDataUS && !p.trades?.length
  )

  // ── Filter + sort ─────────────────────────────────────────────────────
  const events = taxData?.events ?? []

  const filtered = events.filter(ev => {
    if (filterFY        !== 'all' && `FY${ev.fy}` !== filterFY) return false
    if (filterPortfolio !== 'all' && ev.portfolio  !== filterPortfolio) return false
    if (filterClass     !== 'all' && ev.assetClass !== filterClass) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (va < vb) return -sortDir
    if (va > vb) return  sortDir
    return 0
  })

  const pages   = Math.ceil(sorted.length / PAGE)
  const visible = sorted.slice(page * PAGE, (page + 1) * PAGE)

  // ── Summary tiles (over filtered events) ─────────────────────────────
  const filteredFY = taxData?.fyList?.filter(fy =>
    filterFY === 'all' || `FY${fy.fy}` === filterFY
  ) ?? []

  const totalGrossGains      = filteredFY.reduce((s, fy) => s + fy.grossGains, 0)
  const totalGrossLosses     = filteredFY.reduce((s, fy) => s + fy.grossLosses, 0)
  const totalDiscount        = filteredFY.reduce((s, fy) => s + fy.discountApplied, 0)
  const totalTaxableGains    = filteredFY.reduce((s, fy) => s + fy.taxableGains, 0)
  const totalTaxableLosses   = filteredFY.reduce((s, fy) => s + fy.taxableLosses, 0)
  const totalNetTaxable      = filteredFY.reduce((s, fy) => s + fy.netTaxable, 0)

  // Drop-down options
  const fyOptions        = [...new Set(events.map(e => `FY${e.fy}`))].sort()
  const portfolioOptions = [...new Set(events.map(e => e.portfolio))].sort()

  function col(key, label, align = 'left') {
    const active = sortKey === key
    return (
      <th
        className={`px-3 py-2 text-xs text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none whitespace-nowrap text-${align}`}
        onClick={() => {
          if (sortKey === key) setSortDir(d => -d)
          else { setSortKey(key); setSortDir(-1) }
          setPage(0)
        }}
      >
        {label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Tax Centre</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Capital Gains Tax summary · All portfolios · AUD
          </p>
        </div>
        {/* RBA status badge */}
        <div className="flex items-center gap-2">
          {rbaRates ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-900/30 border border-emerald-700/50 text-emerald-300 text-sm">
                <span>✓</span>
                <span className="font-medium">RBA rates loaded</span>
                {rbaFileName && <span className="text-emerald-600 text-xs truncate max-w-32">{rbaFileName}</span>}
              </div>
              <button
                onClick={() => setShowRBAUpdate(v => !v)}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-300 text-sm transition-colors"
                title="Upload a new RBA exchange rate file"
              >
                🔄 Update RBA
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm">
              <span>⚠</span>
              <span>RBA rates not loaded</span>
            </div>
          )}
        </div>
      </div>

      {/* RBA upload — shown when not yet loaded, or when user clicks Update RBA */}
      {(!rbaRates || showRBAUpdate) && (
        <div className="space-y-3">
          <RBAUpload onFile={handleRBAFile} error={rbaError} />
          <p className="text-xs text-slate-600 text-center">
            The RBA F11.1 file is needed to convert USD transactions to AUD at the correct historical rate.
          </p>
        </div>
      )}

      {/* No portfolio data loaded yet */}
      {noPortfolioData && rbaRates && (
        <div className="text-center py-16 text-slate-500">
          <p className="text-4xl mb-3">📂</p>
          <p>No portfolio data loaded yet.</p>
          <p className="text-sm mt-1">Upload CSV files in each portfolio tab, then return here.</p>
        </div>
      )}

      {/* Main content — shown when we have rates + some portfolio data */}
      {rbaRates && !noPortfolioData && taxData && (
        <>
          {/* Filters + Export */}
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={filterFY}
              onChange={e => { setFilterFY(e.target.value); setPage(0) }}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-slate-500"
            >
              <option value="all">All Financial Years</option>
              {fyOptions.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>

            <select
              value={filterPortfolio}
              onChange={e => { setFilterPortfolio(e.target.value); setPage(0) }}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-slate-500"
            >
              <option value="all">All Portfolios</option>
              {portfolioOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            <select
              value={filterClass}
              onChange={e => { setFilterClass(e.target.value); setPage(0) }}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-slate-500"
            >
              <option value="all">Equities + Options</option>
              <option value="Equity">Equities only</option>
              <option value="Option">Options only</option>
            </select>

            <span className="text-xs text-slate-500">
              {filtered.length} event{filtered.length !== 1 ? 's' : ''}
            </span>

            {/* Export button — always visible when there are events */}
            {filtered.length > 0 && (
              <button
                onClick={() => exportTaxToExcel(taxData, {
                  fy:         filterFY,
                  portfolio:  filterPortfolio,
                  assetClass: filterClass,
                })}
                className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 hover:border-emerald-500 text-white text-sm font-medium transition-colors"
              >
                <span>⬇</span>
                <span>Export to Excel</span>
                {(filterFY !== 'all' || filterPortfolio !== 'all' || filterClass !== 'all') && (
                  <span className="text-emerald-300 text-xs">(filtered)</span>
                )}
              </button>
            )}
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Tile
              label="Gross Capital Gains"
              value={fmtAUD(totalGrossGains)}
              color="text-emerald-400"
              hint="Before CGT discount"
            />
            <Tile
              label="Capital Losses"
              value={fmtAUD(totalGrossLosses)}
              color={totalGrossLosses < 0 ? 'text-red-400' : 'text-slate-400'}
              hint="Offsets taxable gains"
            />
            <Tile
              label="50% CGT Discount"
              value={totalDiscount > 0 ? `-${fmtAUD(totalDiscount)}` : '—'}
              color="text-blue-400"
              hint="Assets held ≥ 12 months"
            />
            <Tile
              label="Discounted Gains"
              value={fmtAUD(totalTaxableGains)}
              color="text-slate-300"
              hint="After 50% discount"
            />
            <Tile
              label="Taxable Losses"
              value={fmtAUD(totalTaxableLosses)}
              color={totalTaxableLosses < 0 ? 'text-red-400' : 'text-slate-400'}
            />
            <Tile
              label="Net Capital Gain"
              value={fmtAUD(totalNetTaxable)}
              color={clr(totalNetTaxable)}
              hint="Add to taxable income"
            />
          </div>

          {/* Disclaimer */}
          <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3 text-xs text-amber-300/80">
            ⚠ This is a guide only and does not constitute tax advice. CGT discount eligibility, cost base adjustments, and losses carried forward should be verified with your accountant. Options tax treatment may differ — consult the ATO or a registered tax agent.
          </div>

          {/* FY breakdown */}
          {filterFY === 'all' && <FYTable fyList={taxData.fyList} />}

          {/* Per-trade detail table */}
          <div className="bg-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h3 className="text-slate-300 font-semibold">CGT Events — Detail</h3>
                <p className="text-xs text-slate-500 mt-0.5">All amounts in AUD · FX rates from RBA F11.1</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="border-b border-slate-700">
                    {col('portfolio',    'Portfolio')}
                    {col('assetClass',   'Type')}
                    {col('symbol',       'Symbol')}
                    {col('buyDate',      'Acquired',   'left')}
                    {col('sellDate',     'Disposed',   'left')}
                    {col('daysHeld',     'Days',       'right')}
                    {col('sourceCurrency','Ccy',       'center')}
                    <th className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider text-right whitespace-nowrap">FX Buy</th>
                    <th className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider text-right whitespace-nowrap">FX Sell</th>
                    {col('costBasisAUD',    'Cost (AUD)',     'right')}
                    {col('saleProceedsAUD', 'Proceeds (AUD)', 'right')}
                    {col('totalFeesAUD',    'Fees (AUD)',     'right')}
                    {col('pnlAUD',          'P&L (AUD)',      'right')}
                    <th className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider text-center whitespace-nowrap">50% Disc?</th>
                    {col('taxableGainAUD',  'Taxable',        'right')}
                    {col('fy',              'FY',             'center')}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((ev, i) => (
                    <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                      <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{ev.portfolio}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          ev.assetClass === 'Option'
                            ? 'bg-violet-900/50 text-violet-300'
                            : 'bg-blue-900/40 text-blue-300'
                        }`}>
                          {ev.assetClass}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono font-semibold text-slate-200">{ev.symbol}</span>
                          {ev.description && ev.description !== ev.symbol && (
                            <span className="text-xs text-slate-500">{ev.description}</span>
                          )}
                          {ev.assetClass === 'Option' && (
                            <div className="flex gap-1">
                              <span className={`px-1 py-0 rounded text-xs ${
                                ev.isShortOption
                                  ? 'bg-amber-900/40 text-amber-300'
                                  : 'bg-sky-900/40 text-sky-300'
                              }`}>
                                {ev.isShortOption ? 'D2 Short' : 'A1 Long'}
                              </span>
                              {ev.isExpiration && (
                                <span className="px-1 py-0 rounded text-xs bg-slate-700 text-slate-400">Exp</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtDate(ev.buyDate)}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs whitespace-nowrap">{fmtDate(ev.sellDate)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{ev.daysHeld}d</td>
                      <td className="px-3 py-2.5 text-center text-xs">
                        <span className={`px-1 rounded ${
                          ev.sourceCurrency === 'USD' ? 'text-green-400' : 'text-slate-400'
                        }`}>
                          {ev.sourceCurrency}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-500 text-xs">
                        {ev.fxRateBuy  ? ev.fxRateBuy.toFixed(4)  : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-500 text-xs">
                        {ev.fxRateSell ? ev.fxRateSell.toFixed(4) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-300 text-xs">{fmtAUDFull(ev.costBasisAUD)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300 text-xs">{fmtAUDFull(ev.saleProceedsAUD)}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-orange-400">
                        {ev.totalFeesAUD > 0.01 ? `-${fmtAUDFull(ev.totalFeesAUD)}` : '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold text-sm ${clr(ev.pnlAUD)}`}>
                        {fmtAUDFull(ev.pnlAUD)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {ev.isDiscountEligible
                          ? <span className="px-1.5 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300">✓ 50%</span>
                          : <span className="text-slate-600 text-xs">—</span>
                        }
                      </td>
                      <td className={`px-3 py-2.5 text-right font-bold text-sm ${clr(ev.taxableGainAUD)}`}>
                        {fmtAUDFull(ev.taxableGainAUD)}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-slate-500">FY{ev.fy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-slate-500 text-xs">{filtered.length} events</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => p - 1)}
                    disabled={page === 0}
                    className="px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 transition-colors"
                  >Prev</button>
                  <span className="px-2 py-1 text-slate-400 text-xs">{page + 1} / {pages}</span>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= pages - 1}
                    className="px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 transition-colors"
                  >Next</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
