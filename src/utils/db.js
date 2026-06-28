/**
 * IndexedDB persistence for Portfolio Tracker.
 *
 * Database : "portfolio-tracker"  (version 2)
 * Stores   : "portfolios"  – one record per portfolio, keyPath = idx
 *            "settings"    – key/value store for RBA rates etc.
 *            "journal"     – journal entries, keyPath = id (autoIncrement)
 */

const DB_NAME       = 'portfolio-tracker'
const DB_VERSION    = 2
const STORE_PF      = 'portfolios'
const STORE_SET     = 'settings'
const STORE_JOURNAL = 'journal'

// ── Open (or create/upgrade) the database ────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = e => {
      const db = e.target.result
      // v1 stores
      if (!db.objectStoreNames.contains(STORE_PF))
        db.createObjectStore(STORE_PF,  { keyPath: 'idx' })
      if (!db.objectStoreNames.contains(STORE_SET))
        db.createObjectStore(STORE_SET, { keyPath: 'key' })
      // v2: journal
      if (!db.objectStoreNames.contains(STORE_JOURNAL)) {
        const js = db.createObjectStore(STORE_JOURNAL, { keyPath: 'id', autoIncrement: true })
        js.createIndex('date', 'date', { unique: false })
      }
    }

    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

// ── Portfolios ────────────────────────────────────────────────────────────────

export async function savePortfolios(portfolios) {
  const db    = await openDB()
  const tx    = db.transaction(STORE_PF, 'readwrite')
  const store = tx.objectStore(STORE_PF)

  for (let i = 0; i < portfolios.length; i++) {
    const p = portfolios[i]
    if (p.fileName) {
      store.put({ ...p, idx: i })
    } else {
      store.delete(i)
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

export async function loadPortfolios() {
  const db    = await openDB()
  const tx    = db.transaction(STORE_PF, 'readonly')
  const store = tx.objectStore(STORE_PF)

  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = e => resolve(e.target.result ?? [])
    req.onerror   = e => reject(e.target.error)
  })
}

// ── RBA rates ────────────────────────────────────────────────────────────────

export async function saveRBA(rates, fileName) {
  const db = await openDB()
  const tx = db.transaction(STORE_SET, 'readwrite')
  tx.objectStore(STORE_SET).put({ key: 'rba', rates, fileName })
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

export async function loadRBA() {
  const db    = await openDB()
  const tx    = db.transaction(STORE_SET, 'readonly')
  const store = tx.objectStore(STORE_SET)
  return new Promise((resolve, reject) => {
    const req = store.get('rba')
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror   = e => reject(e.target.error)
  })
}

// ── RBI rates (Sharan / INR) ─────────────────────────────────────────────────

export async function saveRBI(rates, fileName) {
  const db = await openDB()
  const tx = db.transaction(STORE_SET, 'readwrite')
  tx.objectStore(STORE_SET).put({ key: 'rbi', rates, fileName })
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

export async function loadRBI() {
  const db    = await openDB()
  const tx    = db.transaction(STORE_SET, 'readonly')
  const store = tx.objectStore(STORE_SET)
  return new Promise((resolve, reject) => {
    const req = store.get('rbi')
    req.onsuccess = e => resolve(e.target.result ?? null)
    req.onerror   = e => reject(e.target.error)
  })
}

// ── Journal ───────────────────────────────────────────────────────────────────

/** Load all journal entries (unsorted — sort in the component). */
export async function loadJournalEntries() {
  const db    = await openDB()
  const tx    = db.transaction(STORE_JOURNAL, 'readonly')
  const store = tx.objectStore(STORE_JOURNAL)
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = e => resolve(e.target.result ?? [])
    req.onerror   = e => reject(e.target.error)
  })
}

/**
 * Save a journal entry.
 * If entry.id is set → update (put).  If no id → insert (add).
 * Returns the assigned id.
 */
export async function saveJournalEntry(entry) {
  const db    = await openDB()
  const tx    = db.transaction(STORE_JOURNAL, 'readwrite')
  const store = tx.objectStore(STORE_JOURNAL)
  return new Promise((resolve, reject) => {
    const req = entry.id != null ? store.put(entry) : store.add(entry)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

/** Delete a single journal entry by id. */
export async function deleteJournalEntry(id) {
  const db    = await openDB()
  const tx    = db.transaction(STORE_JOURNAL, 'readwrite')
  tx.objectStore(STORE_JOURNAL).delete(id)
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

/** Wipe all journal entries (used from within the Journal component). */
export async function clearJournal() {
  const db = await openDB()
  const tx = db.transaction(STORE_JOURNAL, 'readwrite')
  tx.objectStore(STORE_JOURNAL).clear()
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

/** Bulk-insert journal entries (used by backup restore). */
export async function restoreJournalEntries(entries) {
  if (!entries?.length) return
  const db    = await openDB()
  const tx    = db.transaction(STORE_JOURNAL, 'readwrite')
  const store = tx.objectStore(STORE_JOURNAL)
  for (const e of entries) {
    // Strip the old id so IndexedDB auto-assigns a new one (avoids collisions)
    const { id: _id, ...rest } = e
    store.add(rest)
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

// ── Nuke everything ───────────────────────────────────────────────────────────

/** Clear portfolios, settings AND journal entries. */
export async function clearAll() {
  const db = await openDB()
  const tx = db.transaction([STORE_PF, STORE_SET, STORE_JOURNAL], 'readwrite')
  tx.objectStore(STORE_PF).clear()
  tx.objectStore(STORE_SET).clear()
  tx.objectStore(STORE_JOURNAL).clear()
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}
