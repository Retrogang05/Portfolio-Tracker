import { useState } from 'react'

// Editor for positions transferred in from another broker.
//
// A transfer moves shares without generating a trade, so the receiving broker's report
// shows sales of stock it never records buying. Entering the original lot here gives
// those shares a cost basis. Stored in localStorage, never in the source tree.

const BLANK = { symbol: '', quantity: '', totalCost: '', date: '', source: '' }

function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(`${s}T00:00:00`)
  if (isNaN(d)) return s
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function CarriedLots({ lots = [], onSave, currency = null }) {
  const [draft, setDraft] = useState(BLANK)
  const [open, setOpen]   = useState(lots.length === 0)

  const valid =
    draft.symbol.trim() &&
    Number(draft.quantity) > 0 &&
    Number(draft.totalCost) > 0 &&
    draft.date

  function add() {
    if (!valid) return
    onSave([...lots, {
      symbol:    draft.symbol.trim().toUpperCase(),
      quantity:  Number(draft.quantity),
      totalCost: Number(draft.totalCost),
      date:      draft.date,
      source:    draft.source.trim(),
    }])
    setDraft(BLANK)
  }

  const field = (name, placeholder, type = 'text', width = 'w-28') => (
    <input
      type={type}
      step="any"
      className={`${width} bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500`}
      placeholder={placeholder}
      value={draft[name]}
      onChange={e => setDraft(d => ({ ...d, [name]: e.target.value }))}
      onKeyDown={e => { if (e.key === 'Enter') add() }}
    />
  )

  return (
    <div className="bg-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-slate-300 font-semibold">Carried-in Positions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Shares transferred from another broker · cost basis entered by hand
          </p>
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          {open ? 'Hide' : `${lots.length} lot${lots.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {lots.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-2 py-2 text-left  text-xs text-slate-400 uppercase tracking-wider">Symbol</th>
                  <th className="px-2 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Qty</th>
                  <th className="px-2 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">
                    Total Cost{currency ? ` (${currency})` : ''}
                  </th>
                  <th className="px-2 py-2 text-right text-xs text-slate-400 uppercase tracking-wider">Per Share</th>
                  <th className="px-2 py-2 text-left  text-xs text-slate-400 uppercase tracking-wider">Acquired</th>
                  <th className="px-2 py-2 text-left  text-xs text-slate-400 uppercase tracking-wider">From</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l, i) => (
                  <tr key={i} className="border-b border-slate-700/40">
                    <td className="px-2 py-2 font-mono font-semibold text-slate-200">{l.symbol}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{Number(l.quantity).toLocaleString()}</td>
                    <td className="px-2 py-2 text-right text-slate-300">${Number(l.totalCost).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-slate-400">
                      ${(Number(l.totalCost) / Number(l.quantity)).toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-slate-400 text-xs">{fmtDate(l.date)}</td>
                    <td className="px-2 py-2 text-slate-500 text-xs">{l.source || '—'}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => onSave(lots.filter((_, j) => j !== i))}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                        title="Remove this lot"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {field('symbol', 'Symbol', 'text', 'w-24')}
            {field('quantity', 'Qty', 'number', 'w-24')}
            {field('totalCost', 'Total cost', 'number', 'w-32')}
            {field('date', '', 'date', 'w-40')}
            {field('source', 'From (e.g. Tastytrade)', 'text', 'w-44')}
            <button
              onClick={add}
              disabled={!valid}
              className="px-3 py-1.5 rounded-lg bg-blue-800/70 hover:bg-blue-700/70 border border-blue-700/60 text-blue-200 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add lot
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Enter the <span className="text-slate-400">total cash cost</span> of the lot including fees, and the date
            it was originally acquired — the date drives the CGT holding period.
            Re-upload the CSV to apply changes.
          </p>
        </div>
      )}
    </div>
  )
}
