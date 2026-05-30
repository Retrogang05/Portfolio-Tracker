import { useState, useMemo, useEffect } from 'react'
import FileUpload from './components/FileUpload'
import StatCard from './components/StatCard'
import CalendarHeatmap from './components/CalendarHeatmap'
import MonthlyChart from './components/MonthlyChart'
import TickerBreakdown from './components/TickerBreakdown'
import StrategyBreakdown from './components/StrategyBreakdown'
import WheelTracker from './components/WheelTracker'
import TradeTable from './components/TradeTable'
import YearSummary from './components/YearSummary'
import CapitalMovements from './components/CapitalMovements'
import AccountSidebar from './components/AccountSidebar'
import GainLossSummary from './components/GainLossSummary'
import ShareTracker from './components/ShareTracker'
import StockOpenPositions from './components/StockOpenPositions'
import StockClosedTable from './components/StockClosedTable'
import TaxCentre from './components/TaxCentre'
import CombinedDashboards from './components/CombinedDashboards'
import DividendReport from './components/DividendReport'
import { parseAllCSV } from './utils/parseTastyworks'
import { parseAllIBKR } from './utils/parseIBKR'
import { parseSelfwealth } from './utils/parseSelfwealth'
import { parseComsec } from './utils/parseComsec'
import { tagRowsWithStrategy } from './utils/identifyStrategy'
import { detectWheels } from './utils/detectWheel'
import { buildTrades, computeStats, auFY } from './utils/calculatePnL'
import { buildEquityTrades, computeEquityStats } from './utils/buildEquityTrades'
import { parseRBA } from './utils/parseRBA'
import { buildTaxData } from './utils/buildTaxData'
import { savePortfolios, loadPortfolios, saveRBA, loadRBA, clearAll } from './utils/db'
import { fmt } from './utils/format'

// Per-portfolio broker config — index matches portfolio slot
const PORTFOLIO_BROKER = ['tastytrade', 'ibkr', 'selfwealth', 'selfwealth', 'comsec']

function overridesKey(idx)   { return `options-tracker:strategy-overrides:${idx}` }
function capitalTagsKey(idx) { return `options-tracker:capital-tags:${idx}` }

function loadOverrides(idx)  {
  try { return JSON.parse(localStorage.getItem(overridesKey(idx))   || '{}') } catch { return {} }
}
function saveOverrides(idx, overrides) {
  localStorage.setItem(overridesKey(idx), JSON.stringify(overrides))
}
function loadCapitalTags(idx) {
  try { return JSON.parse(localStorage.getItem(capitalTagsKey(idx)) || '{}') } catch { return {} }
}
function saveCapitalTags(idx, tags) {
  localStorage.setItem(capitalTagsKey(idx), JSON.stringify(tags))
}

function applyOverrides(trades, overrides) {
  return trades.map(t => {
    const override = overrides[t.strategyGroupId]
    if (!override) return t
    return { ...t, strategyName: override, isOverridden: true }
  })
}

const PORTFOLIO_NAMES = ['Divya Tasty', 'SAHR IBKR', 'Divya SW', 'SAHR SW', 'Divya COMSEC']

function emptyPortfolio(idx) {
  return {
    name:           PORTFOLIO_NAMES[idx] ?? `Portfolio ${idx + 1}`,
    fileName:       '',
    stats:          null,
    trades:         [],
    rawTrades:      [],
    wheels:         [],
    overrides:      loadOverrides(idx),
    moneyMovements: [],
    capitalTags:    loadCapitalTags(idx),
    equityData:     null,   // used by Tasty / IBKR
    equityDataAUS:  null,   // Selfwealth AUD market
    equityDataUS:   null,   // Selfwealth USD market
    error:          null,
    loading:        false,
  }
}

