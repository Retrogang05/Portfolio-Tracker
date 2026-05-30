import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { fmt } from '../utils/format'
import { auFY } from '../utils/calculatePnL'
import { capitalRowId, effectiveCategory } from './CapitalMovements'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthLabel(isoMonth) {
  const m = parseInt(isoMonth.slice(5, 7), 10)
  return MONTH_LABELS[m - 1] ?? isoMonth
}

// No decimals; compact suffix for large values so amounts always fit the tile
function fmtTile(n) {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000)    return `${sign}$${Math.round(abs / 1_000)}k`
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

function Tile({ label, value, positive, sub }) {
  const color =
    positive === true  ? 'text-emerald-400' :
    positive === false ? 'text-red-400'     :
    'text-slate-100'
  return (
    <div className="bg-slate-700/50 rounded-xl p-3 flex flex-col gap-1 min-w-0 overflow-hidden">
      <span className="text-slate-400 text-xs uppercase tracking-wider leading-tight truncate">{label}</span>
      <span className={`text-base font-bold leading-tight truncate ${color}`}>{value}</span>
      {sub && <span className="text-slate-500 text-xs truncate">{sub}</span>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm">
      <p className="text-slate-300 mb-1">{label}</p>
      <p className={`font-bold ${payload[0].value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmt(payload[0].value)}
      </p>
    </div>
  )
}

export default function YearSummary({ byYear, movements = [], tags = {}, subtitle = 'Options closed trades · 1 Jul – 30 Jun' }) {
  const years = byYear.map(y => y.year)
  const [selectedYear, setSelectedYear] = useState(() => years[years.length - 1])

  if (!byYear.length) return null

  const yearIdx = years.indexOf(selectedYear)
  const effectiveIdx = yearIdx === -1 ? years.length - 1 : yearIdx
  const data = byYear[effectiveIdx]

  // Dividends for selected FY from money movements
  const fyDividends = movements
    .filter(m => m.date && effectiveCategory(m, tags) === 'Dividend Income' && auFY(m.date) === data.year)
    .reduce((s, m) => s + m.amount, 0)

  const totalFYPnL = data.pnl + fyDividends

  const chartData = data.months.map(m => ({
    label: monthLabel(m.month),
    pnl: m.pnl,
  }))

  const now = new Date()
  const currentFY = (now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()).toString()
  const isCurrentYear = data.year === currentFY

  return (
    <div className="bg-slate-800 rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-slate-300 font-semibold">
            {isCurrentYear ? `FY${data.year} Year-to-Date` : `FY${data.year} Summary`}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {years.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear(years[effectiveIdx - 1])}
              disabled={effectiveIdx === 0}
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-700 text-slate-300 disabled:opacity-30 hover:bg-slate-600 transition-colors"
            >◀</button>
            <span className="text-slate-200 font-semibold w-16 text-center">FY{data.year}</span>
            <button
              onClick={() => setSelectedYear(years[effectiveIdx + 1])}
              disabled={effectiveIdx === years.length - 1}
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-700 text-slate-300 disabled:opacity-30 hover:bg-slate-600 transition-colors"
            >▶</button>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile
          label="Total FY P&L"
          value={fmtTile(totalFYPnL)}
          positive={totalFYPnL >= 0}
          sub={fyDividends !== 0 ? `Opts ${fmtTile(data.pnl)} · Div ${fmtTile(fyDividends)}` : undefined}
        />
        <Tile
          label="Dividend Income"
          value={fyDividends !== 0 ? fmtTile(fyDividends) : '—'}
          positive={fyDividends > 0 ? true : fyDividends < 0 ? false : undefined}
        />
        <Tile
          label="Win Rate"
          value={`${data.winRate.toFixed(1)}%`}
          sub={`${data.wins}W / ${data.losses}L`}
          positive={data.winRate >= 50}
        />
        <Tile label="Trades" value={data.count} />
        <Tile
          label="Best Month"
          value={data.bestMonth ? fmtTile(data.bestMonth.pnl) : '—'}
          sub={data.bestMonth ? monthLabel(data.bestMonth.month) : undefined}
          positive={data.bestMonth ? data.bestMonth.pnl >= 0 : undefined}
        />
        <Tile
          label="Worst Month"
          value={data.worstMonth ? fmtTile(data.worstMonth.pnl) : '—'}
          sub={data.worstMonth ? monthLabel(data.worstMonth.month) : undefined}
          positive={data.worstMonth ? data.worstMonth.pnl >= 0 : false}
        />
      </div>

      {/* Monthly bar chart — options only */}
      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} tickFormatter={v => `$${v}`} width={70} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.pnl >= 0 ? '#34d399' : '#f87171'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
