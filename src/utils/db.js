/**
 * IndexedDB persistence for Portfolio Tracker.
 *
 * Database : "portfolio-tracker"  (version 1)
 * Stores   : "portfolios"  – one record per portfolio, keyPath = idx
 *            "settings"    – key/value store for RBA rates etc.
 *
 * All portfolio objects (including their Date fields) are stored via the
 * structured-clone algorithm, so Date objects survive the round-trip intact.
 */

const DB_NAME    = 'portfolio-tracker'
const DB_VERSION = 1
const STORE_PF   = 'portfolios'
const STORE_SET  = 'settings'

// ── Open (or create) the database ────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_PF))
        db.createObjectStore(STORE_PF,  { keyPath: 'idx' })
      if (!db.objectStoreNames.contains(STORE_SET))
        db.createObjectStore(STORE_SET, { keyPath: 'key' })
    }

    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
  })
}

// ── Portfolios ────────────────────────────────────────────────────────────────

/**
 * Save all portfolios to IndexedDB.
 * Portfolios with no data (fileName is empty) are deleted from the store.
 */
export async function savePortfolios(portfolios) {
  const db    = await openDB()
  const tx    = db.transaction(STORE_PF, 'readwrite')
  const store = tx.objectStore(STORE_PF)

  for (let i = 0; i < portfolios.length; i++) {
    const p = portfolios[i]
    if (p.fileName) {
      store.put({ ...p, idx: i })  // upsert
    } else {
      store.delete(i)              // remove empty slot
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

/**
 * Load all saved portfolios from IndexedDB.
 * Returns an array of stored portfolio objects (may be fewer than 5 if some are empty).
 */
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

/** Persist the parsed RBA rate map and its source filename. */
export async function saveRBA(rates, fileName) {
  const db = await openDB()
  const tx = db.transaction(STORE_SET, 'readwrite')
  tx.objectStore(STORE_SET).put({ key: 'rba', rates, fileName })
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}

/** Load the saved RBA rate map, or null if none. */
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

// ── Nuke everything ───────────────────────────────────────────────────────────

/** Clear all saved portfolios and settings. */
export async function clearAll() {
  const db = await openDB()
  const tx = db.transaction([STORE_PF, STORE_SET], 'readwrite')
  tx.objectStore(STORE_PF).clear()
  tx.objectStore(STORE_SET).clear()
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror    = e => reject(e.target.error)
  })
}
