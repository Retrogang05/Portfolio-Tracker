import { useRef, useState } from 'react'

const BROKER_CONFIG = {
  tastytrade: {
    title: 'Add Tastytrade Transactions',
    hint:  'Export from Tastytrade → History → Transactions → Download CSV',
    multi: false,
  },
  ibkr: {
    title: 'Add IBKR Transactions',
    hint:  'Export from IBKR → Reports → Activity → Transaction History (1Y) → Download',
    multi: false,
  },
  selfwealth: {
    title: 'Add Selfwealth Transactions',
    hint:  'Selfwealth → Portfolio → Transactions → Export CSV  ·  Drop AUS & US files together',
    multi: true,   // accept multiple CSVs at once (e.g. AUS + US)
  },
  comsec: {
    title: 'Add CommSec Transactions',
    hint:  'CommSec → Portfolio → Transactions → Download Transactions → CSV',
    multi: false,
  },
  tradestation: {
    title: 'Add Tradestation Transactions',
    hint:  'Tradestation → Account → History → Export CSV',
    multi: false,
  },
  tradezero: {
    title: 'Add TradeZero Trade History',
    hint:  'TradeZero → Account → Trade History → Export CSV',
    multi: false,
  },
}

export default function FileUpload({ onFile, broker = 'tastytrade' }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  const cfg = BROKER_CONFIG[broker] ?? BROKER_CONFIG.tastytrade

  function submit(fileList) {
    const csvs = Array.from(fileList).filter(f => f.name.endsWith('.csv'))
    if (!csvs.length) return
    // Always pass an array; App normalises single vs multi
    onFile(cfg.multi ? csvs : [csvs[0]])
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); submit(e.dataTransfer.files) }}
      onClick={() => inputRef.current.click()}
      className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-colors
        ${dragging ? 'border-violet-400 bg-violet-900/20' : 'border-slate-600 hover:border-violet-500 hover:bg-slate-800/50'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple={cfg.multi}
        className="hidden"
        onChange={e => submit(e.target.files)}
      />
      <div className="text-5xl mb-4">📂</div>
      <p className="text-xl font-semibold text-slate-200 mb-2">{cfg.title}</p>
      <p className="text-slate-400 text-sm">{cfg.hint}</p>
      {cfg.multi && (
        <p className="text-slate-500 text-xs mt-2">
          You can select or drop multiple CSV files at once
        </p>
      )}
    </div>
  )
}
