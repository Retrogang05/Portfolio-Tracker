import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { fmt } from '../utils/format'

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { date, cumulative, pnl } = payload[0].payload
  const d = new Date(date + 'T00:00:00Z')
  const dateStr = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-slate-400 text-xs mb-1">{dateStr}</p>
      <p className={`font-bold ${cumulative >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        Cumulative: {fmt(cumulative)}
      </p>
      <p className={`text-xs mt-0.5 ${pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
        Daily: {fmt(pnl)}
      </p>
    </div>
  )
}

export default function CumulativePnLChart({ dailyPnL = {} }) {
  const data = useMemo(() => {
    const sorted = Object.entries(dailyPnL).sort(([a], [b]) => a.localeCompare(b))
    let cumulative = 0
    return sorted.map(([date, entry]) => {
      cumulative += entry.pnl ?? 0
      return {
        date,
        pnl:        parseFloat((entry.pnl ?? 0).toFixed(2)),
        cumulative: parseFloat(cumulative.toFixed(2)),
      }
    })
  }, [dailyPnL])

  if (data.length < 2) return null

  const finalPnL    = data[data.length - 1].cumulative
  const lineColor   = finalPnL >= 0 ? '#34d399' : '#f87171'

  const formatXAxis = d =>
    new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-slate-300 font-semibold">Cumulative P&amp;L</h2>
        <span className={`text-lg font-bold tabular-nums ${finalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(finalPnL)}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="cumGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={lineColor} stopOpacity={0.18} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0}    />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.07)" />

          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={v => fmt(v)}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={72}
          />

          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />

          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#cumGradient)"
            dot={false}
            activeDot={{ r: 4, fill: lineColor, stroke: '#1e293b', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
