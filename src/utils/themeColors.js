import { useEffect, useState } from 'react'

// Charts and the heatmap need their colours as plain strings — Recharts writes
// them straight onto SVG presentation attributes, where var() is not resolved.
// So read the tokens off the document once, and again whenever the theme class
// changes, rather than hardcoding a palette that only suits a dark backdrop.

const TOKENS = [
  'sig-green', 'sig-green-rgb', 'sig-red', 'sig-red-rgb', 'sig-amber',
  'chart-grid', 'chart-axis', 'chart-zero',
  'heat-green-lo', 'heat-green-hi', 'heat-red-lo', 'heat-red-hi',
  'heat-zero-bg', 'heat-zero-fg', 'heat-empty-fg',
]

const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

function readTokens() {
  if (typeof window === 'undefined') return {}
  const cs = getComputedStyle(document.documentElement)
  const out = {}
  for (const t of TOKENS) out[camel(t)] = cs.getPropertyValue(`--${t}`).trim()
  return out
}

export function useThemeColors() {
  const [colors, setColors] = useState(readTokens)

  useEffect(() => {
    const update = () => setColors(readTokens())
    update()   // the stylesheet may not have applied on first paint
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return colors
}
