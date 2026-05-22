import { useState } from 'react'
import { fmt } from '../utils/format'

const PAGE_SIZE = 20

export default function TradeTable({ trades }) {
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState('closeDate')
  const [sortDir, setSortDir] = useState(-1)
  const [filter, setFilter] = useState('')

  const filtered = trades.filter(t =>
    t.underlying.toLowerCase().includes(filter.toLowerCase())
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
      className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none"
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
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 w-40"
          placeholder="Filter ticker…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0) }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              {col('underlying', 'Ticker')}
              {col('callPut', 'Type')}
              {col('strike', 'Strike')}
              {col('expiration', 'Expiry')}
              {col('quantity', 'Qty')}
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
            {slice.map((t, i) => (
              <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                <td className="px-3 py-2 font-mono font-semibold text-slate-200">{t.underlying}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.callPut === 'CALL' ? 'bg-blue-900/50 text-blue-300' : 'bg-orange-900/50 text-orange-300'}`}>
                    {t.callPut === 'CALL' ? 'Call' : 'Put'}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-300">{t.strike}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">{t.expiration}</td>
                <td className="px-3 py-2 text-slate-300">{t.quantity}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(t.openDate)}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(t.closeDate)}</td>
                <td className="px-3 py-2 text-slate-400">{t.daysHeld}d</td>
                <td className="px-3 py-2 text-slate-300">{t.openPrice.toFixed(2)}</td>
                <td className="px-3 py-2 text-slate-300">{t.isExpiration ? '—' : t.closePrice.toFixed(2)}</td>
                <td className="px-3 py-2">
                  {t.isExpiration
                    ? <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-400">Expired</span>
                    : <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700/50 text-slate-500">Closed</span>
                  }
                </td>
                <td className={`px-3 py-2 font-semibold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmt(t.pnl)}
                </td>
              </tr>
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

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
