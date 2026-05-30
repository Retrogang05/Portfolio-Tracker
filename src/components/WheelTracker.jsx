import { useState } from 'react'
import { fmt } from '../utils/format'

// Compact formatter — no decimals, K/M suffix for large values
function fmtC(n) {
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

// ── Shared atoms ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      status === 'Active' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-700 text-slate-400'
    }`}>{status}</span>
  )
}

function TypeBadge({ type }) {
  const map = {
    PMCC:         'bg-violet-900/60 text-violet-300',
    Wheel:        'bg-blue-900/60 text-blue-300',
    CoveredCall:  'bg-sky-900/60 text-sky-300',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[type] ?? 'bg-slate-700 text-slate-400'}`}>
      {type === 'PMCC' ? 'Poor Man\'s CC' : type === 'CoveredCall' ? 'Covered Call' : 'Wheel'}
    </span>
  )
}

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Leg row (shared for short puts and short calls) ───────────────────────────

function LegRow({ leg, showCallPut }) {
  const isOpen = leg.status === 'Open'
  const isWin  = leg.netPremium > 0

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
      isOpen ? 'bg-slate-700/60 ring-1 ring-violet-500/40' : 'bg-slate-700/30'
    }`}>
      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        isOpen     ? 'bg-violet-400 animate-pulse' :
        leg.closeType === 'Expired' ? 'bg-slate-500' :
        leg.closeType === 'Closed'  ? 'bg-blue-400'  : 'bg-slate-600'
      }`} />

      {showCallPut && (
        <span className={`text-xs px-1.5 rounded shrink-0 ${
          leg.callPut === 'CALL' ? 'bg-blue-900/50 text-blue-300' : 'bg-orange-900/50 text-orange-300'
        }`}>{leg.callPut === 'CALL' ? 'Call' : 'Put'}</span>
      )}

      <span className="text-slate-300 font-mono">${leg.strike}</span>
      <span className="text-slate-500 text-xs">{leg.expiration}</span>

      <div className="flex-1" />

      <span className="text-slate-500 text-xs">{fmtDate(leg.openDate)}</span>
      <span className="text-slate-600 text-xs">→</span>
      <span className="text-slate-500 text-xs w-16 text-right">
        {isOpen ? <span className="text-violet-400">Open</span> : fmtDate(leg.closeDate)}
      </span>

      {leg.closeType && !isOpen && (
        <span className="text-xs text-slate-500 w-14 text-right shrink-0">
          {leg.closeType === 'Expired' ? 'Expired' : 'Closed'}
        </span>
      )}

      <span className={`font-semibold text-sm text-right shrink-0 ${
        isWin ? 'text-emerald-400' : 'text-red-400'
      }`}>{fmtC(leg.netPremium)}</span>
    </div>
  )
}

// ── Assignment event row ──────────────────────────────────────────────────────

function AssignmentRow({ assignment }) {
  const isCall = assignment.callPut === 'CALL'
  const eq = assignment.equity
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-amber-900/20 ring-1 ring-amber-700/40">
      <span className="text-amber-400 text-xs font-medium shrink-0">ASSIGNED</span>
      <span className={`text-xs px-1.5 rounded shrink-0 ${isCall ? 'bg-blue-900/50 text-blue-300' : 'bg-orange-900/50 text-orange-300'}`}>
        {isCall ? 'Call' : 'Put'}
      </span>
      <span className="text-slate-300 font-mono">${assignment.strike}</span>
      <span className="text-slate-500 text-xs">{assignment.expiration}</span>
      <div className="flex-1" />
      {eq && (
        <span className="text-xs text-slate-400">
          {isCall ? 'Stock called away' : 'Stock acquired'} · {eq.quantity} shares @ ${assignment.strike}
        </span>
      )}
      <span className="text-slate-500 text-xs">{fmtDate(assignment.date)}</span>
    </div>
  )
}

// ── PMCC Card ─────────────────────────────────────────────────────────────────