export default function App() {
  const [portfolios, setPortfolios] = useState([
    emptyPortfolio(0), emptyPortfolio(1), emptyPortfolio(2), emptyPortfolio(3), emptyPortfolio(4),
  ])
  const [active, setActive] = useState(0)
  const [view, setView] = useState('options')     // 'options' | 'stocks'
  const [swMarket, setSwMarket] = useState('aus') // Selfwealth: 'aus' | 'us'
  const [filterFY, setFilterFY] = useState('all') // 'all' | '2026' | '2025' etc.
  const [showTax,       setShowTax]       = useState(false) // Tax Centre tab
  const [showCombined,  setShowCombined]  = useState(false) // Combined Overview tab
  const [showDividends, setShowDividends] = useState(false) // Dividend Income tab
  const [rbaRates, setRbaRates] = useState(null)  // parsed RBA rate map
  const [rbaFileName, setRbaFileName] = useState('')
  const [rbaError, setRbaError] = useState(null)
  const [dbReady, setDbReady] = useState(false)   // true once IndexedDB initial load is done
  const [theme, setTheme] = useState(
    () => localStorage.getItem('options-tracker:theme') ?? 'dark'
  )

  const p = portfolios[active]

  function updatePortfolio(idx, updates) {
    setPortfolios(prev => prev.map((pf, i) => i === idx ? { ...pf, ...updates } : pf))
  }

  // fileInput is always an array (FileUpload always passes [file] or [file1, file2, ...])
  async function handleFile(fileInput) {
    const files  = Array.isArray(fileInput) ? fileInput : [fileInput]
    const idx    = active
    const broker = PORTFOLIO_BROKER[idx] ?? 'tastytrade'
    updatePortfolio(idx, {
      loading: true, error: null,
      fileName: files.map(f => f.name).join(' + '),
    })
    try {
      let allRows

      if (broker === 'selfwealth') {
        // Parse all files; each row is tagged with currency (AUD or USD) from filename
        const parsed = await Promise.all(files.map(parseSelfwealth))
        allRows = parsed.flat().sort((a, b) => a.date - b.date)
      } else if (broker === 'comsec') {
        allRows = await parseComsec(files[0])
      } else {
        const file = files[0]
        allRows = broker === 'ibkr'
          ? await parseAllIBKR(file)
          : await parseAllCSV(file)
      }

      // Equity / share portfolio — always built for every broker
      const equityData = buildEquityTrades(allRows)

      // Money movements — always relevant
      const moneyMovements = allRows
        .filter(r => r.rowType === 'MoneyMovement' && r.amount !== 0)
        .sort((a, b) => b.date - a.date)

      if (broker === 'selfwealth') {
        // Selfwealth is equity-only, split by source currency (AUD / USD)
        const ausRows = allRows.filter(r => (r.currency ?? 'AUD') === 'AUD')
        const usRows  = allRows.filter(r => r.currency === 'USD')
        const equityDataAUS = buildEquityTrades(ausRows)
        const equityDataUS  = buildEquityTrades(usRows)
        const hasAny = equityDataAUS.closedPositions.length > 0 || equityDataAUS.openPositions.length > 0 ||
                       equityDataUS.closedPositions.length  > 0 || equityDataUS.openPositions.length  > 0
        updatePortfolio(idx, {
          rawTrades: [], trades: [], stats: null, wheels: [],
          equityData: null, equityDataAUS, equityDataUS,
          moneyMovements,
          loading: false,
          error: hasAny ? null : 'No trades found. Make sure this is a Selfwealth Cash Report CSV.',
        })
        return
      }

      if (broker === 'comsec') {
        // CommSec is equity-only, AUD-only — no currency split needed
        const hasAny = equityData.closedPositions.length > 0 || equityData.openPositions.length > 0
        updatePortfolio(idx, {
          rawTrades: [], trades: [], stats: null, wheels: [],
          equityData, equityDataAUS: null, equityDataUS: null,
          moneyMovements,
          loading: false,
          error: hasAny ? null : 'No trades found. Make sure this is a CommSec Account Transactions CSV.',
        })
        return
      }

      // Options P&L pipeline (Tastytrade / IBKR)
      const optionRows = allRows.filter(r =>
        (r.rowType === 'Trade' || r.rowType === 'Expiration') &&
        (r.callPut === 'CALL' || r.callPut === 'PUT')
      )
      const taggedRows = tagRowsWithStrategy(optionRows)
      const { closedTrades } = buildTrades(taggedRows)
      const currentOverrides = loadOverrides(idx)
      const withOverrides = applyOverrides(closedTrades, currentOverrides)

      updatePortfolio(idx, {
        rawTrades:      closedTrades,
        trades:         withOverrides,
        stats:          computeStats(withOverrides),
        wheels:         detectWheels(allRows),
        equityData,
        moneyMovements,
        loading:        false,
        error: closedTrades.length === 0 && equityData.closedPositions.length === 0 && equityData.openPositions.length === 0
          ? 'No trades found. Make sure this is the correct CSV format for this portfolio.'
          : null,
      })
    } catch (e) {
      updatePortfolio(idx, { loading: false, error: e.message })
    }
  }

  function handleStrategyChange(strategyGroupId, newStrategy) {
    const idx = active
    const newOverrides = { ...p.overrides, [strategyGroupId]: newStrategy }
    saveOverrides(idx, newOverrides)
    const updated = applyOverrides(p.rawTrades, newOverrides)
    updatePortfolio(idx, { overrides: newOverrides, trades: updated, stats: computeStats(updated) })
  }

  function handleCapitalTagChange(rowId, category) {
    const idx = active
    const newTags = { ...p.capitalTags, [rowId]: category }
    saveCapitalTags(idx, newTags)
    updatePortfolio(idx, { capitalTags: newTags })
  }

  function handleReset() {
    updatePortfolio(active, emptyPortfolio(active))
  }

  const broker        = PORTFOLIO_BROKER[active] ?? 'tastytrade'
  const isSelfwealth  = broker === 'selfwealth'
  const isComsec      = broker === 'comsec'
  const isEquityOnly  = isSelfwealth || isComsec  // no options toggle, always show stocks view

  // For Selfwealth, pick the right market's equity data; CommSec/others use shared equityData
  const activeEquityData = isSelfwealth
    ? (swMarket === 'aus' ? p.equityDataAUS : p.equityDataUS) ?? null
    : p.equityData

  const activeCurrency = isSelfwealth ? (swMarket === 'aus' ? 'AUD' : 'USD') : null

  const hasData = p.stats ||
    (activeEquityData && (activeEquityData.openPositions.length > 0 || activeEquityData.closedPositions.length > 0)) ||
    (isSelfwealth && (p.equityDataAUS || p.equityDataUS)) ||
    (isComsec && p.equityData)

  // ── FY filter ─────────────────────────────────────────────────────────────
  // Collect every FY that appears across options closes AND equity closes
  const availableFYs = useMemo(() => {
    const fys = new Set()
    for (const t of p.trades) {
      if (t.closeDate) fys.add(auFY(t.closeDate))
    }
    for (const pos of [
      ...(p.equityData?.closedPositions    ?? []),
      ...(p.equityDataAUS?.closedPositions ?? []),
      ...(p.equityDataUS?.closedPositions  ?? []),
    ]) {
      if (pos.sellDate) fys.add(auFY(pos.sellDate))
    }
    return Array.from(fys).sort()
  }, [p.trades, p.equityData, p.equityDataAUS, p.equityDataUS])

  // Filtered options trades + recomputed stats
  const filteredTrades = useMemo(() => {
    if (filterFY === 'all') return p.trades
    return p.trades.filter(t => t.closeDate && auFY(t.closeDate) === filterFY)
  }, [p.trades, filterFY])

  const filteredStats = useMemo(() => {
    if (filterFY === 'all') return p.stats
    return computeStats(filteredTrades)   // returns null when empty — safe
  }, [filteredTrades, filterFY, p.stats])

  // Filtered equity data — open positions always shown in full, closed positions filtered
  const filteredEquityData = useMemo(() => {
    if (!activeEquityData) return null
    if (filterFY === 'all') return activeEquityData
    const closed = activeEquityData.closedPositions.filter(
      pos => pos.sellDate && auFY(pos.sellDate) === filterFY
    )
    return {
      ...activeEquityData,
      closedPositions:  closed,
      stats:            computeEquityStats(closed),   // null when empty — safe
      totalRealizedPnL: closed.reduce((s, pos) => s + pos.pnl, 0),
    }
  }, [activeEquityData, filterFY])

  // Options-only daily P&L (for calendar in Options view)
  const optionsDailyPnL = filteredStats?.dailyPnL ?? {}

  // Equity-only daily P&L (for calendar in Stocks view) — uses the active market
  const equityDailyPnL = (() => {
    const dailyMap = {}
    for (const pos of (filteredEquityData?.closedPositions ?? [])) {
      if (!pos.sellDate || isNaN(pos.sellDate)) continue
      const date = pos.sellDate.toISOString().slice(0, 10)
      if (!dailyMap[date]) dailyMap[date] = { pnl: 0, count: 0, trades: [] }
      dailyMap[date].pnl   += pos.pnl
      dailyMap[date].count += 1
      dailyMap[date].trades.push({ underlying: pos.symbol, strategy: 'Equity', pnl: pos.pnl })
    }
    return dailyMap
  })()


  // ── RBA file handler ────────────────────────────────────────────────────
  async function handleRBAFile(file) {
    setRbaError(null)
    try {
      const rates = await parseRBA(file)
      setRbaRates(rates)
      setRbaFileName(file.name)
    } catch (e) {
      setRbaError(e.message)
    }
  }

  // ── Tax data (re-computed whenever portfolios or RBA rates change) ──────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const taxData = useMemo(() => {
    if (!rbaRates) return null
    return buildTaxData(portfolios, PORTFOLIO_BROKER, PORTFOLIO_NAMES, rbaRates)
  }, [portfolios, rbaRates])

  // ── IndexedDB: load saved data on first mount ────────────────────────────
  useEffect(() => {
    async function loadFromDB() {
      try {
        const [savedPortfolios, savedRBA] = await Promise.all([loadPortfolios(), loadRBA()])

        // Restore portfolios — merge stored data over the fresh default so any
        // new fields added since the last save still get their default values.
        if (savedPortfolios.length > 0) {
          setPortfolios(prev => prev.map((pf, i) => {
            const stored = savedPortfolios.find(s => s.idx === i)
            if (!stored?.fileName) return pf
            return { ...pf, ...stored, name: PORTFOLIO_NAMES[i], loading: false }
          }))
        }

        // Restore RBA rates
        if (savedRBA?.rates) {
          setRbaRates(savedRBA.rates)
          setRbaFileName(savedRBA.fileName ?? '')
        }
      } catch (e) {
        console.warn('IndexedDB load failed:', e)
      } finally {
        setDbReady(true)
      }
    }
    loadFromDB()
  }, []) // run once on mount

  // ── IndexedDB: save portfolios whenever they change ──────────────────────
  useEffect(() => {
    if (!dbReady) return                           // don't save during initial load
    if (portfolios.some(p => p.loading)) return   // wait until parse is finished
    savePortfolios(portfolios).catch(e => console.warn('IndexedDB portfolio save failed:', e))
  }, [portfolios, dbReady])

  // ── IndexedDB: save RBA rates whenever they change ───────────────────────
  useEffect(() => {
    if (!dbReady || !rbaRates) return
    saveRBA(rbaRates, rbaFileName).catch(e => console.warn('IndexedDB RBA save failed:', e))
  }, [rbaRates, rbaFileName, dbReady])

  // ── Theme: sync .light class on <html> and persist choice ────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('options-tracker:theme', theme)
  }, [theme])

  // Brief full-screen loader while IndexedDB hydrates (typically < 100 ms)
  if (!dbReady) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-500 text-center">
          <div className="text-4xl mb-4 animate-pulse">📊</div>
          <p className="text-sm">Loading saved data…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📈</span>
            <span className="font-bold text-lg tracking-tight">Portfolio Tracker</span>
          </div>

          {/* Portfolio switcher */}
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            {portfolios.map((pf, i) => {
              const pfBroker = PORTFOLIO_BROKER[i] ?? 'tastytrade'
              return (
                <button
                  key={i}
                  onClick={() => {
                    setActive(i)
                    setFilterFY('all')
                    if (pfBroker === 'selfwealth') {
                      setView('stocks')
                      setSwMarket('aus')
                    } else if (pfBroker === 'comsec') {
                      setView('stocks')
                    }
                  }}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    active === i
                      ? 'bg-slate-600 text-slate-100 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pf.name}
                  {pfBroker === 'selfwealth' && (
                    <span className="ml-1 text-xs text-slate-600">SW</span>
                  )}
                  {pfBroker === 'comsec' && (
                    <span className="ml-1 text-xs text-slate-600">CS</span>
                  )}
                  {pf.stats && (
                    <span className="ml-1.5 text-xs text-slate-500">· {fmt(pf.stats.totalPnL)}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Dark / light mode toggle */}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="text-lg px-2 py-1 rounded transition-colors hover:bg-slate-800"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Clear all saved data */}
          <button
            onClick={async () => {
              if (!confirm('Clear all saved portfolio data and RBA rates?\n\nYou will need to re-upload your CSV files.')) return
              await clearAll()
              setPortfolios([
                emptyPortfolio(0), emptyPortfolio(1), emptyPortfolio(2),
                emptyPortfolio(3), emptyPortfolio(4),
              ])
              setRbaRates(null)
              setRbaFileName('')
              setShowTax(false)
              setShowCombined(false)
              setShowDividends(false)
            }}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors px-2 py-1 rounded"
            title="Clear all saved data from this browser"
          >
            🗑️ Clear data
          </button>

          {/* Dividend Income button */}
          <button
            onClick={() => { setShowDividends(v => !v); setShowTax(false); setShowCombined(false) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              showDividends
                ? 'bg-emerald-700 border-emerald-600 text-white'
                : 'bg-slate-800 border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            💰 Dividends
          </button>

          {/* Combined Overview button */}
          <button
            onClick={() => { setShowCombined(v => !v); setShowTax(false); setShowDividends(false) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              showCombined
                ? 'bg-blue-700 border-blue-600 text-white'
                : 'bg-slate-800 border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            📊 Combined
          </button>

          {/* Tax Centre tab button */}
          <button
            onClick={() => { setShowTax(v => !v); setShowCombined(false); setShowDividends(false) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              showTax
                ? 'bg-violet-700 border-violet-600 text-white'
                : 'bg-slate-800 border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            🧾 Tax Centre
          </button>

          {!showTax && !showCombined && !showDividends && p.fileName && (
            <>
              <span className="text-xs text-slate-500 truncate max-w-48">{p.fileName}</span>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-medium transition-colors"
              >
                <span>↩</span>
                <span>Load new file</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-8">

        {/* ── COMBINED OVERVIEW ───────────────────────────────────── */}
        {showCombined && (
          <CombinedDashboards
            portfolios={portfolios}
            portfolioBrokers={PORTFOLIO_BROKER}
            portfolioNames={PORTFOLIO_NAMES}
            filterFY={filterFY}
            setFilterFY={setFilterFY}
          />
        )}

        {/* ── DIVIDEND INCOME ─────────────────────────────────────── */}
        {showDividends && (
          <DividendReport
            portfolios={portfolios}
            portfolioBrokers={PORTFOLIO_BROKER}
            portfolioNames={PORTFOLIO_NAMES}
            filterFY={filterFY}
            setFilterFY={setFilterFY}
          />
        )}

        {/* ── TAX CENTRE ──────────────────────────────────────────── */}
        {showTax && (
          <TaxCentre
            portfolios={portfolios}
            portfolioBrokers={PORTFOLIO_BROKER}
            portfolioNames={PORTFOLIO_NAMES}
            rbaRates={rbaRates}
            onRBAFile={handleRBAFile}
            rbaError={rbaError}
            rbaFileName={rbaFileName}
            taxData={taxData}
          />
        )}

        {!showTax && !showCombined && !showDividends && !hasData && !p.loading && (
          <>
            <div className="text-center space-y-2 pt-8 pb-4">
              <h1 className="text-3xl font-bold text-slate-100">Portfolio Tracker</h1>
              <p className="text-slate-400">
                {broker === 'ibkr'        ? 'Upload your Interactive Brokers Transaction History CSV'
                : broker === 'selfwealth' ? 'Upload your Selfwealth Cash Report CSV(s)'
                : broker === 'comsec'     ? 'Upload your CommSec Account Transactions CSV'
                :                          'Upload your Tastytrade transaction history CSV'}
              </p>
              <p className="text-slate-500 text-sm">
                Loading into <span className="text-slate-300 font-medium">{p.name}</span>
              </p>
            </div>
            <FileUpload onFile={handleFile} broker={broker} />
            {p.error && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
                {p.error}
              </div>
            )}
            {broker === 'tastytrade' && (
              <div className="bg-slate-800/50 rounded-xl p-5 text-sm text-slate-400 space-y-2">
                <p className="font-medium text-slate-300">How to export from Tastytrade:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Log in to Tastytrade → click <strong className="text-slate-300">History</strong> in the left sidebar</li>
                  <li>Select <strong className="text-slate-300">Transactions</strong> tab</li>
                  <li>Choose your date range</li>
                  <li>Click <strong className="text-slate-300">Download CSV</strong></li>
                </ol>
              </div>
            )}
            {broker === 'ibkr' && (
              <div className="bg-slate-800/50 rounded-xl p-5 text-sm text-slate-400 space-y-2">
                <p className="font-medium text-slate-300">How to export from Interactive Brokers:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Log in to Client Portal → <strong className="text-slate-300">Reports</strong></li>
                  <li>Select <strong className="text-slate-300">Activity → Transaction History</strong></li>
                  <li>Set period to <strong className="text-slate-300">1 Year</strong></li>
                  <li>Click <strong className="text-slate-300">Download</strong> → CSV</li>
                </ol>
              </div>
            )}
            {broker === 'selfwealth' && (
              <div className="bg-slate-800/50 rounded-xl p-5 text-sm text-slate-400 space-y-2">
                <p className="font-medium text-slate-300">How to export from Selfwealth:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Log in to Selfwealth → go to <strong className="text-slate-300">Portfolio</strong></li>
                  <li>Select <strong className="text-slate-300">Transactions</strong></li>
                  <li>Choose your date range and click <strong className="text-slate-300">Export CSV</strong></li>
                  <li>Repeat for both your <strong className="text-slate-300">AUS</strong> and <strong className="text-slate-300">US</strong> accounts</li>
                </ol>
                <p className="text-slate-500 text-xs pt-1">
                  💡 Drop both the AUS and US CSVs together — they will be merged into one portfolio
                </p>
              </div>
            )}
            {broker === 'comsec' && (
              <div className="bg-slate-800/50 rounded-xl p-5 text-sm text-slate-400 space-y-2">
                <p className="font-medium text-slate-300">How to export from CommSec:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Log in to CommSec → click <strong className="text-slate-300">Portfolio</strong></li>
                  <li>Select the <strong className="text-slate-300">Transactions</strong> tab</li>
                  <li>Set your date range and click <strong className="text-slate-300">Download Transactions</strong></li>
                  <li>Choose <strong className="text-slate-300">CSV</strong> format</li>
                </ol>
                <p className="text-slate-500 text-xs pt-1">
                  💡 All amounts are AUD · Brokerage is already reflected in the Debit/Credit columns
                </p>
              </div>
            )}
          </>
        )}

        {!showTax && !showCombined && !showDividends && p.loading && (
          <div className="text-center py-24 text-slate-400">
            <div className="text-4xl mb-4 animate-pulse">⚙️</div>
            <p>Parsing transactions…</p>
          </div>
        )}

        {!showTax && !showCombined && !showDividends && hasData && (
          <div className="flex gap-6 items-start">

            {/* Main content — filtered by view */}
            <div className="flex-1 min-w-0 space-y-6">

              {/* ── Controls bar: view toggle · market selector · FY filter ── */}
              <div className="flex items-center gap-3 flex-wrap">

                {/* Options / Stocks toggle — Tasty/IBKR only */}
                {!isEquityOnly && (
                  <div className="bg-slate-800 rounded-lg p-1 flex gap-1 shrink-0">
                    <button
                      onClick={() => setView('options')}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        view === 'options'
                          ? 'bg-violet-600 text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                    >
                      Options
                    </button>
                    <button
                      onClick={() => setView('stocks')}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        view === 'stocks'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                    >
                      Stocks
                    </button>
                  </div>
                )}

                {/* AUS / US market selector — Selfwealth only */}
                {isSelfwealth && (
                  <div className="bg-slate-800 rounded-lg p-1 flex gap-1 shrink-0">
                    <button
                      onClick={() => setSwMarket('aus')}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        swMarket === 'aus'
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                    >
                      AUS <span className="text-xs opacity-70">AUD</span>
                    </button>
                    <button
                      onClick={() => setSwMarket('us')}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        swMarket === 'us'
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                    >
                      US <span className="text-xs opacity-70">USD</span>
                    </button>
                  </div>
                )}

                {/* FY filter pills — pushed to the right */}
                {availableFYs.length > 1 && (
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <span className="text-xs text-slate-500 shrink-0">Financial year:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        onClick={() => setFilterFY('all')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          filterFY === 'all'
                            ? 'bg-slate-600 text-slate-100'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        All time
                      </button>
                      {availableFYs.map(fy => (
                        <button
                          key={fy}
                          onClick={() => setFilterFY(fy)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            filterFY === fy
                              ? 'bg-violet-600 text-white'
                              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          FY{fy}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* ── OPTIONS VIEW ─────────────────────────────────────────── */}
              {view === 'options' && filteredStats && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Total P&L"     value={fmt(filteredStats.totalPnL)}    positive={filteredStats.totalPnL >= 0} />
                    <StatCard label="Win Rate"      value={`${filteredStats.winRate.toFixed(1)}%`} sub={`${filteredStats.wins}W / ${filteredStats.losses}L`} positive={filteredStats.winRate >= 50} />
                    <StatCard label="Avg Win"       value={fmt(filteredStats.avgWin)}       positive={true} />
                    <StatCard label="Avg Loss"      value={fmt(filteredStats.avgLoss)}      positive={false} />
                    <StatCard label="Largest Win"   value={fmt(filteredStats.largestWin)}   positive={true} />
                    <StatCard label="Largest Loss"  value={fmt(filteredStats.largestLoss)}  positive={false} />
                    <StatCard label="Total Trades"  value={filteredStats.totalTrades} />
                    <StatCard label="Avg Days Held" value={`${Math.round(filteredTrades.reduce((s, t) => s + t.daysHeld, 0) / (filteredTrades.length || 1))}d`} />
                  </div>

                  <YearSummary byYear={filteredStats.byYear} movements={p.moneyMovements} tags={p.capitalTags} />

                  <CalendarHeatmap dailyPnL={optionsDailyPnL} />

                  {p.wheels.length > 0 && <WheelTracker positions={p.wheels} />}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <TickerBreakdown data={filteredStats.byUnderlying} />
                    <StrategyBreakdown data={filteredStats.byStrategy} />
                  </div>

                  <TradeTable trades={filteredTrades} onStrategyChange={handleStrategyChange} />
                </>
              )}

              {/* ── STOCKS VIEW ──────────────────────────────────────────── */}
              {view === 'stocks' && activeEquityData && (
                <>
                  {/* Stat tiles — driven by filtered closed positions; show dashes when none */}
                  {(() => {
                    const s = filteredEquityData?.stats
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard label="Total P&L"     value={s ? fmt(s.totalPnL)                 : '—'} positive={s ? s.totalPnL >= 0 : undefined} />
                        <StatCard label="Win Rate"      value={s ? `${s.winRate.toFixed(1)}%`      : '—'} sub={s ? `${s.wins}W / ${s.losses}L` : undefined} positive={s ? s.winRate >= 50 : undefined} />
                        <StatCard label="Avg Win"       value={s ? fmt(s.avgWin)                   : '—'} positive={s ? true : undefined} />
                        <StatCard label="Avg Loss"      value={s ? fmt(s.avgLoss)                  : '—'} positive={s ? false : undefined} />
                        <StatCard label="Largest Win"   value={s ? fmt(s.largestWin)               : '—'} positive={s ? true : undefined} />
                        <StatCard label="Largest Loss"  value={s ? fmt(s.largestLoss)              : '—'} positive={s ? false : undefined} />
                        <StatCard label="Total Trades"  value={s ? s.totalTrades                   : 0} />
                        <StatCard label="Avg Days Held" value={s ? `${Math.round(s.avgDaysHeld)}d` : '—'} />
                      </div>
                    )
                  })()}

                  {/* FY Year-to-Date — only when filtered closed trades exist */}
                  {filteredEquityData?.stats?.byYear?.length > 0 && (
                    <YearSummary
                      byYear={filteredEquityData.stats.byYear}
                      subtitle="Stock closed trades · 1 Jul – 30 Jun"
                    />
                  )}

                  {/* Stock calendar */}
                  {Object.keys(equityDailyPnL).length > 0 && (
                    <CalendarHeatmap dailyPnL={equityDailyPnL} />
                  )}

                  {/* Open positions — always shown unfiltered (current holdings) */}
                  <StockOpenPositions
                    openPositions={activeEquityData.openPositions}
                    totalOpenCost={activeEquityData.totalOpenCost}
                  />

                  {/* Closed positions — filtered by selected FY */}
                  {(filteredEquityData?.closedPositions?.length ?? 0) > 0 && (
                    <StockClosedTable
                      closedPositions={filteredEquityData.closedPositions}
                      totalRealizedPnL={filteredEquityData.totalRealizedPnL}
                    />
                  )}

                  {p.moneyMovements.length > 0 && (
                    <CapitalMovements
                      movements={p.moneyMovements}
                      tags={p.capitalTags}
                      onTagChange={handleCapitalTagChange}
                    />
                  )}
                </>
              )}

              {/* No equity data for this market */}
              {view === 'stocks' && !activeEquityData && (
                <div className="text-center py-24 text-slate-500">
                  <p className="text-4xl mb-4">📦</p>
                  <p>
                    {isSelfwealth
                      ? `No ${swMarket === 'aus' ? 'AUS (AUD)' : 'US (USD)'} stock trades found. Upload the ${swMarket === 'aus' ? 'AUS' : 'US'} CSV for this portfolio.`
                      : 'No stock trades found in this portfolio.'
                    }
                  </p>
                </div>
              )}
              {view === 'options' && !filteredStats && !isEquityOnly && (
                <div className="text-center py-24 text-slate-500">
                  <p className="text-4xl mb-4">📭</p>
                  <p>
                    {filterFY !== 'all'
                      ? `No options trades in FY${filterFY}.`
                      : 'No options trades found in this portfolio.'
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Right column: Gain/Loss + Account Summary — sticky as a unit */}
            <div className="hidden xl:flex flex-col gap-4 w-56 shrink-0 sticky top-6 self-start">
              <GainLossSummary
                trades={(!isEquityOnly && view === 'options') ? filteredTrades : []}
                equityData={(isEquityOnly || view === 'stocks') ? filteredEquityData : null}
              />
              {p.moneyMovements.length > 0 && (
                <AccountSidebar movements={p.moneyMovements} tags={p.capitalTags} />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
