import { useState, useMemo } from 'react'
import { fmt } from '../utils/format'

const DOW   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

// ── Colour helpers ────────────────────────────────────────────────────────────

function cellColors(pnl, maxAbs) {
  if (pnl === null || pnl === undefined) {
    // No trades — empty cell
    return { bg: 'transparent', text: '#475569', amount: null }
  }
  if (Math.abs(pnl) < 0.01) {
    return { bg: '#1e293b', text: '#64748b', amount: '#64748b' }
  }
  const ratio = Math.min(Math.abs(pnl) / maxAbs, 1)
  // alpha 0.20 (tiny) → 0.85 (max)
  const alpha = 0.20 + ratio * 0.65
  if (pnl > 0) {
    return {
      bg:     `rgba(16,185,129,${alpha.toFixed(2)})`,   // emerald
      text:   ratio > 0.45 ? '#ecfdf5' : '#6ee7b7',
      amount: ratio > 0.45 ? '#ecfdf5' : '#6ee7b7',
    }
  }
  return {
    bg:     `rgba(239,68,68,${alpha.toFixed(2)})`,      // red
    text:   ratio > 0.45 ? '#fef2f2' : '#fca5a5',
    amount: ratio > 0.45 ? '#fef2f2' : '#fca5a5',
  }
}

