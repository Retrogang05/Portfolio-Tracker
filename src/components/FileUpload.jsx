import { useRef, useState } from 'react'

export default function FileUpload({ onFile }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  const handleFile = file => {
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.xlsx'))) {
      onFile(file)
    }
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
      onClick={() => inputRef.current.click()}
      className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-colors
        ${dragging ? 'border-violet-400 bg-violet-900/20' : 'border-slate-600 hover:border-violet-500 hover:bg-slate-800/50'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />
      <div className="text-5xl mb-4">📂</div>
      <p className="text-xl font-semibold text-slate-200 mb-2">
        Drop your Tastytrade CSV here
      </p>
      <p className="text-slate-400 text-sm">
        Export from Tastytrade → History → Transactions → Download CSV
      </p>
    </div>
  )
}