function PMCCCard({ pos }) {
  const { longLeg, shortLegs, premiumCollected, netCost, breakevenPerShare, pctRecovered } = pos
  const openLeg = shortLegs.find(l => l.status === 'Open')

  return (
    <div className="bg-slate-700/40 rounded-xl border border-slate-600/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-700/60">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-slate-100 text-base">{pos.underlying}</span>
          <TypeBadge type="PMCC" />
        </div>
        <StatusBadge status={pos.status} />
      </div>

      <div className="p-4 space-y-4">
        {/* Long leg (LEAPS) */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Long Leg · LEAPS</p>
          <div className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">Call</span>
              <span className="text-slate-200 font-mono">${longLeg.strike}</span>
              <span className="text-slate-500 text-xs">exp {longLeg.expiration}</span>
              <span className="text-slate-600 text-xs">{longLeg.dteAtOpen}d when bought</span>
            </div>
            <div className="text-right">
              <p className="text-red-400 font-semibold text-sm truncate">{fmtC(longLeg.cost)}</p>
              <p className="text-slate-500 text-xs">${longLeg.costPerShare.toFixed(2)}/share</p>
            </div>
          </div>
        </div>

        {/* Short call legs */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Short Calls</p>
          <div className="space-y-1.5">
            {shortLegs.map((leg, i) => <LegRow key={i} leg={leg} />)}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 pt-1">
          <div className="bg-slate-800/60 rounded-lg p-2.5 text-center min-w-0 overflow-hidden">
            <p className="text-xs text-slate-500 mb-1">Collected</p>
            <p className="text-emerald-400 font-bold text-sm truncate">{fmtC(premiumCollected)}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-2.5 text-center min-w-0 overflow-hidden">
            <p className="text-xs text-slate-500 mb-1">Net Cost</p>
            <p className={`font-bold text-sm truncate ${netCost < 0 ? 'text-slate-200' : 'text-emerald-400'}`}>{fmtC(netCost)}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-2.5 text-center min-w-0 overflow-hidden">
            <p className="text-xs text-slate-500 mb-1">Breakeven</p>
            <p className="text-slate-200 font-bold text-sm truncate">${breakevenPerShare.toFixed(2)}</p>
          </div>
        </div>

        {/* Cost recovery progress bar */}
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Cost recovery</span>
            <span>{pctRecovered.toFixed(1)}% of ${Math.abs(longLeg.cost).toFixed(0)} recovered</span>
          </div>
          <div className="bg-slate-700 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-2.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all"
              style={{ width: `${pctRecovered}%` }}
            />
          </div>
        </div>

        {openLeg && (
          <div className="text-xs text-slate-500 bg-violet-900/20 rounded-lg px-3 py-2 border border-violet-700/30">
            Current short: <span className="text-violet-300 font-mono">${openLeg.strike}C</span> exp {openLeg.expiration} · <span className="text-emerald-400">{fmtC(openLeg.netPremium)} collected</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Wheel / Covered Call Card ─────────────────────────────────────────────────

function WheelCard({ pos }) {
  const { callLegs, putLegs, callAssignments, putAssignments, totalPremium } = pos

  // Build a merged timeline: puts, put assignments, calls, call assignments — sorted by date
  const timeline = [
    ...putLegs.map(l => ({ kind: 'put', leg: l, date: l.openDate })),
    ...putAssignments.map(a => ({ kind: 'putAssignment', assignment: a, date: a.date })),
    ...callLegs.map(l => ({ kind: 'call', leg: l, date: l.openDate })),
    ...callAssignments.map(a => ({ kind: 'callAssignment', assignment: a, date: a.date })),
  ].filter(e => e.date).sort((a, b) => a.date - b.date)

  return (
    <div className="bg-slate-700/40 rounded-xl border border-slate-600/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-700/60">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-slate-100 text-base">{pos.underlying}</span>
          <TypeBadge type={pos.type} />
        </div>
        <div className="flex items-center gap-2">
          <PhaseLabel phase={pos.currentPhase} />
          <StatusBadge status={pos.status} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Timeline */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Lifecycle</p>
          <div className="space-y-1.5">
            {timeline.map((entry, i) => {
              if (entry.kind === 'put' || entry.kind === 'call')
                return <LegRow key={i} leg={entry.leg} showCallPut />
              return <AssignmentRow key={i} assignment={entry.assignment} />
            })}
          </div>
        </div>

        {/* Total premium */}
        <div className="flex items-center justify-between bg-slate-800/60 rounded-lg px-4 py-2.5 gap-2 min-w-0">
          <span className="text-slate-400 text-sm truncate">Total premium collected</span>
          <span className={`font-bold shrink-0 ${totalPremium >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtC(totalPremium)}
          </span>
        </div>
      </div>
    </div>
  )
}

function PhaseLabel({ phase }) {
  const map = {
    CoveredCall:        { label: 'Selling Calls',   cls: 'text-blue-300' },
    ShortPut:           { label: 'Selling Puts',    cls: 'text-orange-300' },
    PostCallAssignment: { label: 'Stock Called Away', cls: 'text-amber-300' },
    PostPutAssignment:  { label: 'Stock Assigned',  cls: 'text-amber-300' },
    Idle:               { label: 'Idle',            cls: 'text-slate-500' },
  }
  const m = map[phase] ?? { label: phase, cls: 'text-slate-500' }
  return <span className={`text-xs ${m.cls}`}>{m.label}</span>
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function WheelTracker({ positions }) {
  const [showAll, setShowAll] = useState(false)
  if (!positions?.length) return null

  const active   = positions.filter(p => p.status === 'Active')
  const complete = positions.filter(p => p.status !== 'Active')
  const visible  = showAll ? positions : active.length ? active : positions

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-slate-300 font-semibold">Wheel & PMCC Tracker</h2>
          <p className="text-xs text-slate-500 mt-0.5">Full lifecycle — long leg → short cycles → assignment</p>
        </div>
        {complete.length > 0 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            {showAll ? 'Show active only' : `Show ${complete.length} complete`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {visible.map(pos =>
          pos.type === 'PMCC'
            ? <PMCCCard key={pos.id} pos={pos} />
            : <WheelCard key={pos.id} pos={pos} />
        )}
      </div>
    </div>
  )
}
