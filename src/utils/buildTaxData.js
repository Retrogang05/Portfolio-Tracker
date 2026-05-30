/**
 * Build consolidated tax events across all portfolios.
 *
 * Combines:
 *  - Equity closed positions (Selfwealth AUS=AUD, Selfwealth US=USD, Tasty/IBKR=USD)
 *  - Options closed trades (Tasty/IBKR only, always USD)
 *
 * Converts USD amounts to AUD using RBA rates:
 *  - Cost basis: converted at the buy-date rate
 *  - Proceeds / fees: converted at the sell-date rate
 *
 * CGT discount: 50% discount applied when asset held ≥ 365 days AND gain > 0.
 *
 * auFY(date) returns the financial year string, e.g. "2026" for FY2025-26.
 */
import { auFY } from './calculatePnL'
import { getFxRate } from './parseRBA'

/**
 * @param {object[]} portfolios       - array of portfolio state objects
 * @param {string[]} portfolioBrokers - e.g. ['tastytrade','ibkr','selfwealth','selfwealth']
 * @param {string[]} portfolioNames   - e.g. ['Divya Tasty','SAHR IBKR','Divya SW','SAHR SW']
 * @param {object}   rateMap          - { 'YYYY-MM-DD': audusdRate } from parseRBA
 * @returns {{ events: object[], fyList: object[] }}
 */
