/**
 * DividendReport
 *
 * Shows dividend income split into two group cards side-by-side:
 *   • Divya Portfolios  — indices 0, 2, 4
 *   • SAHR Portfolios   — indices 1, 3
 *
 * Below the cards, a full "All Payments" transaction table.
 *
 * Currency inference:
 *   Rows with an explicit `currency` field (Selfwealth, CommSec) use it.
 *   Tastytrade / IBKR rows default to USD.
 */

import { useMemo } from 'react'
import { auFY } from '../utils/calculatePnL'
import StatCard from './StatCard'
import MonthlyChart from './MonthlyChart'
import { fmt } from '../utils/format'

// ── Constants ─────────────────────────────────────────────────────────────────

const GROUPS = [
  { label: 'Divya Portfolios', indices: [0, 2, 4], accent: 'violet' },
  { label: 'SAHR Portfolios',  indices: [1, 3],    accent: 'blue'   },
]

const ACCENT = {
  violet: { heading: 'text-violet-400', fyActive: 'bg-violet-600 text-white' },
  blue:   { heading: 'text-blue-400',   fyActive: 'bg-blue-600 text-white'   },
}

const BROKER_BADGE = { tastytrade: 'TT', ibkr: 'IB', selfwealth: 'SW', comsec: 'CS' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferCurrency(row) {
  return row.currency ?? 'USD'   // Tasty / IBKR have no explicit field → USD
}

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function buildMonthly(divs) {
  const map = {}
  for (const d of divs) {
    if (!d.date) continue
    const key = d.date.toISOString().slice(0, 7)
    map[key] = (map[key] ?? 0) + d.amount
  }
  return Object.entries(map)
    .map(([month, pnl]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// ── Per-group data ────────────────────────────────────────────────────────────

function buildGroupData(allDividends, group, portfolioNames, portfolioBrokers) {
  const divs    = allDividends.filter(d => group.indices.includes(d._idx))
  const audDivs = divs.filter(d => d.currency === 'AUD')
  const usdDivs = divs.filter(d => d.currency === 'USD')
  const audTotal = audDivs.reduce((s, d) => s + d.amount, 0)
  const usdTotal = usdDivs.reduce((s, d) => s + d.amount, 0)

  // Top payer
  const symMap = {}
  for (const d of divs) {
    const sym = d.symbol || d.underlying || '?'
    if (!symMap[sym]) symMap[sym] = { symbol: sym, aud: 0, usd: 0 }
    if (d.currency === 'AUD') symMap[sym].aud += d.amount
    else                       symMap[sym].usd += d.amount
  }
  const topPayer = Object.values(symMap).sort((a, b) => (b.aud + b.usd) - (a.aud + a.usd))[0] ?? null

  // Per-account breakdown (only the accounts in this group)
  const accounts = group.indices.map(i => {
    const pfDivs = divs.filter(d => d._idx === i)
    const aud = pfDivs.filter(d => d.currency === 'AUD').reduce((s, d) => s + d.amount, 0)
    const usd = pfDivs.filter(d => d.currency === 'USD').reduce((s, d) => s + d.amount, 0)
    return {
      name:    portfolioNames[i],
      broker:  portfolioBrokers[i],
      aud, usd,
      count:   pfDivs.length,
      hasAUD:  pfDivs.some(d => d.currency === 'AUD'),
      hasUSD:  pfDivs.some(d => d.currency === 'USD'),
    }
  })

  // By symbol (sorted by total)
  const bySymbol = Object.values(symMap)
    .map(s => ({
      ...s,
      count:    divs.filter(d => (d.symbol || d.underlying || '?') === s.symbol).length,
      lastDate: divs
        .filter(d => (d.symbol || d.underlying || '?') === s.symbol)
        .reduce((latest, d) => (!latest || d.date > latest ? d.date : latest), null),
    }))
    .sort((a, b) => (b.aud + b.usd) - (a.aud + a.usd))

  // Monthly
  const audMonthly = buildMonthly(audDivs)
  const usdMonthly = buildMonthly(usdDivs)

  return { divs, audTotal, usdTotal, topPayer, accounts, bySymbol, audMonthly, usdMonthly }
}

// ── GroupDividendCard ─────────────────────────────────────────────────────────

function GroupDividendCard({ group, allDividends, portfolioNames, portfolioBrokers }) {
  const data = useMemo(
    () => buildGroupData(allDividends, group, portfolioNames, portfolioBrokers),
    [allDividends, group, portfolioNames, portfolioBrokers],
  )

  const ac      = ACCENT[group.accent] ?? ACCENT.violet
  const total   = data.audTotal + data.usdTotal
  const isEmpty = data.divs.length === 0

  return (
    <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden flex flex-col">

      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between gap-4">
        <h2 className={`font-bold text-lg ${ac.heading}`}>{group.label}</h2>
        {!isEmpty && (
          <div className="text-right">
            {data.audTotal > 0 && (
              <span className="text-emerald-400 font-bold tabular-nums">
                {fmt(data.audTotal)} <span className="text-xs font-normal text-slate-500">AUD</span>
              </span>
            )}
            {data.audTotal > 0 && data.usdTotal > 0 && (
              <span className="text-slate-600 mx-2">·</span>
            )}
            {data.usdTotal > 0 && (
              <span className="text-emerald-400 font-bold tabular-nums">
                {fmt(data.usdTotal)} <span className="text-xs font-normal text-slate-500">USD</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-6 space-y-6 flex-1">

        {/* Empty state */}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-600">
            <span className="text-3xl">💰</span>
            <p className="text-sm">No dividend income for this group</p>
          </div>
        ) : (
          <>
            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="AUD Income"
                value={data.audTotal > 0 ? fmt(data.audTotal) : '—'}
                positive={data.audTotal > 0}
              />
              <StatCard
                label="USD Income"
                value={data.usdTotal > 0 ? fmt(data.usdTotal) : '—'}
                positive={data.usdTotal > 0}
              />
              <StatCard
                label="Payments"
                value={data.divs.length}
              />
              <StatCard
                label="Top Payer"
                value={data.topPayer?.symbol ?? '—'}
                sub={data.topPayer
                  ? (data.topPayer.aud > 0
                      ? `${fmt(data.topPayer.aud)} AUD`
                      : `${fmt(data.topPayer.usd)} USD`)
                  : undefined}
                positive={!!data.topPayer}
              />
            </div>

            {/* By portfolio */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                By Account
              </p>
              <div className="rounded-xl overflow-hidden border border-slate-700/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800/70 text-xs text-slate-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-2 font-medium">Account</th>
                      <th className="text-right px-4 py-2 font-medium">AUD</th>
                      <th className="text-right px-4 py-2 font-medium">USD</th>
                      <th className="text-right px-4 py-2 font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/40">
                    {data.accounts.map((acct, i) => (
                      <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="text-slate-200 font-medium">{acct.name}</span>
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-700 text-slate-400 align-middle">
                            {BROKER_BADGE[acct.broker] ?? '??'}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${acct.hasAUD ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {acct.hasAUD ? fmt(acct.aud) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${acct.hasUSD ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {acct.hasUSD ? fmt(acct.usd) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${acct.count > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                          {acct.count > 0 ? acct.count : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800/70 border-t border-slate-700/60 text-xs font-semibold">
                      <td className="px-4 py-2 text-slate-400 uppercase tracking-wide">Total</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${data.audTotal > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {data.audTotal > 0 ? fmt(data.audTotal) : '—'}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${data.usdTotal > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {data.usdTotal > 0 ? fmt(data.usdTotal) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-300">
                        {data.divs.length}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* By symbol */}
            {data.bySymbol.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  By Stock
                </p>
                <div className="rounded-xl overflow-hidden border border-slate-700/50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-800/70 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left px-4 py-2 font-medium">Symbol</th>
                        <th className="text-right px-4 py-2 font-medium">AUD</th>
                        <th className="text-right px-4 py-2 font-medium">USD</th>
                        <th className="text-right px-4 py-2 font-medium">Count</th>
                        <th className="text-right px-4 py-2 font-medium">Last</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/40">
                      {data.bySymbol.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-2.5 font-mono font-semibold text-slate-200">
                            {row.symbol}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${row.aud > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {row.aud > 0 ? fmt(row.aud) : '—'}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${row.usd > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {row.usd > 0 ? fmt(row.usd) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                            {row.count}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-500 text-xs whitespace-nowrap">
                            {fmtDate(row.lastDate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Monthly charts */}
            {(data.audMonthly.length > 0 || data.usdMonthly.length > 0) && (
              <div className={`grid gap-4 ${data.audMonthly.length > 0 && data.usdMonthly.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                {data.audMonthly.length > 0 && (
                  <MonthlyChart data={data.audMonthly} title="AUD Dividends by Month" />
                )}
                {data.usdMonthly.length > 0 && (
                  <MonthlyChart data={data.usdMonthly} title="USD Dividends by Month" />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function DividendReport({
  portfolios,
  portfolioBrokers,
  portfolioNames,
  filterFY,
  setFilterFY,
}) {
  // Collect & tag every dividend row with its portfolio index.
  // For each dividend, also match any Foreign Tax Withholding entry in the same
  // portfolio with the same symbol within a 3-day window (IBKR pattern).
  const allDividends = useMemo(() => {
    return portfolios.flatMap((p, i) => {
      const withheld = (p.moneyMovements ?? []).filter(
        m => m.subType === 'Foreign Tax Withholding'
      )
      return (p.moneyMovements ?? [])
        .filter(m => m.subType === 'Dividend' && m.amount > 0)
        .map(m => {
          const matches = withheld.filter(
            w => w.symbol === m.symbol &&
                 Math.abs(w.date - m.date) <= 3 * 86400000
          )
          const taxWithheld = matches.length > 0
            ? parseFloat(Math.abs(matches.reduce((s, w) => s + w.amount, 0)).toFixed(2))
            : null   // null = not applicable / not found

          return {
            ...m,
            _idx:        i,
            portfolio:   portfolioNames[i],
            broker:      portfolioBrokers[i],
            currency:    inferCurrency(m),
            taxWithheld, // positive number (the $ cost) or null
          }
        })
    }).sort((a, b) => b.date - a.date)
  }, [portfolios, portfolioBrokers, portfolioNames])

  // Available FYs across everything
  const availableFYs = useMemo(() => {
    const fys = new Set(allDividends.map(d => d.date && auFY(d.date)).filter(Boolean))
    return Array.from(fys).sort()
  }, [allDividends])

  // Apply FY filter
  const dividends = useMemo(() => {
    if (filterFY === 'all') return allDividends
    return allDividends.filter(d => d.date && auFY(d.date) === filterFY)
  }, [allDividends, filterFY])

  const anyLoaded = portfolios.some(p => p.fileName)

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!anyLoaded || allDividends.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-100">Dividend Income</h1>
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl flex flex-col items-center justify-center min-h-64 gap-3 p-8">
          <span className="text-4xl">💰</span>
          <p className="font-semibold text-slate-300 text-lg">No dividend income found</p>
          <p className="text-slate-500 text-sm text-center max-w-md">
            {anyLoaded
              ? 'No dividend payments were detected. Dividends are recognised from Selfwealth (cash report), CommSec, IBKR, and Tastytrade exports.'
              : 'Upload portfolio CSV files to see your dividend income history.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* ── Page header + FY selector ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dividend Income</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {dividends.length} payment{dividends.length !== 1 ? 's' : ''}
            {filterFY !== 'all' ? ` in FY${filterFY}` : ' across all years'}
          </p>
        </div>

        {availableFYs.length > 1 && (
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
              {availableFYs.map(fy => (
                <button
                  key={fy}
                  onClick={() => setFilterFY(fy)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filterFY === fy
                      ? 'bg-emerald-600 text-white'
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
          <GroupDividendCard
            key={group.label}
            group={group}
            allDividends={dividends}
            portfolioNames={portfolioNames}
            portfolioBrokers={portfolioBrokers}
          />
        ))}
      </div>

      {/* ── Full transaction list (all portfolios, newest first) ─────────────── */}
      {dividends.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
            All Payments
          </p>
          <div className="rounded-xl overflow-hidden border border-slate-700/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/70 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-medium">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium">Portfolio</th>
                  <th className="text-left px-4 py-2.5 font-medium">Symbol</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Description</th>
                  <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                  <th className="text-right px-4 py-2.5 font-medium" title="Foreign tax withheld (IBKR/Tasty) or franking credit (AUS — not in CSV)">Tax / FC</th>
                  <th className="text-right px-4 py-2.5 font-medium">Ccy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {dividends.map((d, i) => (
                  <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">
                      {fmtDate(d.date)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                      {d.portfolio}
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[10px] font-semibold bg-slate-700 text-slate-500 align-middle">
                        {BROKER_BADGE[d.broker] ?? '??'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-200">
                      {d.symbol || d.underlying || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs max-w-56 truncate hidden md:table-cell">
                      {d.description || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-medium">
                      {fmt(d.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {d.taxWithheld != null ? (
                        <span className="text-amber-400 font-medium">
                          -{fmt(d.taxWithheld)}
                        </span>
                      ) : d.currency === 'AUD' ? (
                        <span className="text-slate-600 text-xs" title="Franking credits are not captured in CSV exports">
                          FC N/A
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        d.currency === 'AUD'
                          ? 'bg-emerald-900/40 text-emerald-400'
                          : 'bg-blue-900/40 text-blue-400'
                      }`}>
                        {d.currency}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tax / FC footnotes */}
          <div className="mt-3 pl-1 space-y-1">
            <p className="text-xs text-slate-600">
              <span className="text-amber-500">Tax / FC</span> column:
              foreign withholding tax is sourced directly from IBKR / Tastytrade exports and shown in amber.
            </p>
            <p className="text-xs text-slate-600">
              <span className="text-slate-500">FC N/A</span> indicates an AUD dividend where franking credit data is not available in the CSV export — check your dividend statements or ATO pre-fill for franking credit amounts.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
