import { useMemo } from 'react'
import { fmt } from '../utils/format'

function rolling(dailyPnL, days) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return Object.entries(dailyPnL)
    .filter(([date]) => date >= cutoffStr)
    .reduce((sum, [, entry]) => sum + (entry.pnl ?? 0), 0)
}

export default function RollingPnL({ dailyPnL = {} }) {
  const pnl30 = useMemo(() => rolling(dailyPnL, 30),  [dailyPnL])
  const pnl60 = useMemo(() => rolling(dailyPnL, 60),  [dailyPnL])
  const pnl90 = useMemo(() => rolling(dailyPnL, 90),  [dailyPnL])

  if (!Object.keys(dailyPnL).length) return null

  return (
    <div className="grid grid-cols-3 gap-4">
      {[
        { label: 'Last 30 Days', pnl: pnl30 },
        { label: 'Last 60 Days', pnl: pnl60 },
        { label: 'Last 90 Days', pnl: pnl90 },
      ].map(({ label, pnl }) => (
        <div key={label} className="bg-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
          <p className={`text-xl font-bold tabular-nums ${
            pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-slate-500'
          }`}>
            {fmt(pnl)}
          </p>
          {pnl === 0 && (
            <p className="text-xs text-slate-600 mt-0.5">No closed trades</p>
          )}
        </div>
      ))}
    </div>
  )
}