export function buildTaxData(portfolios, portfolioBrokers, portfolioNames, rateMap) {
  const allEvents = []

  portfolios.forEach((p, idx) => {
    const broker = portfolioBrokers[idx]
    const name   = portfolioNames[idx]

    // ── Equity positions ─────────────────────────────────────────────────
    const equityGroups = broker === 'selfwealth'
      ? [
          { data: p.equityDataAUS, currency: 'AUD' },
          { data: p.equityDataUS,  currency: 'USD' },
        ]
      : [{ data: p.equityData, currency: 'USD' }]

    for (const { data, currency } of equityGroups) {
      if (!data?.closedPositions?.length) continue

      for (const pos of data.closedPositions) {
        const isUSD = (pos.currency ?? currency) === 'USD'
        const fxBuy  = isUSD ? (getFxRate(pos.buyDate,  rateMap) ?? 1) : 1
        const fxSell = isUSD ? (getFxRate(pos.sellDate, rateMap) ?? 1) : 1

        // USD ÷ A$1=USD rate = AUD
        const costBasisAUD    = isUSD ? pos.costBasis    / fxBuy  : pos.costBasis
        const saleProceedsAUD = isUSD ? pos.saleProceeds / fxSell : pos.saleProceeds
        const totalFeesAUD    = isUSD ? pos.totalFees    / fxSell : pos.totalFees
        const pnlAUD          = saleProceedsAUD - costBasisAUD - totalFeesAUD

        // 50% CGT discount: held ≥ 365 days, profit only
        const isDiscountEligible = pos.daysHeld >= 365 && pnlAUD > 0
        const discountAUD        = isDiscountEligible ? pnlAUD * 0.5 : 0
        const taxableGainAUD     = pnlAUD - discountAUD

        allEvents.push({
          portfolio:         name,
          assetClass:        'Equity',
          symbol:            pos.symbol,
          description:       pos.symbol,
          quantity:          pos.quantity,
          buyDate:           pos.buyDate,
          sellDate:          pos.sellDate,
          daysHeld:          pos.daysHeld,
          sourceCurrency:    pos.currency ?? currency,
          fxRateBuy:         isUSD ? parseFloat(fxBuy.toFixed(4))  : null,
          fxRateSell:        isUSD ? parseFloat(fxSell.toFixed(4)) : null,
          costBasisAUD:      parseFloat(costBasisAUD.toFixed(2)),
          saleProceedsAUD:   parseFloat(saleProceedsAUD.toFixed(2)),
          totalFeesAUD:      parseFloat(totalFeesAUD.toFixed(2)),
          pnlAUD:            parseFloat(pnlAUD.toFixed(2)),
          isDiscountEligible,
          discountAUD:       parseFloat(discountAUD.toFixed(2)),
          taxableGainAUD:    parseFloat(taxableGainAUD.toFixed(2)),
          fy:                auFY(pos.sellDate),
        })
      }
    }

    // ── Options trades (Tasty / IBKR only, always USD) ───────────────────
    //
    // ATO treatment (ITAA 1997):
    //
    //  SHORT option (sell to open — openAmount > 0):
    //    CGT event D2 (s.104-35): you granted a right.
    //    Capital Proceeds = premium received at open  (openAmount, at open-date FX)
    //    Cost Base        = premium paid to close      (|closeAmount|, at close-date FX)
    //                       $0 if the option expired worthless
    //
    //  LONG option (buy to open — openAmount < 0):
    //    CGT event A1 (s.104-10): disposal of a CGT asset.
    //    Cost Base        = premium paid at open       (|openAmount|, at open-date FX)
    //    Capital Proceeds = premium received at close  (closeAmount,  at close-date FX)
    //                       $0 if expired worthless
    //
    //  Each leg is converted at its own date's RBA rate (ATO requirement).
    //  Tastytrade "Total" column is already net of commissions, so both openAmount and
    //  closeAmount include fees — totalFeesAUD is therefore reported as $0 to avoid
    //  double-counting.
    //
    if (broker !== 'selfwealth' && p.trades?.length) {
      for (const trade of p.trades) {
        const openAmtUSD  = trade.openAmount  ?? 0
        const closeAmtUSD = trade.closeAmount ?? 0

        // Direction: openAmount > 0 = sold to open (short); < 0 = bought to open (long)
        const isShortOption = openAmtUSD >= 0

        const fxOpen  = getFxRate(trade.openDate,  rateMap) ?? 1
        const fxClose = getFxRate(trade.closeDate, rateMap) ?? 1

        const openAmtAUD  = openAmtUSD  / fxOpen
        const closeAmtAUD = closeAmtUSD / fxClose

        let costBasisAUD, saleProceedsAUD
        if (isShortOption) {
          // D2: premium received = proceeds; buyback paid = cost base
          saleProceedsAUD = parseFloat(openAmtAUD.toFixed(2))
          costBasisAUD    = parseFloat(Math.abs(closeAmtAUD).toFixed(2))  // 0 if expired
        } else {
          // A1: premium paid = cost base; close proceeds = capital proceeds
          costBasisAUD    = parseFloat(Math.abs(openAmtAUD).toFixed(2))
          saleProceedsAUD = parseFloat(Math.max(0, closeAmtAUD).toFixed(2))  // 0 if expired
        }

        const pnlAUD = parseFloat((saleProceedsAUD - costBasisAUD).toFixed(2))

        // CGT discount: can apply to LEAPS held ≥ 12 months, but rare
        const isDiscountEligible = trade.daysHeld >= 365 && pnlAUD > 0
        const discountAUD        = isDiscountEligible ? parseFloat((pnlAUD * 0.5).toFixed(2)) : 0
        const taxableGainAUD     = parseFloat((pnlAUD - discountAUD).toFixed(2))

        allEvents.push({
          portfolio:       name,
          assetClass:      'Option',
          symbol:          trade.underlying,
          description:     trade.strategyName ?? trade.underlying,
          quantity:        null,
          buyDate:         trade.openDate,
          sellDate:        trade.closeDate,
          daysHeld:        trade.daysHeld,
          sourceCurrency:  'USD',
          fxRateBuy:       parseFloat(fxOpen.toFixed(4)),
          fxRateSell:      parseFloat(fxClose.toFixed(4)),
          costBasisAUD,
          saleProceedsAUD,
          totalFeesAUD:    0,  // already embedded in openAmount / closeAmount
          pnlAUD,
          isDiscountEligible,
          discountAUD,
          taxableGainAUD,
          fy:              auFY(trade.closeDate),
          isShortOption,
          isExpiration:    trade.isExpiration ?? false,
        })
      }
    }
  })

  // Sort newest-first
  allEvents.sort((a, b) => b.sellDate - a.sellDate)

  // ── FY summaries ─────────────────────────────────────────────────────
  const fyMap = {}
  for (const ev of allEvents) {
    const fy = ev.fy
    if (!fyMap[fy]) {
      fyMap[fy] = {
        fy,
        grossGains:      0,  // total pnlAUD where pnlAUD > 0
        grossLosses:     0,  // total pnlAUD where pnlAUD < 0 (negative)
        discountApplied: 0,  // total discount deducted from gains
        taxableGains:    0,  // gains after discount
        taxableLosses:   0,  // losses (negative)
        netTaxable:      0,  // taxableGains + taxableLosses
        count:           0,
        equityCount:     0,
        optionCount:     0,
      }
    }
    const row = fyMap[fy]
    row.count++
    if (ev.assetClass === 'Equity') row.equityCount++
    else row.optionCount++

    if (ev.pnlAUD > 0) {
      row.grossGains      += ev.pnlAUD
      row.discountApplied += ev.discountAUD
      row.taxableGains    += ev.taxableGainAUD
    } else {
      row.grossLosses  += ev.pnlAUD       // adds negative number
      row.taxableLosses += ev.taxableGainAUD  // also negative
    }
  }

  for (const row of Object.values(fyMap)) {
    row.netTaxable      = parseFloat((row.taxableGains + row.taxableLosses).toFixed(2))
    row.grossGains      = parseFloat(row.grossGains.toFixed(2))
    row.grossLosses     = parseFloat(row.grossLosses.toFixed(2))
    row.discountApplied = parseFloat(row.discountApplied.toFixed(2))
    row.taxableGains    = parseFloat(row.taxableGains.toFixed(2))
    row.taxableLosses   = parseFloat(row.taxableLosses.toFixed(2))
  }

  const fyList = Object.values(fyMap).sort((a, b) => a.fy.localeCompare(b.fy))

  return { events: allEvents, fyList }
}
