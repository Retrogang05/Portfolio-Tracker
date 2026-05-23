import { useState } from 'react'
import { fmt } from '../utils/format'

const PAGE_SIZE = 20

const STRATEGY_COLORS = {
  'Iron Condor':          'bg-violet-900/50 text-violet-300',
  'Iron Butterfly':       'bg-purple-900/50 text-purple-300',
  'Reverse Iron Condor':  'bg-violet-900/30 text-violet-400',
  'Bull Put Spread':      'bg-emerald-900/50 text-emerald-300',
  'Bear Put Spread':      'bg-red-900/50 text-red-300',
  'Bull Call Spread':     'bg-blue-900/50 text-blue-300',
  'Bear Call Spread':     'bg-orange-900/50 text-orange-300',
  'Short Straddle':       'bg-fuchsia-900/50 text-fuchsia-300',
  'Long Straddle':        'bg-fuchsia-900/30 text-fuchsia-400',
  'Short Strangle':       'bg-pink-900/50 text-pink-300',
  'Long Strangle':        'bg-pink-900/30 text-pink-400',
  'Jade Lizard':          'bg-lime-900/50 text-lime-300',
  'Inverted Jade Lizard': 'bg-yellow-900/50 text-yellow-300',
  'Short Call':           'bg-orange-900/40 text-orange-400',
  'Short Put':            'bg-emerald-900/40 text-emerald-400',
  'Long Call':            'bg-blue-900/40 text-blue-400',
  'Long Put':             'bg-red-900/40 text-red-400',
}

function StrategyBadge({ name }) {
  const cls = STRATEGY_COLORS[name] ?? 'bg-slate-700 text-slate-400'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cls}`}>
      {name ?? '—'}
    </span>
  )
}

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function LegRow({ leg }) {
  return (
    <tr className="bg-slate-900/40 text-xs border-b border-slate-700/30">
      <td className="pl-10 pr-3 py-1.5 text-slate-500">└</td>
      <td className="px-3 py-1.5">
        <span className={`px-1.5 py-0.5 rounded text-xs ${leg.callPut === 'CALL' ? 'bg-blue-900/40 text-blue-400' : 'bg-orange-900/40 text-orange-400'}`}>
          {leg.callPut === 'CALL' ? 'Call' : 'Put'}
        </span>
      </td>
      <td className="px-3 py-1.5 text-slate-400">{leg.strike}</td>
      <td className="px-3 py-1.5 text-slate-500">{leg.expiration}</td>
      <td className="px-3 py-1.5 text-slate-400">{leg.quantity}</td>
      <td className="px-3 py-1.5 text-slate-500">{fmtDate(leg.openDate)}</td>
      <td className="px-3 py-1.5 text-slate-500">{fmtDate(leg.closeDate)}</td>
      <td className="px-3 py-1.5 text-slate-500">{leg.daysHeld}d</td>
      <td className="px-3 py-1.5 text-slate-400">{leg.openPrice?.toFixed(2) ?? '—'}</td>
      <td className="px-3 py-1.5 text-slate-400">{leg.isExpiration ? '—' : leg.closePrice?.toFixed(2) ?? '—'}</td>
      <td className="px-3 py-1.5">
        {leg.isExpiration
          ? <span className="text-slate-500">Expired</span>
          : <span className="text-slate-600">Closed</span>
        }
      </td>
      <td className={`px-3 py-1.5 font-semibold ${leg.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmt(leg.pnl)}
      </td>
    </tr>
  )
}

