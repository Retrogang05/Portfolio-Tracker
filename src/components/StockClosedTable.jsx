import { useState, useEffect, useCallback } from 'react'
import { fmt } from '../utils/format'

function fmtDate(d) {
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtPrice(n) {
  if (n == null) return '—'
  return `$${Math.abs(n).toFixed(2)}`
}

function fmtFee(n) {
  if (!n || Math.abs(n) < 0.001) return '—'
  return `-$${Math.abs(n).toFixed(2)}`
}

const PAGE = 25

function stockNoteKey(portfolioIdx, pos) {
  const buy  = pos.buyDate?.toISOString().slice(0, 10)  ?? '?'
  const sell = pos.sellDate?.toISOString().slice(0, 10) ?? '?'
  return `portfolio-tracker:note:stk:${portfolioIdx}:${pos.symbol}-${buy}-${sell}-${pos.quantity}`
}

function NoteRow({ colSpan, noteKey, initialValue, onSaved }) {
  const [text, setText] = useState(initialValue ?? '')

  function handleBlur() {
    const val = text.trim()
    if (val) localStorage.setItem(noteKey, val)
    else localStorage.removeItem(noteKey)
    onSaved(noteKey, val)
  }

  return (
    <tr className="border-b border-slate-700/30">
      <td colSpan={colSpan} className="px-4 py-2 bg-amber-900/10">
        <textarea
          autoFocus
          rows={2}
          className="w-full bg-transparent text-sm text-slate-300 placeholder-slate-600 resize-none focus:outline-none leading-relaxed"
          placeholder="Add a note for this position… (saved automatically when you click away)"
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={handleBlur}
        />
      </td>
    </tr>
  )
}

export default function StockClosedTable({ closedPositions = [], totalRealizedPnL = 0, portfolioIdx = 0 }) {
  const [page, setPage]         = useState(0)
  const [sortKey, setSortKey]   = useState('sellDate')
  const [sortDir, setSortDir]   = useState(-1)
  const [filter, setFilter]     = useState('')
  const [notes, setNotes]       = useState({})
  const [noteOpenKey, setNoteOpenKey] = useState(null)

  useEffect(() => {
    const prefix = `portfolio-tracker:note:stk:${portfolioIdx}:`
    const result = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) result[key] = localStorage.getItem(key)
    }
    setNotes(result)
  }, [portfolioIdx])

  const handleNoteUpdate = useCallback((key, val) => {
    setNotes(prev => {
      if (val) return { ...prev, [key]: val }
      const next = { ...prev }
      delete next[key]
      return next
    })
    setNoteOpenKey(null)
  }, [])

  if (!closedPositions.length) return null

  const filteredPositions = filter.trim()
    ? closedPositions.filter(p => p.symbol.toLowerCase().includes(filter.toLowerCase()))
    : closedPositions

  const sorted = [...filteredPositions].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey]
    if (va < vb) return -sortDir
    if (va > vb) return sortDir
    return 0
  })

  const pages   = Math.ceil(sorted.length / PAGE)
  const visible = sorted.slice(page * PAGE, (page + 1) * PAGE)

  const totalFees     = filteredPositions.reduce((s, p) => s + (p.totalFees ?? 0), 0)
  const totalProceeds = filteredPositions.reduce((s, p) => s + (p.saleProceeds ?? 0), 0)
  const totalCost     = filteredPositions.reduce((s, p) => s + (p.costBasis ?? 0), 0)
  const filteredPnL   = filteredPositions.reduce((s, p) => s + (p.pnl ?? 0), 0)

  function col(key, label, align = 'left') {
    const active = sortKey === key
    return (
      <th
        className={`px-3 py-2 text-xs text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none whitespace-nowrap text-${align}`}
        onClick={() => { setSortKey(key); setSortDir(sortKey === key ? -sortDir : -1); setPage(0) }}
      >
        {label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-slate-300 font-semibold">Closed Positions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {filter ? `${filteredPositions.length} of ${closedPositions.length}` : closedPositions.length} trades · P&amp;L shown after brokerage fees
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-44"
            placeholder="Filter by ticker…"
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(0) }}
          />
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-xs text-slate-500">Total Cost Basis</p>
            <p className="text-slate-300 font-semibold">{fmt(totalCost)}</p>
            <p className="text-xs text-slate-600">excl. fees</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total Proceeds</p>
            <p className="text-slate-300 font-semibold">{fmt(totalProceeds)}</p>
            <p className="text-xs text-slate-600">excl. fees</p>
          </div>
          {totalFees > 0.01 && (
            <div>
              <p className="text-xs text-slate-500">Total Fees</p>
              <p className="text-orange-400 font-semibold">-{fmt(totalFees)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500">Net P&amp;L</p>
            <p className={`font-bold text-lg ${filteredPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(filteredPnL)}
            </p>
            {filter && filteredPositions.length !== closedPositions.length && (
              <p className="text-xs text-slate-600">filtered</p>
            )}
          </div>
        </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              {col('symbol',      'Symbol')}
              {col('quantity',    'Qty',       'right')}
              {col('buyDate',     'Bought',    'left')}
              {col('sellDate',    'Sold',      'left')}
              {col('daysHeld',    'Days',      'right')}
              {col('buyPrice',    'Buy $',     'right')}
              {col('costBasis',   'Cost Basis (gross)', 'right')}
              {col('sellPrice',   'Sell $',            'right')}
              {col('saleProceeds','Proceeds (gross)',   'right')}
              {col('totalFees',   'Fees',      'right')}
              {col('pnl',         'Net P&L',   'right')}
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const nKey = stockNoteKey(portfolioIdx, t)
              const note = notes[nKey] ?? ''
              return (
                <>
                  <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-200">{t.symbol}</span>
                        {t.isDayTrade && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-900/50 text-yellow-300">Day</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{t.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(t.buyDate)}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(t.sellDate)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{t.daysHeld}d</td>
                    <td className="px-3 py-2.5 text-right text-slate-300 text-xs">{fmtPrice(t.buyPrice)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300 text-xs font-medium">{fmtPrice(t.costBasis)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300 text-xs">{fmtPrice(t.sellPrice)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300 text-xs font-medium">{fmtPrice(t.saleProceeds)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-orange-400">{fmtFee(t.totalFees)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`font-bold text-sm ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmt(t.pnl)}
                        </span>
                        <button
                          onClick={() => setNoteOpenKey(noteOpenKey === nKey ? null : nKey)}
                          title={note ? 'View / edit note' : 'Add note'}
                          className={`text-xs transition-colors ${note ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-slate-400'}`}
                        >📝</button>
                      </div>
                    </td>
                  </tr>
                  {noteOpenKey === nKey && (
                    <NoteRow
                      key={`note-${i}`}
                      colSpan={11}
                      noteKey={nKey}
                      initialValue={note}
                      onSaved={handleNoteUpdate}
                    />
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500 text-xs">{filteredPositions.length} trades</span>
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
