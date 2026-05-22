import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { fmt } from '../utils/format'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm">
      <p className="text-slate-300 mb-1">{label}</p>
      <p className={`font-bold ${d.cumPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        Cumulative: {fmt(d.cumPnL)}
      </p>
      <p className={`text-xs ${d.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
        Trade P&L: {fmt(d.pnl)} · {d.underlying}
      </p>
    </div>
  )
}

export default function PnLChart({ data }) {
  const isPositive = data[data.length - 1]?.cumPnL >= 0
  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <h2 className="text-slate-300 font-semibold mb-4">Cumulative P&L</h2>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? '#34d399' : '#f87171'} stopOpacity={0.25} />
              <stop offset="95%" stopColor={isPositive ? '#34d399' : '#f87171'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} tickFormatter={v => `$${v}`} width={70} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#475569" />
          <Area
            type="monotone"
            dataKey="cumPnL"
            stroke={isPositive ? '#34d399' : '#f87171'}
            strokeWidth={2}
            fill="url(#pnlGrad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
