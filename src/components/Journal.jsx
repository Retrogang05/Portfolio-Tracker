import { useState } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  { value: 'good',    emoji: '🟢', label: 'Good' },
  { value: 'neutral', emoji: '🟡', label: 'Neutral' },
  { value: 'bad',     emoji: '🔴', label: 'Bad' },
]

export const MOOD_DOT_COLOR = {
  good:    '#34d399',   // emerald
  neutral: '#fbbf24',   // amber
  bad:     '#f87171',   // red
}

const MOOD_ACTIVE = {
  good:    'bg-emerald-900/40 border-emerald-600 text-emerald-300',
  neutral: 'bg-amber-900/40 border-amber-600 text-amber-300',
  bad:     'bg-red-900/40 border-red-600 text-red-300',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function fmtEntryDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Entry form ────────────────────────────────────────────────────────────────

function EntryForm({ entry, onSave, onCancel, portfolioNames }) {
  const [date,      setDate]      = useState(entry?.date      ?? todayStr())
  const [title,     setTitle]     = useState(entry?.title     ?? '')
  const [body,      setBody]      = useState(entry?.body      ?? '')
  const [mood,      setMood]      = useState(entry?.mood      ?? 'neutral')
  const [portfolio, setPortfolio] = useState(entry?.portfolio ?? 'all')
  const [ticker,    setTicker]    = useState(entry?.ticker    ?? '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    const now = new Date().toISOString()
    onSave({
      ...(entry ?? {}),
      date,
      title:     title.trim(),
      body:      body.trim(),
      mood,
      portfolio,
      ticker:    ticker.trim().toUpperCase(),
      updatedAt: now,
      ...(!entry ? { createdAt: now } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 space-y-4">
      <h3 className="font-semibold text-slate-200">{entry ? 'Edit Entry' : 'New Journal Entry'}</h3>

      {/* Row 1: date · mood · portfolio · ticker */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Mood</label>
          <div className="flex gap-1.5">
            {MOOD_OPTIONS.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMood(m.value)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                  mood === m.value
                    ? MOOD_ACTIVE[m.value]
                    : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                }`}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Portfolio</label>
          <select
            value={portfolio}
            onChange={e => setPortfolio(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All portfolios</option>
            {portfolioNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Ticker (optional)</label>
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="SPY"
            maxLength={10}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-violet-500 w-28"
          />
        </div>
      </div>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider">Title *</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What's this entry about?"
          required
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider">Notes</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What happened? What did you learn? What would you do differently?"
          rows={5}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 resize-y focus:outline-none focus:border-violet-500 leading-relaxed"
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-40"
        >
          {entry ? 'Save changes' : 'Add entry'}
        </button>
      </div>
    </form>
  )
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ entry, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const hasLongBody = (entry.body?.length ?? 0) > 200
  const moodOpt = MOOD_OPTIONS.find(m => m.value === entry.mood) ?? MOOD_OPTIONS[1]

  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 hover:border-slate-600/60 transition-colors">
      {/* Meta row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{fmtEntryDate(entry.date)}</span>
          <span title={moodOpt.label}>{moodOpt.emoji}</span>
          {entry.portfolio && entry.portfolio !== 'all' && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-400">{entry.portfolio}</span>
          )}
          {entry.ticker && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 font-mono text-slate-300">{entry.ticker}</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onEdit(entry)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >Edit</button>
          <button
            onClick={() => onDelete(entry.id)}
            className="text-xs text-slate-600 hover:text-red-400 transition-colors"
          >Delete</button>
        </div>
      </div>

      {/* Title */}
      <h3 className="font-semibold text-slate-200 mt-2">{entry.title}</h3>

      {/* Body */}
      {entry.body && (
        <p className={`text-sm text-slate-400 mt-1 whitespace-pre-wrap leading-relaxed ${
          !expanded && hasLongBody ? 'line-clamp-3' : ''
        }`}>
          {entry.body}
        </p>
      )}
      {hasLongBody && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-slate-500 hover:text-slate-300 mt-1.5 transition-colors"
        >
          {expanded ? '↑ Show less' : '↓ Show more'}
        </button>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Journal({ entries, onSave, onDelete, portfolioNames }) {
  const [showForm,        setShowForm]        = useState(false)
  const [editEntry,       setEditEntry]       = useState(null)
  const [search,          setSearch]          = useState('')
  const [filterPortfolio, setFilterPortfolio] = useState('all')
  const [filterMood,      setFilterMood]      = useState('all')

  const filtered = entries
    .filter(e => {
      if (filterMood !== 'all' && e.mood !== filterMood) return false
      if (filterPortfolio !== 'all' && e.portfolio !== filterPortfolio) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !e.title?.toLowerCase().includes(q) &&
          !e.body?.toLowerCase().includes(q)  &&
          !e.ticker?.toLowerCase().includes(q)
        ) return false
      }
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  function handleSave(entry) {
    onSave(entry)
    setShowForm(false)
    setEditEntry(null)
  }

  function handleEdit(entry) {
    setEditEntry(entry)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleDelete(id) {
    if (!confirm('Delete this journal entry? This cannot be undone.')) return
    onDelete(id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">📓 Journal</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            {filtered.length !== entries.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setEditEntry(null); setShowForm(true) }}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
          >
            + New Entry
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <EntryForm
          entry={editEntry}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditEntry(null) }}
          portfolioNames={portfolioNames}
        />
      )}

      {/* Filters — only when there are entries and form is closed */}
      {!showForm && entries.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 w-52"
            placeholder="Search entries…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <select
            value={filterPortfolio}
            onChange={e => setFilterPortfolio(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All portfolios</option>
            {portfolioNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>

          {/* Mood filter pills */}
          <div className="flex items-center gap-1">
            {[
              { value: 'all',     label: 'All' },
              { value: 'good',    label: '🟢' },
              { value: 'neutral', label: '🟡' },
              { value: 'bad',     label: '🔴' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilterMood(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  filterMood === opt.value
                    ? 'bg-slate-600 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(search || filterPortfolio !== 'all' || filterMood !== 'all') && (
            <button
              onClick={() => { setSearch(''); setFilterPortfolio('all'); setFilterMood('all') }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Entry list */}
      {!showForm && (
        filtered.length > 0
          ? (
            <div className="space-y-3">
              {filtered.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )
          : entries.length === 0
            ? (
              <div className="text-center py-24 text-slate-500">
                <p className="text-5xl mb-4">📓</p>
                <p className="font-medium text-slate-400 text-lg">No journal entries yet</p>
                <p className="text-sm mt-2">Click "+ New Entry" to start writing.</p>
                <p className="text-xs text-slate-600 mt-4">
                  Journal entries are saved locally in your browser and included in your backup file.
                </p>
              </div>
            )
            : (
              <div className="text-center py-16 text-slate-500">
                <p className="text-3xl mb-3">🔍</p>
                <p>No entries match your filters.</p>
              </div>
            )
      )}
    </div>
  )
}
