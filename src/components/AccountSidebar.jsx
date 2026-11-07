import { capitalRowId, effectiveCategory } from './CapitalMovements'
import { fmt } from '../utils/format'

function SidebarItem({ label, sublabel, value, valueColor }) {
  return (
    <div className="py-3 border-b border-slate-700/60 last:border-0">
      <p className="text-xs text-slate-400 uppercase tracking-wider leading-tight">{label}</p>
      {sublabel && <p className="text-xs text-slate-600 mt-0.5">{sublabel}</p>}
      <p className={`text-lg font-bold mt-1 ${valueColor}`}>{fmt(value)}</p>
    </div>
  )
}

export default function AccountSidebar({ movements, tags }) {
  if (!movements.length) return null

  let capitalIn = 0, withdrawn = 0, dividends = 0, taxWithheld = 0, intPaid = 0, intReceived = 0, feesPaid = 0

  for (const m of movements) {
    const cat = effectiveCategory(m, tags)
    if (cat === 'Capital Introduced')   capitalIn   += m.amount
    else if (cat === 'Withdrawal')      withdrawn   += m.amount
    else if (cat === 'Dividend Income') dividends   += m.amount
    else if (cat === 'Tax Withheld')    taxWithheld += m.amount
    else if (cat === 'Interest Paid')   intPaid     += m.amount
    else if (cat === 'Interest Received') intReceived += m.amount
    else if (cat === 'Fees Paid')       feesPaid    += m.amount
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="text-slate-300 font-semibold text-sm mb-1">Account Summary</h3>
      <p className="text-xs text-slate-500 mb-3">All-time</p>

        <SidebarItem
          label="Capital Introduced"
          value={capitalIn}
          valueColor="text-emerald-400"
        />
        {withdrawn !== 0 && (
          <SidebarItem
            label="Withdrawals"
            value={withdrawn}
            valueColor="text-slate-300"
          />
        )}
        <SidebarItem
          label="Dividend Income"
          sublabel={taxWithheld !== 0 ? 'Gross, before tax withheld' : undefined}
          value={dividends}
          valueColor={dividends === 0 ? 'text-slate-400' : 'text-teal-400'}
        />
        {/* Shown beside gross dividends: tax withheld at source is what the foreign
            income tax offset is claimed against, so it must not vanish into a net
            figure — which is what it did while it was misfiled as dividend income. */}
        {taxWithheld !== 0 && (
          <SidebarItem
            label="Tax Withheld"
            sublabel="Foreign tax at source"
            value={taxWithheld}
            valueColor="text-red-400"
          />
        )}
        <SidebarItem
          label="Interest Paid"
          sublabel="Debit Interest"
          value={intPaid}
          valueColor={intPaid === 0 ? 'text-slate-400' : 'text-red-400'}
        />
        <SidebarItem
          label="Interest Received"
          sublabel="Credit Interest"
          value={intReceived}
          valueColor={intReceived === 0 ? 'text-slate-400' : 'text-blue-400'}
        />
        <SidebarItem
          label="Fees Paid"
          sublabel="Regulatory Fees"
          value={feesPaid}
          valueColor={feesPaid === 0 ? 'text-slate-400' : 'text-orange-400'}
        />
    </div>
  )
}
