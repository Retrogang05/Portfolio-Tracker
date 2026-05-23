import { useState } from 'react'
import FileUpload from './components/FileUpload'
import StatCard from './components/StatCard'
import CalendarHeatmap from './components/CalendarHeatmap'
import MonthlyChart from './components/MonthlyChart'
import TickerBreakdown from './components/TickerBreakdown'
import StrategyBreakdown from './components/StrategyBreakdown'
import TradeTable from './components/TradeTable'
import { parseCSV } from './utils/parseTastyworks'
import { tagRowsWithStrategy } from './utils/identifyStrategy'
import { buildTrades, computeStats } from './utils/calculatePnL'
import { fmt } from './utils/format'

const OVERRIDES_KEY = 'options-tracker:strategy-overrides'

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}') } catch { return {} }
}
function saveOverrides(overrides) {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
}

function applyOverrides(trades, overrides) {
  return trades.map(t => {
    const override = overrides[t.strategyGroupId]
    if (!override) return t
    return { ...t, strategyName: override, isOverridden: true }
  })
}

export default function App() {
  const [stats, setStats]       = useState(null)
  const [trades, setTrades]     = useState([])
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [fileName, setFileName] = useState('')
  // Raw (auto-detected) trades — overrides are applied on top
  const [rawTrades, setRawTrades] = useState([])
  const [overrides, setOverrides] = useState(loadOverrides)

  async function handleFile(file) {
    setLoading(true)
    setError(null)
    setFileName(file.name)
    try {
      const raw = await parseCSV(file)
      const rows = tagRowsWithStrategy(raw)
      const { closedTrades } = buildTrades(rows)
      const currentOverrides = loadOverrides()
      const withOverrides = applyOverrides(closedTrades, currentOverrides)
      setRawTrades(closedTrades)
      setTrades(withOverrides)
      setStats(computeStats(withOverrides))
      if (!closedTrades.length) setError('No matched trades found. Make sure this is a Tastytrade transaction history CSV.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleStrategyChange(strategyGroupId, newStrategy) {
    const newOverrides = { ...overrides, [strategyGroupId]: newStrategy }
    setOverrides(newOverrides)
    saveOverrides(newOverrides)

    const updated = applyOverrides(rawTrades, newOverrides)
    setTrades(updated)
    setStats(computeStats(updated))
  }

  function handleReset() {
    setStats(null)
    setTrades([])
    setRawTrades([])
    setFileName('')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📈</span>
          <span className="font-bold text-lg tracking-tight">Options Tracker</span>
          <span className="text-slate-500 text-xs px-2 py-0.5 bg-slate-800 rounded-full">Tastytrade</span>
        </div>
        {fileName && (
          <button
            onClick={handleReset}
            className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            ↩ Load new file
          </button>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {!stats && !loading && (
          <>
            <div className="text-center space-y-2 pt-8 pb-4">
              <h1 className="text-3xl font-bold text-slate-100">Options P&L Dashboard</h1>
              <p className="text-slate-400">Upload your Tastytrade transaction history to analyze your trades</p>
            </div>
            <FileUpload onFile={handleFile} />
            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
                {error}
              </div>
            )}
            <div className="bg-slate-800/50 rounded-xl p-5 text-sm text-slate-400 space-y-2">
              <p className="font-medium text-slate-300">How to export from Tastytrade:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Log in to Tastytrade → click <strong className="text-slate-300">History</strong> in the left sidebar</li>
                <li>Select <strong className="text-slate-300">Transactions</strong> tab</li>
                <li>Choose your date range</li>
                <li>Click <strong className="text-slate-300">Download CSV</strong></li>
              </ol>
            </div>
          </>
        )}

        {loading && (
          <div className="text-center py-24 text-slate-400">
            <div className="text-4xl mb-4 animate-pulse">⚙️</div>
            <p>Parsing trades…</p>
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total P&L"    value={fmt(stats.totalPnL)}    positive={stats.totalPnL >= 0} />
              <StatCard label="Win Rate"     value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} positive={stats.winRate >= 50} />
              <StatCard label="Avg Win"      value={fmt(stats.avgWin)}      positive={true} />
              <StatCard label="Avg Loss"     value={fmt(stats.avgLoss)}     positive={false} />
              <StatCard label="Largest Win"  value={fmt(stats.largestWin)}  positive={true} />
              <StatCard label="Largest Loss" value={fmt(stats.largestLoss)} positive={false} />
              <StatCard label="Total Trades" value={stats.totalTrades} />
              <StatCard label="Avg Days Held" value={`${Math.round(trades.reduce((s, t) => s + t.daysHeld, 0) / (trades.length || 1))}d`} />
            </div>

            <CalendarHeatmap dailyPnL={stats.dailyPnL} />

            <MonthlyChart data={stats.byMonth} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TickerBreakdown data={stats.byUnderlying} />
              <StrategyBreakdown data={stats.byStrategy} />
            </div>

            <TradeTable trades={trades} onStrategyChange={handleStrategyChange} />
          </>
        )}
      </main>
    </div>
  )
}
