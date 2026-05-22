import { fmt } from '../utils/format'

export default function TickerBreakdown({ data }) {
  const maxAbs = Math.max(...data.map(d => Math.abs(d.pnl)), 1)

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <h2 className="text-slate-300 font-semibold mb-4">P&L by Ticker</h2>
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {data.map(d => (
          <div key={d.symbol} className="flex items-center gap-3">
            <span className="text-slate-200 font-mono w-16 shrink-0 text-sm">{d.symbol}</span>
            <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full ${d.pnl >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`}
                style={{ width: `${(Math.abs(d.pnl) / maxAbs) * 100}%` }}
              />
            </div>
            <span className={`text-sm font-semibold w-20 text-right shrink-0 ${d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(d.pnl)}
            </span>
            <span className="text-slate-500 text-xs w-14 text-right shrink-0">
              {d.wins}/{d.count} wins
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
