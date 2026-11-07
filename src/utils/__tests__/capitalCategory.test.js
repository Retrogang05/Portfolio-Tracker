import { describe, it, expect } from 'vitest'
import { effectiveCategory } from '../../components/CapitalMovements.jsx'

const row = (description, subType, amount) => ({ description, subType, amount, timestampSec: '0' })
const cat = r => effectiveCategory(r, {})

describe('capital movement categories', () => {

  // A withholding line usually names the dividend it was taken from. Testing for
  // "dividend" before "withholding" filed tax paid as dividend income.
  it('files dividend withholding as tax, not as dividend income', () => {
    expect(cat(row('NRA WITHHOLD: DIVIDEND', 'Foreign Tax Withholding', -12.6))).toBe('Tax Withheld')
    expect(cat(row('TQQQ(US74347X8314) Cash Dividend USD 0.171229 per Share - US Tax',
                   'Foreign Tax Withholding', -1.85))).toBe('Tax Withheld')
  })

  // The case that broke a naive withholding-first rule: a genuine dividend whose
  // description mentions withholding.
  it('files a dividend that mentions withholding as dividend income', () => {
    expect(cat(row('TSM(US8740391003) Cash Dividend USD 0.938972 per Share (Ordinary Div - NRA Withholding Exempt)',
                   'Dividend', 132.96))).toBe('Dividend Income')
  })

  // Tastytrade types dividend withholding as "Dividend" and says nothing about tax
  // in the description: JPMORGAN +150.00 / -22.50, the 15% treaty rate.
  it('files a dividend-typed debit as tax withheld', () => {
    expect(cat(row('JPMORGAN CHASE & CO', 'Dividend', -22.5))).toBe('Tax Withheld')
    expect(cat(row('JPMORGAN CHASE & CO', 'Dividend', 150))).toBe('Dividend Income')
  })

  // IBKR reverses and re-books withholding; a positive withholding is a tax refund.
  it('keeps a withholding reversal under tax', () => {
    expect(cat(row('GLW(US2193501051) Cash Dividend USD 0.28 per Share - US Tax',
                   'Foreign Tax Withholding', 11.79))).toBe('Tax Withheld')
  })

  it('still files a dividend as dividend income', () => {
    expect(cat(row('CISCO SYS INC 200', 'Dividend', 84))).toBe('Dividend Income')
    expect(cat(row('TQQQ(US74347X8314) Cash Dividend USD 0.171229 per Share (Ordinary Dividend)',
                   'Dividend', 12.37))).toBe('Dividend Income')
  })

  it('separates interest received from interest paid', () => {
    expect(cat(row('FPL INTEREST CR', 'Credit Interest', 0.25))).toBe('Interest Received')
    expect(cat(row('11.75000%07/01-07/31 $6848', 'Debit Interest', -68.32))).toBe('Interest Paid')
  })

  it('files platform charges as fees, and transfers by direction', () => {
    expect(cat(row('TradeStation: CME Globex MD No', 'Fee', -5))).toBe('Fees Paid')
    expect(cat(row('ACATS JOURNAL ENTRY', 'Deposit', 45000))).toBe('Capital Introduced')
    expect(cat(row('JNL TO 210WRF95', 'Withdrawal', -20000))).toBe('Withdrawal')
  })

})
