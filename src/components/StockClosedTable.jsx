import { useState } from 'react'
import { fmt } from '../utils/format'

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtPrice(n) {
  if (n == null) return '—'
  return `$${Math.abs(n).toFixed(2)}`
}

function fmtFee(n) {
  if (!n || Math.abs(n) < 0.001) return '—'
  return `-$${Math.abs(n).toFixed(2)}`
}

const PAGE = 25

export default function StockClosedTable({ closedPositions = [], totalRealizedPnL = 0 }) {
  const [page, setPage]         = useState(0)
  const [sortKey, setSortKey]   = useState('sellDate')
  const [sortDir, setSortDir]   = useState(-1)

  if (!closedPositions.length) return null

  const sorted = [...closedPositions].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey]
    if (va < vb) return -sortDir
    if (va > vb) return sortDir
    return 0
  })

  const pages   = Math.ceil(sorted.length / PAGE)
  const visible = sorted.slice(page * PAGE, (page + 1) * PAGE)

  const totalFees     = closedPositions.reduce((s, p) => s + (p.totalFees ?? 0), 0)
  const totalProceeds = closedPositions.reduce((s, p) => s + (p.saleProceeds ?? 0), 0)
  const totalCost     = closedPositions.reduce((s, p) => s + (p.costBasis ?? 0), 0)

  function col(key, label, align = 'left') {
    const active = sortKey === key
    return (
      <th
        className={`px-3 py-2 text-xs text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none whitespace-nowrap text-${align}`}
        onClick={() => { setSortKey(key); setSortDir(sortKey === key ? -sortDir : -1); setPage(0) }}
      >
        {label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-slate-300 font-semibold">Closed Positions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {closedPositions.length} trades · P&L shown after brokerage fees
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-xs text-slate-500">Total Cost Basis</p>
            <p className="text-slate-300 font-semibold">{fmt(totalCost)}</p>
            <p className="text-xs text-slate-600">excl. fees</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total Proceeds</p>
            <p className="text-slate-300 font-semibold">{fmt(totalProceeds)}</p>
            <p className="text-xs text-slate-600">excl. fees</p>
          </div>
          {totalFees > 0.01 && (
            <div>
              <p className="text-xs text-slate-500">Total Fees</p>
              <p className="text-orange-400 font-semibold">-{fmt(totalFees)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500">Net P&L</p>
            <p className={`font-bold text-lg ${totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(totalRealizedPnL)}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              {col('symbol',      'Symbol')}
              {col('quantity',    'Qty',       'right')}
              {col('buyDate',     'Bought',    'left')}
              {col('sellDate',    'Sold',      'left')}
              {col('daysHeld',    'Days',      'right')}
              {col('buyPrice',    'Buy $',     'right')}
              {col('costBasis',   'Cost Basis (gross)', 'right')}
              {col('sellPrice',   'Sell $',            'right')}
              {col('saleProceeds','Proceeds (gross)',   'right')}
              {col('totalFees',   'Fees',      'right')}
              {col('pnl',         'Net P&L',   'right')}
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => (
              <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-slate-200">{t.symbol}</span>
                    {t.isDayTrade && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/50 text-yellow-300">Day</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-slate-300">{t.quantity.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(t.buyDate)}</td>
                <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(t.sellDate)}</td>
                <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{t.daysHeld}d</td>
                <td className="px-3 py-2.5 text-right text-slate-300 text-xs">{fmtPrice(t.buyPrice)}</td>
                <td className="px-3 py-2.5 text-right text-slate-300 text-xs font-medium">{fmtPrice(t.costBasis)}</td>
                <td className="px-3 py-2.5 text-right text-slate-300 text-xs">{fmtPrice(t.sellPrice)}</td>
                <td className="px-3 py-2.5 text-right text-slate-300 text-xs font-medium">{fmtPrice(t.saleProceeds)}</td>
                <td className="px-3 py-2.5 text-right text-xs text-orange-400">{fmtFee(t.totalFees)}</td>
                <td className={`px-3 py-2.5 text-right font-bold text-sm ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmt(t.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500 text-xs">{closedPositions.length} trades</span>
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
  )
}
