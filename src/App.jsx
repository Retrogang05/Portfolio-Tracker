import { useState } from 'react'
import FileUpload from './components/FileUpload'
import StatCard from './components/StatCard'
import PnLChart from './components/PnLChart'
import MonthlyChart from './components/MonthlyChart'
import TickerBreakdown from './components/TickerBreakdown'
import TradeTable from './components/TradeTable'
import { parseCSV } from './utils/parseTastyworks'
import { buildTrades, computeStats } from './utils/calculatePnL'
import { fmt } from './utils/format'

export default function App() {
  const [stats, setStats] = useState(null)
  const [trades, setTrades] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState('')

  async function handleFile(file) {
    setLoading(true)
    setError(null)
    setFileName(file.name)
    try {
      const rows = await parseCSV(file)
      const { closedTrades } = buildTrades(rows)
      const s = computeStats(closedTrades)
      setTrades(closedTrades)
      setStats(s)
      if (!s) setError('No matched trades found. Make sure this is a Tastytrade transaction history CSV.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
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
            onClick={() => { setStats(null); setTrades([]); setFileName(''); setError(null) }}
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
              <StatCard label="Total P&L" value={fmt(stats.totalPnL)} positive={stats.totalPnL >= 0} />
              <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} positive={stats.winRate >= 50} />
              <StatCard label="Avg Win" value={fmt(stats.avgWin)} positive={true} />
              <StatCard label="Avg Loss" value={fmt(stats.avgLoss)} positive={false} />
              <StatCard label="Largest Win" value={fmt(stats.largestWin)} positive={true} />
              <StatCard label="Largest Loss" value={fmt(stats.largestLoss)} positive={false} />
              <StatCard label="Total Trades" value={stats.totalTrades} />
              <StatCard label="Total Fees" value={fmt(stats.totalFees)} positive={false} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PnLChart data={stats.cumulativeData} />
              <MonthlyChart data={stats.byMonth} />
            </div>

            <TickerBreakdown data={stats.byUnderlying} />
            <TradeTable trades={trades} />
          </>
        )}
      </main>
    </div>
  )
}
