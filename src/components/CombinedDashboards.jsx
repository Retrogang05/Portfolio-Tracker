/**
 * CombinedDashboards
 *
 * Shows two side-by-side portfolio group summaries on one page:
 *   • Divya Portfolios  — Divya Tasty (0), Divya SW (2), Divya COMSEC (4)
 *   • SAHR Portfolios   — SAHR IBKR (1), SAHR SW (3)
 *
 * Respects the global filterFY so the page stays in sync with the
 * per-portfolio FY selector already wired in App.jsx.
 */

import { useMemo } from 'react'
import { computeStats, auFY } from '../utils/calculatePnL'
import { computeEquityStats } from '../utils/buildEquityTrades'
import StatCard from './StatCard'
import MonthlyChart from './MonthlyChart'
import { fmt } from '../utils/format'

// ── Group definitions ────────────────────────────────────────────────────────

const GROUPS = [
  { label: 'Divya Portfolios', indices: [0, 2, 4], accent: 'violet' },
  { label: 'SAHR Portfolios',  indices: [1, 3],    accent: 'blue'   },
]

const BROKER_BADGE = {
  tastytrade: 'TT',
  ibkr:       'IB',
  selfwealth: 'SW',
  comsec:     'CS',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return all closed equity positions for one portfolio slot.
 * Selfwealth stores two separate buckets (AUS / US); others use equityData.
 */
function getClosedPositions(p, broker) {
  if (!p) return []
  if (broker === 'selfwealth') {
    return [
      ...(p.equityDataAUS?.closedPositions ?? []),
      ...(p.equityDataUS?.closedPositions  ?? []),
    ]
  }
  return p.equityData?.closedPositions ?? []
}

/** Filter an array to a specific Australian FY ('2026', etc.) or pass through when 'all'. */
function byFY(items, dateKey, fy) {
  if (fy === 'all') return items
  return items.filter(x => x[dateKey] && auFY(x[dateKey]) === fy)
}

// ── Per-group data computation ───────────────────────────────────────────────

function buildGroupData(portfolios, brokers, names, indices, filterFY) {
  // ── Options ────────────────────────────────────────────────────────────────
  const allOptionTrades  = indices.flatMap(i => portfolios[i]?.trades ?? [])
  const filteredTrades   = byFY(allOptionTrades, 'closeDate', filterFY)
  const optionStats      = computeStats(filteredTrades)

  // ── Equity ─────────────────────────────────────────────────────────────────
  const allClosed      = indices.flatMap(i => getClosedPositions(portfolios[i], brokers[i]))
  const filteredClosed = byFY(allClosed, 'sellDate', filterFY)
  const equityStats    = computeEquityStats(filteredClosed)

  // ── Per-account breakdown ──────────────────────────────────────────────────
  const accounts = indices.map(i => {
    const p      = portfolios[i]
    const broker = brokers[i]

    const acctTrades  = byFY(p?.trades ?? [], 'closeDate', filterFY)
    const acctClosed  = byFY(getClosedPositions(p, broker), 'sellDate', filterFY)
    const acctOptStat = computeStats(acctTrades)
    const acctEqStat  = computeEquityStats(acctClosed)

    const optPnL   = acctOptStat?.totalPnL ?? 0
    const eqPnL    = acctEqStat?.totalPnL  ?? 0
    const loaded   = !!p?.fileName

    return {
      name:     names[i],
      broker,
      loaded,
      optPnL,
      eqPnL,
      totalPnL: optPnL + eqPnL,
      hasOptData: !!acctOptStat,
      hasEqData:  !!acctEqStat,
    }
  })

  // ── Combined monthly P&L (options + equity, merged by calendar month) ──────
  const monthlyMap = {}
  for (const m of (optionStats?.byMonth ?? [])) {
    monthlyMap[m.month] = (monthlyMap[m.month] ?? 0) + m.pnl
  }
  for (const pos of filteredClosed) {
    if (!pos.sellDate) continue
    const key = pos.sellDate.toISOString().slice(0, 7)
    monthlyMap[key] = (monthlyMap[key] ?? 0) + pos.pnl
  }
  const monthlyData = Object.entries(monthlyMap)
    .map(([month, pnl]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const optPnL   = optionStats?.totalPnL ?? 0
  const eqPnL    = equityStats?.totalPnL ?? 0
  const totalPnL = optPnL + eqPnL

  return { optionStats, equityStats, optPnL, eqPnL, totalPnL, accounts, monthlyData }
}

// ── GroupCard ────────────────────────────────────────────────────────────────

const ACCENT = {
  violet: {
    heading:   'text-violet-400',
    badge:     'bg-violet-900/40 text-violet-300 border-violet-700/50',
    activeFY:  'bg-violet-600 text-white',
  },
  blue: {
    heading:   'text-blue-400',
    badge:     'bg-blue-900/40 text-blue-300 border-blue-700/50',
    activeFY:  'bg-blue-600 text-white',
  },
}

function GroupCard({ group, portfolios, brokers, names, filterFY }) {
  const data = useMemo(
    () => buildGroupData(portfolios, brokers, names, group.indices, filterFY),
    [portfolios, brokers, names, group.indices, filterFY],
  )

  const ac = ACCENT[group.accent] ?? ACCENT.violet
  const anyLoaded = data.accounts.some(a => a.loaded)

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!anyLoaded) {
    return (
      <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl flex flex-col items-center justify-center min-h-64 gap-3 p-8">
        <span className="text-4xl">📭</span>
        <p className={`font-semibold text-lg ${ac.heading}`}>{group.label}</p>
        <p className="text-slate-500 text-sm text-center">
          Upload CSV files for these portfolios to see a combined summary.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden flex flex-col">

      {/* ── Card header ──────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between gap-4">
        <h2 className={`font-bold text-lg ${ac.heading}`}>{group.label}</h2>
        <span className={`text-xl font-bold tabular-nums ${data.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(data.totalPnL)}
        </span>
      </div>

      <div className="p-6 space-y-6 flex-1">

        {/* ── Stat tiles ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total P&L"   value={fmt(data.totalPnL)}                                        positive={data.totalPnL >= 0} />
          <StatCard
            label="Win Rate"
            value={data.optionStats ? `${data.optionStats.winRate.toFixed(1)}%` : '—'}
            sub={data.optionStats ? `${data.optionStats.wins}W / ${data.optionStats.losses}L · options` : 'no options data'}
            positive={data.optionStats ? data.optionStats.winRate >= 50 : undefined}
          />
          <StatCard label="Options P&L" value={data.optionStats ? fmt(data.optPnL) : '—'}               positive={data.optPnL >= 0} />
          <StatCard label="Equity P&L"  value={data.equityStats ? fmt(data.eqPnL)  : '—'}               positive={data.eqPnL  >= 0} />
        </div>

        {/* ── Account breakdown table ───────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
            Account Breakdown
          </p>
          <div className="rounded-xl overflow-hidden border border-slate-700/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/70 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-medium">Account</th>
                  <th className="text-right px-4 py-2.5 font-medium">Options</th>
                  <th className="text-right px-4 py-2.5 font-medium">Equity</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-700/40">
                {data.accounts.map((acct, i) => (
                  <tr key={i} className="hover:bg-slate-700/20 transition-colors">

                    {/* Name + broker badge */}
                    <td className="px-4 py-3">
                      <span className="text-slate-200 font-medium">{acct.name}</span>
                      <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-700 text-slate-400 align-middle">
                        {BROKER_BADGE[acct.broker] ?? acct.broker.slice(0, 2).toUpperCase()}
                      </span>
                      {!acct.loaded && (
                        <span className="ml-1.5 text-xs text-slate-600 italic">not loaded</span>
                      )}
                    </td>

                    {/* Options P&L */}
                    <td className={`px-4 py-3 text-right tabular-nums ${
                      !acct.hasOptData ? 'text-slate-600'
                      : acct.optPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {acct.hasOptData ? fmt(acct.optPnL) : '—'}
                    </td>

                    {/* Equity P&L */}
                    <td className={`px-4 py-3 text-right tabular-nums ${
                      !acct.hasEqData ? 'text-slate-600'
                      : acct.eqPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {acct.hasEqData ? fmt(acct.eqPnL) : '—'}
                    </td>

                    {/* Total */}
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                      !acct.loaded ? 'text-slate-600'
                      : acct.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {acct.loaded ? fmt(acct.totalPnL) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals row */}
              <tfoot>
                <tr className="bg-slate-800/70 border-t border-slate-700/60 text-xs font-semibold uppercase tracking-wide">
                  <td className="px-4 py-2.5 text-slate-400">Total</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${
                    data.optionStats ? (data.optPnL >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-600'
                  }`}>
                    {data.optionStats ? fmt(data.optPnL) : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${
                    data.equityStats ? (data.eqPnL >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-600'
                  }`}>
                    {data.equityStats ? fmt(data.eqPnL) : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums text-sm ${
                    data.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {fmt(data.totalPnL)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ── Combined monthly chart ────────────────────────────────────────── */}
        {data.monthlyData.length > 1 && (
          <MonthlyChart data={data.monthlyData} title="Combined P&L by Month" />
        )}

      </div>
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function CombinedDashboards({ portfolios, portfolioBrokers, portfolioNames, filterFY, setFilterFY }) {

  // Collect every FY across ALL portfolios for the selector
  const allFYs = useMemo(() => {
    const fys = new Set()
    portfolios.forEach((p, i) => {
      const broker = portfolioBrokers[i]
      for (const t of (p.trades ?? [])) {
        if (t.closeDate) fys.add(auFY(t.closeDate))
      }
      for (const pos of getClosedPositions(p, broker)) {
        if (pos.sellDate) fys.add(auFY(pos.sellDate))
      }
    })
    return Array.from(fys).sort()
  }, [portfolios, portfolioBrokers])

  return (
    <div className="space-y-6">

      {/* ── Page header + FY selector ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Combined Overview</h1>

        {allFYs.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">Financial year:</span>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setFilterFY('all')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterFY === 'all'
                    ? 'bg-slate-600 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                All time
              </button>
              {allFYs.map(fy => (
                <button
                  key={fy}
                  onClick={() => setFilterFY(fy)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filterFY === fy
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  FY{fy}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Two group cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {GROUPS.map(group => (
          <GroupCard
            key={group.label}
            group={group}
            portfolios={portfolios}
            brokers={portfolioBrokers}
            names={portfolioNames}
            filterFY={filterFY}
          />
        ))}
      </div>

    </div>
  )
}
