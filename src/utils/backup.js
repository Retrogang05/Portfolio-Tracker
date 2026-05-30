/**
 * Export / Import backup for Portfolio Tracker.
 *
 * What is backed up:
 *   • Strategy overrides  — manually re-categorised option trades (localStorage)
 *   • Capital tags        — manually tagged cash movements (localStorage)
 *   • Trade notes         — per-trade notes for options + stocks (localStorage)
 *   • RBA exchange rates  — uploaded F11.1 CSV data (IndexedDB)
 *   • Journal entries     — full journal (IndexedDB)
 *
 * What is NOT backed up (re-derived from CSV on next upload):
 *   • Parsed trade / equity data  — large, safely re-parsed from CSV
 *   • Computed stats              — derived from trades
 */

import { saveRBA, loadRBA, restoreJournalEntries, loadJournalEntries } from './db'

const BACKUP_VERSION = 2

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all localStorage entries whose key starts with prefix. */
function lsCollect(prefix) {
  const result = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) result[key] = localStorage.getItem(key)
  }
  return result
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportBackup(portfolios) {
  // Per-portfolio localStorage data
  const portfolioBackups = portfolios.map((p, idx) => {
    let overrides = {}
    let tags = {}
    try { overrides = JSON.parse(localStorage.getItem(`portfolio-tracker:strategy-overrides:${idx}`) || '{}') } catch { /* ignore */ }
    try { tags      = JSON.parse(localStorage.getItem(`portfolio-tracker:capital-tags:${idx}`)       || '{}') } catch { /* ignore */ }
    return { idx, name: p.name, fileName: p.fileName, strategyOverrides: overrides, capitalTags: tags }
  })

  // Trade notes (all portfolios, keyed by full localStorage key)
  const tradeNotes = lsCollect('portfolio-tracker:note:')

  // RBA
  let rbaData = null
  try {
    const saved = await loadRBA()
    if (saved?.rates) rbaData = { fileName: saved.fileName ?? '', rates: saved.rates }
  } catch { /* ignore */ }

  // Journal
  let journalEntries = []
  try { journalEntries = await loadJournalEntries() } catch { /* ignore */ }

  const backup = {
    version:       BACKUP_VERSION,
    appName:       'Portfolio Tracker',
    exportedAt:    new Date().toISOString(),
    portfolios:    portfolioBackups,
    tradeNotes,
    rba:           rbaData,
    journalEntries,
  }

  const json    = JSON.stringify(backup, null, 2)
  const blob    = new Blob([json], { type: 'application/json' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href        = url
  a.download    = `portfolio-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Import ────────────────────────────────────────────────────────────────────

export function importBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the backup file.'))

    reader.onload = async e => {
      try {
        const backup = JSON.parse(e.target.result)

        if (!backup?.version || !Array.isArray(backup.portfolios))
          throw new Error('This does not look like a valid Portfolio Tracker backup file.')
        if (backup.version > BACKUP_VERSION)
          throw new Error(`Backup was created with a newer app version (v${backup.version}). Please update the app first.`)

        let overridesRestored = 0
        let tagsRestored      = 0

        // Strategy overrides + capital tags
        for (const p of backup.portfolios) {
          const idx = p.idx
          if (typeof idx !== 'number') continue
          if (p.strategyOverrides && typeof p.strategyOverrides === 'object') {
            localStorage.setItem(`portfolio-tracker:strategy-overrides:${idx}`, JSON.stringify(p.strategyOverrides))
            overridesRestored += Object.keys(p.strategyOverrides).length
          }
          if (p.capitalTags && typeof p.capitalTags === 'object') {
            localStorage.setItem(`portfolio-tracker:capital-tags:${idx}`, JSON.stringify(p.capitalTags))
            tagsRestored += Object.keys(p.capitalTags).length
          }
        }

        // Trade notes
        let notesRestored = 0
        if (backup.tradeNotes && typeof backup.tradeNotes === 'object') {
          for (const [key, val] of Object.entries(backup.tradeNotes)) {
            if (key.startsWith('portfolio-tracker:note:') && typeof val === 'string') {
              localStorage.setItem(key, val)
              notesRestored++
            }
          }
        }

        // RBA
        let rbaRestored = false
        if (backup.rba?.rates && typeof backup.rba.rates === 'object') {
          await saveRBA(backup.rba.rates, backup.rba.fileName ?? '')
          rbaRestored = true
        }

        // Journal
        let journalRestored = 0
        if (Array.isArray(backup.journalEntries) && backup.journalEntries.length > 0) {
          await restoreJournalEntries(backup.journalEntries)
          journalRestored = backup.journalEntries.length
        }

        resolve({ overridesRestored, tagsRestored, notesRestored, rbaRestored, journalRestored, exportedAt: backup.exportedAt ?? null })
      } catch (err) {
        reject(err)
      }
    }

    reader.readAsText(file)
  })
}
