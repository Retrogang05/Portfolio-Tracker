import { useState } from 'react'

export default function Collapsible({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 py-1.5 group"
      >
        <span
          className="text-slate-500 text-[10px] select-none transition-transform duration-150"
          style={{ display: 'inline-block', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          ▾
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-slate-300 transition-colors whitespace-nowrap">
          {title}
        </span>
        <div className="flex-1 h-px bg-slate-700/50 group-hover:bg-slate-600/50 transition-colors" />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}
