import { useState, useRef, useEffect } from 'react'
import { fmt } from '../utils/format'

export const CATEGORIES = [
  'Capital Introduced',
  'Dividend Income',
  'Tax Withheld',
  'Interest Received',
  'Interest Paid',
  'Fees Paid',
  'Withdrawal',
  'Other',
]

export const CATEGORY_STYLES = {
  'Capital Introduced': 'bg-emerald-900/50 text-emerald-300',
  'Dividend Income':    'bg-teal-900/50 text-teal-300',
  'Tax Withheld':       'bg-purple-900/50 text-purple-300',
  'Interest Received':  'bg-blue-900/50 text-blue-300',
  'Interest Paid':      'bg-red-900/50 text-red-300',
  'Fees Paid':          'bg-orange-900/50 text-orange-300',
  'Withdrawal':         'bg-amber-900/50 text-amber-300',
  'Other':              'bg-slate-700 text-slate-400',
}

// Stable row id: timestamp + amount + description
export function capitalRowId(row) {
  return `${row.timestampSec}|${row.amount}|${row.description}`
}

// Auto-detect from Tastytrade description/subType — user can override
function autoCategory(row) {
  const text = `${row.description} ${row.subType}`.toLowerCase()
  // Dividends — "dividend", "cashdiv", "cash div"
  if (text.includes('dividend') || text.includes('cashdiv') || text.includes('cash div')) return 'Dividend Income'
  // Interest — positive = credit, negative = debit
  if (text.includes('interest') || text.includes('balance interest') || text.includes('credit interest')) {
    return row.amount >= 0 ? 'Interest Received' : 'Interest Paid'
  }
  // Tax withheld on dividends
  if (text.includes('withholding') || text.includes('tax withheld') || text.includes('dividend tax') || text.includes('foreign tax')) {
    return 'Tax Withheld'
  }
  // Fees: regulatory, exchange, clearing, etc.
  if (text.includes('fee') || text.includes('regulatory') || text.includes('exchange fee') || text.includes('clearing')) {
    return 'Fees Paid'
  }
  // Positive = deposit, negative = withdrawal
  return row.amount >= 0 ? 'Capital Introduced' : 'Withdrawal'
}

export function effectiveCategory(row, tags) {
  return tags[capitalRowId(row)] ?? autoCategory(row)
}

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

// Compact tile formatter — no decimals, K/M suffix for large values
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

// Clickable badge → dropdown, same pattern as StrategyCell
function CategoryCell({ category, onSelect }) {
  const [open, setOpen] = useState(false)
  const selectRef = useRef()

  useEffect(() => { if (open) selectRef.current?.focus() }, [open])

  if (open) {
    return (
      <select
        ref={selectRef}
        value={category}
        onChange={e => { onSelect(e.target.value); setOpen(false) }}
        onBlur={() => setOpen(false)}
        onClick={e => e.stopPropagation()}
        className="bg-slate-700 border border-emerald-500 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none"
      >
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    )
  }

  const cls = CATEGORY_STYLES[category] ?? CATEGORY_STYLES['Other']
  return (
    <button
      onClick={e => { e.stopPropagation(); setOpen(true) }}
      title="Click to change category"
      className="group flex items-center gap-1 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
    >
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cls}`}>
        {category}
      </span>
      <span className="opacity-0 group-hover:opacity-60 text-slate-500 text-xs transition-opacity">✎</span>
    </button>
  )
}

const PAGE = 15

export default function CapitalMovements({ movements, tags, onTagChange }) {
  const [page, setPage] = useState(0)

  if (!movements.length) return null

  // Summary totals using effective categories
  let capitalIn = 0, capitalOut = 0, dividends = 0, intPaid = 0, intReceived = 0, feesPaid = 0
  for (const m of movements) {
    const cat = effectiveCategory(m, tags)
    if (cat === 'Capital Introduced')   capitalIn    += m.amount
    else if (cat === 'Withdrawal')      capitalOut   += m.amount
    else if (cat === 'Dividend Income') dividends    += m.amount
    else if (cat === 'Interest Paid')   intPaid      += m.amount
    else if (cat === 'Interest Received') intReceived += m.amount
    else if (cat === 'Fees Paid')       feesPaid     += m.amount
  }

  const overriddenCount = movements.filter(m => tags[capitalRowId(m)] !== undefined).length
  const pages   = Math.ceil(movements.length / PAGE)
  const visible = movements.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-slate-300 font-semibold">Capital Movements</h2>
          <p className="text-xs text-slate-500 mt-0.5">Deposits, withdrawals and fees · click a category to edit</p>
        </div>
        {overriddenCount > 0 && (
          <span className="text-xs text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded-full">
            {overriddenCount} overridden
          </span>
        )}
      </div>

      {/* Summary tiles */}
      {(() => {
        const currentCapital = capitalIn + capitalOut  // introduced − withdrawals
        const tiles = [
          { label: 'Capital Introduced', value: capitalIn,      color: 'text-emerald-400', sub: `Current ${fmtTile(currentCapital)}` },
          { label: 'Withdrawals',        value: capitalOut,     color: 'text-amber-400' },
          { label: 'Dividend Income',    value: dividends,      color: 'text-teal-400' },
          { label: 'Interest Received',  value: intReceived,    color: 'text-blue-400' },
          { label: 'Interest Paid',      value: intPaid,        color: 'text-red-400' },
          { label: 'Fees Paid',          value: feesPaid,       color: 'text-orange-400' },
        ]
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
            {tiles.map(({ label, value, color, sub }) => (
              <div key={label} className="bg-slate-700/50 rounded-xl p-3 min-w-0 overflow-hidden">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1 leading-tight truncate">{label}</p>
                <p className={`text-base font-bold leading-tight truncate ${color}`}>{fmtTile(value)}</p>
                {sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Date</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Description</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-3 py-2 text-left text-xs text-slate-400 uppercase tracking-wider">Category</th>
              <th className="px-3 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m, i) => {
              const rowId = capitalRowId(m)
              const cat   = effectiveCategory(m, tags)
              const isOverridden = tags[rowId] !== undefined
              return (
                <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                  <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td className="px-3 py-2 text-slate-300 max-w-xs truncate">
                    {m.description || '—'}
                    {isOverridden && <span className="ml-1 text-emerald-400 text-xs" title="Manually overridden">✎</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{m.subType || '—'}</td>
                  <td className="px-3 py-2">
                    <CategoryCell
                      category={cat}
                      onSelect={newCat => onTagChange(rowId, newCat)}
                    />
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold text-sm ${m.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmt(m.amount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500 text-xs">{movements.length} movements</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 transition-colors"
            >Prev</button>
            <span className="px-2 py-1 text-slate-400 text-xs">{page + 1} / {pages}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= pages - 1}
              className="px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 transition-colors"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
