import { useState } from 'react'
import { fmt } from '../utils/format'

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtPrice(n) {
  if (!n) return '—'
  return `$${n.toFixed(2)}`
}

const PAGE = 20

export default function ShareTracker({ equityData }) {
  const [showAllClosed, setShowAllClosed] = useState(false)

  if (!equityData) return null
  const { openPositions, closedPositions, totalRealizedPnL, totalOpenCost } = equityData

  if (!openPositions.length && !closedPositions.length) return null

  const visibleClosed = showAllClosed ? closedPositions : closedPositions.slice(0, PAGE)
  const sortedClosed  = [...closedPositions].sort((a, b) => b.sellDate - a.sellDate)
  const visibleSortedClosed = showAllClosed ? sortedClosed : sortedClosed.slice(0, PAGE)

  return (
    <div className="bg-slate-800 rounded-xl p-5 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-slate-300 font-semibold">Share Portfolio</h2>
          <p className="text-xs text-slate-500 mt-0.5">Long-term equity positions</p>
        </div>
        <div className="flex gap-3 text-right">
          {totalOpenCost > 0 && (
            <div>
              <p className="text-xs text-slate-500">Invested (cost)</p>
              <p className="text-slate-200 font-bold">{fmt(-totalOpenCost)}</p>
            </div>
          )}
          {closedPositions.length > 0 && (
            <div>
              <p className="text-xs text-slate-500">Realised P&L</p>
              <p className={`font-bold ${totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(totalRealizedPnL)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Open positions */}
      {openPositions.length > 0 && (
        <div>
          <h3 className="text-xs text-slate-400 uppercase tracking-wider mb-3">Open Positions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Symbol</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Qty</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Avg Cost</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Total Cost</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">First Buy</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Lots</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((pos, i) => (
                  <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                    <td className="px-3 py-2 font-mono font-semibold text-slate-200">{pos.symbol}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{pos.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{fmtPrice(pos.avgCost)}</td>
                    <td className="px-3 py-2 text-right text-slate-200 font-semibold">{fmt(-pos.totalCost)}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(pos.earliestBuy)}</td>
                    <td className="px-3 py-2 text-right text-slate-500 text-xs">{pos.lots.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Closed trades */}
      {closedPositions.length > 0 && (
        <div>
          <h3 className="text-xs text-slate-400 uppercase tracking-wider mb-3">
            Closed Trades
            <span className="text-slate-600 ml-2 normal-case tracking-normal">({closedPositions.length} total)</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Symbol</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Qty</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Bought</th>
                  <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Sold</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Days</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Buy $</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Sell $</th>
                  <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">P&L</th>
                </tr>
              </thead>
              <tbody>
                {visibleSortedClosed.map((t, i) => (
                  <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-200">{t.symbol}</span>
                        {t.isDayTrade && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/50 text-yellow-300">Day</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{t.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(t.buyDate)}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{fmtDate(t.sellDate)}</td>
                    <td className="px-3 py-2 text-right text-slate-500 text-xs">{t.daysHeld}d</td>
                    <td className="px-3 py-2 text-right text-slate-300 text-xs">{fmtPrice(t.buyPrice)}</td>
                    <td className="px-3 py-2 text-right text-slate-300 text-xs">{fmtPrice(t.sellPrice)}</td>
                    <td className={`px-3 py-2 text-right font-bold text-sm ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmt(t.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {closedPositions.length > PAGE && (
            <button
              onClick={() => setShowAllClosed(v => !v)}
              className="mt-3 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              {showAllClosed ? 'Show less' : `Show all ${closedPositions.length} closed trades`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