function fmtCompact(n) {
  if (n === null || n === undefined) return ''
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : '+'
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`
  return `${sign}$${abs.toFixed(0)}`
}

// ── Calendar grid builder ────────────────────────────────────────────────────

function buildWeeks(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDow    = (new Date(year, month, 1).getDay() + 6) % 7  // Mon=0

  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      key: `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// ── Day-of-week aggregate ────────────────────────────────────────────────────

function computeDowStats(dailyPnL) {
  const acc = Array.from({ length: 7 }, () => ({ total: 0, count: 0, wins: 0 }))
  for (const [dateStr, d] of Object.entries(dailyPnL)) {
    const dow = (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7  // Mon=0, use noon to avoid DST
    acc[dow].total += d.pnl
    acc[dow].count++
    if (d.pnl > 0) acc[dow].wins++
  }
  return acc.map(s => ({
    count:   s.count,
    total:   s.total,
    avgPnL:  s.count ? s.total / s.count : null,
    winRate: s.count ? (s.wins / s.count) * 100 : null,
  }))
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DayCell({ cell, data, colors, isHovered, onEnter, onLeave }) {
  return (
    <div
      className="rounded-lg flex flex-col justify-between p-2 cursor-default select-none transition-all"
      style={{
        backgroundColor: colors.bg,
        height: 72,
        outline: isHovered ? '2px solid rgba(139,92,246,0.8)' : '2px solid transparent',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span className="text-xs leading-none" style={{ color: colors.text }}>{cell.day}</span>
      {data && (
        <span className="text-xs font-bold leading-none" style={{ color: colors.amount }}>
          {fmtCompact(data.pnl)}
        </span>
      )}
    </div>
  )
}

function HoverDetail({ dateKey, data }) {
  if (!data) return null
  return (
    <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-1 gap-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-sm">
          {new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
        <span className={`font-bold text-sm ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(data.pnl)} · {data.count} trade{data.count !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.trades.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-slate-700 rounded px-2 py-1 text-xs">
            <span className="font-mono text-slate-200">{t.underlying}</span>
            <span className="text-slate-500">{t.strategy}</span>
            <span className={t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt(t.pnl)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DowSummary({ dowStats, maxAvgAbs }) {
  return (
    <div className="mt-4 pt-4 border-t border-slate-700">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Avg P&L by Day of Week · all time</p>
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((day, i) => {
          const s = dowStats[i]
          const colors = cellColors(s.avgPnL, maxAvgAbs)
          return (
            <div
              key={day}
              className="rounded-lg p-2.5 text-center"
              style={{ backgroundColor: colors.bg || '#1e293b' }}
              title={s.count ? `${s.count} days · ${s.winRate?.toFixed(0)}% win rate` : 'No data'}
            >
              <p className="text-xs font-medium mb-1.5" style={{ color: colors.text }}>{day}</p>
              {s.avgPnL !== null ? (
                <>
                  <p className="text-xs font-bold" style={{ color: colors.amount }}>{fmtCompact(s.avgPnL)}</p>
                  <p className="text-xs mt-1 text-slate-500">{s.count}d</p>
                </>
              ) : (
                <p className="text-xs text-slate-600">—</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const steps = [
    { label: 'Large loss',   bg: 'rgba(239,68,68,0.85)' },
    { label: 'Small loss',   bg: 'rgba(239,68,68,0.30)' },
    { label: 'No trades',    bg: 'transparent', border: '1px solid #334155' },
    { label: 'Small gain',   bg: 'rgba(16,185,129,0.30)' },
    { label: 'Large gain',   bg: 'rgba(16,185,129,0.85)' },
  ]
  return (
    <div className="flex items-center gap-1.5">
      {steps.map(s => (
        <div key={s.label} className="flex items-center gap-1 text-xs text-slate-500">
          <div
            className="w-4 h-4 rounded"
            style={{ background: s.bg, border: s.border }}
            title={s.label}
          />
        </div>
      ))}
      <span className="text-xs text-slate-500 ml-1">Less → More</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CalendarHeatmap({ dailyPnL }) {
  const allDates = useMemo(() => Object.keys(dailyPnL).sort(), [dailyPnL])
  if (!allDates.length) return null

  const lastDateParts  = allDates[allDates.length - 1].split('-')
  const firstDateParts = allDates[0].split('-')

  const [viewYear,  setViewYear]  = useState(parseInt(lastDateParts[0]))
  const [viewMonth, setViewMonth] = useState(parseInt(lastDateParts[1]) - 1)
  const [hovered,   setHovered]   = useState(null) // dateKey string

  const maxAbs = useMemo(
    () => Math.max(...Object.values(dailyPnL).map(d => Math.abs(d.pnl)), 1),
    [dailyPnL]
  )

  const dowStats   = useMemo(() => computeDowStats(dailyPnL), [dailyPnL])
  const maxAvgAbs  = Math.max(...dowStats.map(s => Math.abs(s.avgPnL ?? 0)), 1)

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`
  const monthTotal  = Object.entries(dailyPnL)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((s, [, d]) => s + d.pnl, 0)
  const monthDays = Object.keys(dailyPnL).filter(d => d.startsWith(monthPrefix)).length

  const firstYear  = parseInt(firstDateParts[0])
  const now = new Date()
  // Allow back to January of the first data year; forward to the current month
  const canPrev = viewYear > firstYear || (viewYear === firstYear && viewMonth > 0)
  const canNext = viewYear < now.getFullYear() ||
                  (viewYear === now.getFullYear() && viewMonth < now.getMonth())

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setHovered(null)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setHovered(null)
  }

  const weeks = useMemo(() => buildWeeks(viewYear, viewMonth), [viewYear, viewMonth])

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-slate-300 font-semibold">Daily P&L Calendar</h2>
          <p className="text-xs text-slate-500 mt-0.5">Hover a day to see trade details</p>
        </div>
        <div className="flex items-center gap-4">
          <Legend />
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth} disabled={!canPrev}
              className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 disabled:opacity-25 transition-colors"
            >‹</button>
            <span className="text-slate-200 text-sm font-medium w-32 text-center">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth} disabled={!canNext}
              className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 disabled:opacity-25 transition-colors"
            >›</button>
          </div>
          {monthDays > 0 && (
            <div className="text-right">
              <p className={`text-sm font-bold ${monthTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmt(monthTotal)}
              </p>
              <p className="text-xs text-slate-500">{monthDays} active days</p>
            </div>
          )}
        </div>
      </div>

      {/* DOW header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW.map(d => (
          <div key={d} className="text-center text-xs text-slate-500 pb-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((cell, di) => {
              if (!cell) {
                return <div key={di} style={{ height: 72 }} />
              }
              const data   = dailyPnL[cell.key] ?? null
              const colors = cellColors(data?.pnl ?? null, maxAbs)
              return (
                <DayCell
                  key={di}
                  cell={cell}
                  data={data}
                  colors={colors}
                  isHovered={hovered === cell.key}
                  onEnter={() => setHovered(cell.key)}
                  onLeave={() => setHovered(null)}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Detail / DOW summary */}
      {hovered && dailyPnL[hovered] ? (
        <HoverDetail dateKey={hovered} data={dailyPnL[hovered]} />
      ) : (
        <DowSummary dowStats={dowStats} maxAvgAbs={maxAvgAbs} />
      )}
    </div>
  )
}
