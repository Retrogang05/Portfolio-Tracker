export default function StatCard({ label, value, sub, positive }) {
  const color =
    positive === true ? 'text-emerald-400' :
    positive === false ? 'text-red-400' :
    'text-slate-100'

  return (
    <div className="bg-slate-800 rounded-xl p-5 flex flex-col gap-1">
      <span className="text-slate-400 text-xs uppercase tracking-widest">{label}</span>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-slate-500 text-xs">{sub}</span>}
    </div>
  )
}
