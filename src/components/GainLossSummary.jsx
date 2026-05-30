import { useState, useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { fmt } from '../utils/format'
import { auFY } from '../utils/calculatePnL'

const PERIODS = [
  { label: 'Month', key: 'month' },
  { label: 'FY',    key: 'fy'    },
  { label: 'All',   key: 'all'   },
]

function inPeriod(date, period) {
  if (!date || isNaN(date)) return false
  const now = new Date()
  if (period === 'month') return date.toISOString().slice(0, 7) === now.toISOString().slice(0, 7)
  if (period === 'fy')    return auFY(date) === auFY(now)
  return true
}

function Row({ label, sublabel, value, color, isCount }) {
  return (
    <div className="flex items-start justify-between gap-1">
      <div className="min-w-0">
        <p className="text-xs text-slate-400 leading-tight truncate">{label}</p>
        {sublabel && <p className="text-xs text-slate-600 leading-tight">{sublabel}</p>}
      </div>
      <span className={`text-xs font-semibold shrink-0 ${color ?? 'text-slate-300'}`}>
        {value === null || value === undefined
          ? '—'
          : isCount ? value : fmt(value)}
      </span>
    </div>
  )
}

export default function GainLossSummary({ trades = [], equityData = null }) {
  const [period, setPeriod] = useState('fy')

  const items = useMemo(() => {
    const opts = trades
      .filter(t => inPeriod(t.closeDate, period))
      .map(t => ({ pnl: t.pnl, daysHeld: t.daysHeld }))

    const eq = (equityData?.closedPositions ?? [])
      .filter(p => inPeriod(p.sellDate, period))
      .map(p => ({ pnl: p.pnl, daysHeld: p.daysHeld }))

    return [...opts, ...eq]
  }, [trades, equityData, period])

  const gains       = items.filter(x => x.pnl > 0)
  const losses      = items.filter(x => x.pnl < 0)
  const totalGains  = gains.reduce((s, x) => s + x.pnl, 0)
  const totalLosses = losses.reduce((s, x) => s + x.pnl, 0)
  const netPnL      = totalGains + totalLosses
  const winRate     = items.length > 0 ? (gains.length / items.length) * 100 : 0

  // Australian CGT: < 12 months = short term, >= 12 months eligible for 50% discount
  const shortTerm = items.filter(x => x.daysHeld < 365)
  const longTerm  = items.filter(x => x.daysHeld >= 365)
  const shortPnL  = shortTerm.reduce((s, x) => s + x.pnl, 0)
  const longPnL   = longTerm.reduce((s, x) => s + x.pnl, 0)

  const noData = items.length === 0
  const donutData = noData
    ? [{ value: 1 }]
    : [
        { value: Math.max(gains.length, 0.001) },
        { value: Math.max(losses.length, 0.001) },
      ]
  const donutColors = noData ? ['#1e293b'] : ['#34d399', '#f87171']

  return (
    <div className="bg-slate-800 rounded-xl p-4 space-y-3">

        {/* Header + period tabs */}
        <div className="flex items-center justify-between">
          <h3 className="text-slate-300 text-sm font-semibold">Gain / Loss</h3>
          <div className="flex rounded overflow-hidden border border-slate-700">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2 py-0.5 text-xs transition-colors ${
                  period === p.key
                    ? 'bg-slate-600 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Donut chart */}
        <div className="relative">
          <ResponsiveContainer width="100%" height={116}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%" cy="50%"
                innerRadius={36} outerRadius={50}
                startAngle={90} endAngle={-270}
                dataKey="value"
                strokeWidth={0}
                isAnimationActive={false}
              >
                {donutData.map((_, i) => (
                  <Cell key={i} fill={donutColors[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className={`text-xl font-bold leading-none ${
              noData ? 'text-slate-600' : winRate >= 50 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {noData ? '—' : `${winRate.toFixed(0)}%`}
            </span>
            <span className="text-xs text-slate-500 mt-0.5">win rate</span>
          </div>
        </div>

        {/* Donut legend */}
        {!noData && (
          <div className="flex justify-center gap-3 -mt-1">
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              {gains.length}W
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
              {losses.length}L
            </span>
          </div>
        )}

        {/* Net P&L */}
        <div className="text-center py-1 border-y border-slate-700">
          <p className={`text-base font-bold ${noData ? 'text-slate-600' : netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {noData ? '—' : fmt(netPnL)}
          </p>
          <p className="text-xs text-slate-500">Net Gain / Loss</p>
        </div>

        {/* Gains / Losses / Trades */}
        <div className="space-y-2">
          <Row label="Total Gains"  value={noData ? null : totalGains}     color="text-emerald-400" />
          <Row label="Total Losses" value={noData ? null : totalLosses}    color="text-red-400" />
          <Row label="Trades"       value={noData ? null : items.length}   isCount />
        </div>

        {/* CGT split */}
        <div className="pt-2 border-t border-slate-700 space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider">CGT Split</p>
          {noData ? (
            <p className="text-xs text-slate-600">No data</p>
          ) : (
            <>
              <Row
                label="Short Term" sublabel="< 12 months"
                value={shortTerm.length ? shortPnL : null}
                color={shortPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              <Row
                label="Long Term" sublabel="≥ 12 months · 50% disc."
                value={longTerm.length ? longPnL : null}
                color={longPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
            </>
          )}
        </div>

      </div>
  )
}
