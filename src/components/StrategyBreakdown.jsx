import { fmt } from '../utils/format'

export default function StrategyBreakdown({ data }) {
  const maxAbs = Math.max(...data.map(d => Math.abs(d.pnl)), 1)

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <h2 className="text-slate-300 font-semibold mb-4">P&L by Strategy</h2>
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {data.map(d => (
          <div key={d.strategy} className="flex items-center gap-3">
            <span className="text-slate-300 text-sm w-44 shrink-0 truncate" title={d.strategy}>{d.strategy}</span>
            <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full ${d.pnl >= 0 ? 'bg-violet-400' : 'bg-red-400'}`}
                style={{ width: `${(Math.abs(d.pnl) / maxAbs) * 100}%` }}
              />
            </div>
            <span className={`text-sm font-semibold w-20 text-right shrink-0 ${d.pnl >= 0 ? 'text-violet-300' : 'text-red-400'}`}>
              {fmt(d.pnl)}
            </span>
            <span className="text-slate-500 text-xs w-16 text-right shrink-0">
              {d.wins}/{d.count} wins
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
