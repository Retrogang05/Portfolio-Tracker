import { useState } from 'react'
import { fmt, fmtINR } from '../utils/format'

const PAGE = 15

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtPrice(n) {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

export default function StockOpenPositions({ openPositions = [], totalOpenCost = 0, currency = 'USD' }) {
  const fmtAmt = currency === 'INR' ? fmtINR : fmt
  // Money figures settle in the account's base currency, which may differ from the
  // currency a foreign holding is quoted in — label it so the two aren't confused.
  const cur = currency || null
  const [page, setPage] = useState(0)

  if (!openPositions.length) return null

  // Show the quoted-price column only when some holding is quoted in a currency other
  // than the account base — that price excludes fees and FX, so it is what you compare
  // against the live market price. If everything is quoted in the base currency the
  // column would just duplicate Avg Cost.
  const showQuoted = openPositions.some(
    p => p.avgCostQuoted > 0 && p.priceCurrency && p.priceCurrency !== cur
  )

  const pages   = Math.ceil(openPositions.length / PAGE)
  const visible = openPositions.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-slate-300 font-semibold">Open Positions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Current holdings at cost basis{cur ? ` · amounts in ${cur}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Total Invested (cost){cur ? ` · ${cur}` : ''}</p>
          <p className="text-slate-200 font-bold text-lg">{fmtAmt(totalOpenCost)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="px-3 py-2 text-left   text-xs text-slate-400 uppercase tracking-wider">Symbol</th>
              <th className="px-3 py-2 text-right  text-xs text-slate-400 uppercase tracking-wider">Qty</th>
              <th className="px-3 py-2 text-right  text-xs text-slate-400 uppercase tracking-wider">Avg Cost / share{cur ? ` (${cur})` : ''}</th>
              {showQuoted && (
                <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">
                  Avg Cost / share <span className="normal-case text-slate-500">(quoted)</span>
                </th>
              )}
              <th className="px-3 py-2 text-right  text-xs text-slate-400 uppercase tracking-wider">Total Cost Basis{cur ? ` (${cur})` : ''}</th>
              <th className="px-3 py-2 text-left   text-xs text-slate-400 uppercase tracking-wider">First Buy</th>
              <th className="px-3 py-2 text-right  text-xs text-slate-400 uppercase tracking-wider">Lots</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pos, i) => (
              <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                <td className="px-3 py-2.5 font-mono font-semibold text-slate-200">{pos.symbol}</td>
                <td className="px-3 py-2.5 text-right text-slate-300">{pos.quantity.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-slate-300">{fmtPrice(pos.avgCost)}</td>
                {showQuoted && (
                  <td className="px-3 py-2.5 text-right text-slate-300 whitespace-nowrap">
                    {fmtPrice(pos.avgCostQuoted)}
                    {pos.priceCurrency && (
                      <span className="text-slate-500 text-xs ml-1">{pos.priceCurrency}</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right font-semibold text-slate-200">{fmtAmt(pos.totalCost)}</td>
                <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(pos.earliestBuy)}</td>
                <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{pos.lots.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500 text-xs">{openPositions.length} positions</span>
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
