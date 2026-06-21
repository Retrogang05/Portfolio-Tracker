import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseAllIBKR } from '../parseIBKR.js'

// IBKR CSV is a multi-section file — hard to write inline fixtures meaningfully.
// These tests use the real export file.

const REAL_IBKR_PATH = '/Users/harrysingh/Documents/Claude/Portfolio Transactions/U24130472.TRANSACTIONS.YTD.csv'

describe('parseIBKR (real file)', () => {

  it('parses without throwing', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('every row has a rowType', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.every(r => typeof r.rowType === 'string' && r.rowType.length > 0)).toBe(true)
  })

  it('Trade rows have required fields', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows    = await parseAllIBKR(csvText)
    const trades  = rows.filter(r => r.rowType === 'Trade')

    expect(trades.length).toBeGreaterThan(0)

    for (const r of trades) {
      expect(r).toHaveProperty('underlying')
      expect(r).toHaveProperty('expiration')
      expect(r).toHaveProperty('openClose')
      expect(r.quantity).toBeGreaterThanOrEqual(0)
    }

    // Option-specific checks (only run if options present in this export)
    const optTrades = trades.filter(r => r.instrumentType === 'Equity Option')
    for (const r of optTrades) {
      expect(r.callPut === 'CALL' || r.callPut === 'PUT').toBe(true)
      expect(r).toHaveProperty('strike')
      expect(r.openClose === 'Open' || r.openClose === 'Close').toBe(true)
    }
  })

  it('every row has a valid date', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.every(r => r.date instanceof Date && !isNaN(r.date))).toBe(true)
  })

  it('no internal _signedQty fields leak out', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows = await parseAllIBKR(csvText)
    expect(rows.every(r => r._signedQty === undefined)).toBe(true)
  })

  it('synthetic expirations have amount=0 and isExpiration=true', async () => {
    const csvText  = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows     = await parseAllIBKR(csvText)
    const expRows  = rows.filter(r => r.isExpiration)
    for (const r of expRows) {
      expect(r.amount).toBe(0)
      expect(r.openClose).toBe('Close')
      expect(r.rowType).toBe('Expiration')
    }
  })

  it('MoneyMovement rows have instrumentType Cash', async () => {
    const csvText = readFileSync(REAL_IBKR_PATH, 'utf8')
    const rows    = await parseAllIBKR(csvText)
    const mm = rows.filter(r => r.rowType === 'MoneyMovement')
    expect(mm.length).toBeGreaterThan(0)
    expect(mm.every(r => r.instrumentType === 'Cash')).toBe(true)
  })

})