function TradeRow({ trade, expanded, onToggle }) {
  const isMultiLeg = trade.legs?.length > 1
  const callPutLabel = trade.callPut === 'CALL' ? 'Call' : trade.callPut === 'PUT' ? 'Put' : null

  return (
    <>
      <tr
        className={`border-b border-slate-700/50 transition-colors ${isMultiLeg ? 'cursor-pointer hover:bg-slate-700/20' : 'hover:bg-slate-700/20'}`}
        onClick={isMultiLeg ? onToggle : undefined}
      >
        {/* Expand toggle */}
        <td className="px-3 py-2 w-8">
          {isMultiLeg && (
            <span className="text-slate-500 text-xs select-none">{expanded ? '▾' : '▸'}</span>
          )}
        </td>
        <td className="px-3 py-2 font-mono font-semibold text-slate-200">{trade.underlying}</td>
        <td className="px-3 py-2">
          <StrategyBadge name={trade.strategyName} />
        </td>
        <td className="px-3 py-2">
          {callPutLabel && (
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${trade.callPut === 'CALL' ? 'bg-blue-900/50 text-blue-300' : 'bg-orange-900/50 text-orange-300'}`}>
              {callPutLabel}
            </span>
          )}
          {!callPutLabel && (
            <span className="text-slate-600 text-xs">{trade.legs?.length} legs</span>
          )}
        </td>
        <td className="px-3 py-2 text-slate-300 text-sm">{trade.strike ?? '—'}</td>
        <td className="px-3 py-2 text-slate-400 text-xs">{trade.expiration ?? '—'}</td>
        <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(trade.openDate)}</td>
        <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(trade.closeDate)}</td>
        <td className="px-3 py-2 text-slate-400 text-sm">{trade.daysHeld}d</td>
        <td className="px-3 py-2 text-slate-300 text-sm">{trade.openPrice?.toFixed(2) ?? '—'}</td>
        <td className="px-3 py-2 text-slate-300 text-sm">{trade.isExpiration ? '—' : trade.closePrice?.toFixed(2) ?? '—'}</td>
        <td className="px-3 py-2">
          {trade.isExpiration
            ? <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-400">Expired</span>
            : <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/50 text-slate-500">Closed</span>
          }
        </td>
        <td className={`px-3 py-2 font-bold text-sm ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(trade.pnl)}
        </td>
      </tr>
      {isMultiLeg && expanded && trade.legs.map((leg, i) => (
        <LegRow key={i} leg={leg} />
      ))}
    </>
  )
}

export default function TradeTable({ trades }) {
  const [page, setPage]         = useState(0)
  const [sortKey, setSortKey]   = useState('closeDate')
  const [sortDir, setSortDir]   = useState(-1)
  const [filter, setFilter]     = useState('')
  const [expanded, setExpanded] = useState({}) // strategyGroupId → bool

  const toggleExpanded = id =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const filtered = trades.filter(t =>
    t.underlying.toLowerCase().includes(filter.toLowerCase()) ||
    (t.strategyName ?? '').toLowerCase().includes(filter.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey]
    if (va < vb) return -sortDir
    if (va > vb) return sortDir
    return 0
  })

  const pages = Math.ceil(sorted.length / PAGE_SIZE)
  const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const col = (key, label) => (
    <th
      className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none whitespace-nowrap"
      onClick={() => { setSortKey(key); setSortDir(sortKey === key ? -sortDir : -1); setPage(0) }}
    >
      {label}{sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h2 className="text-slate-300 font-semibold">Trade History</h2>
        <input
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 w-48"
          placeholder="Filter ticker or strategy…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0) }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="w-8" />
              {col('underlying', 'Ticker')}
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Strategy</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Type</th>
              {col('strike', 'Strike')}
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Expiry</th>
              {col('openDate', 'Opened')}
              {col('closeDate', 'Closed')}
              {col('daysHeld', 'Days')}
              {col('openPrice', 'Open $')}
              {col('closePrice', 'Close $')}
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Outcome</th>
              {col('pnl', 'P&L')}
            </tr>
          </thead>
          <tbody>
            {slice.map((trade, i) => (
              <TradeRow
                key={i}
                trade={trade}
                expanded={!!expanded[trade.strategyGroupId]}
                onToggle={() => toggleExpanded(trade.strategyGroupId)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500">{filtered.length} trades</span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-40"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
            >Prev</button>
            <span className="px-2 py-1 text-slate-400">{page + 1} / {pages}</span>
            <button
              className="px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-40"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= pages - 1}
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
