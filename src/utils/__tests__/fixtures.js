// Locating the real broker exports used by the "real file" suites.
//
// These fixtures are the user's own CSV exports living outside the repo. They get
// re-downloaded, renamed and reorganised over time, so a hard-coded absolute path
// rots quickly — and a rotted path throws ENOENT, which reads as a failing suite
// rather than an absent one. Four of six paths had rotted this way, silently
// leaving Selfwealth with no real-file coverage at all.
//
// So: resolve by folder + filename PATTERN, and hand back null when nothing matches
// so the caller can skip cleanly instead of erroring.

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Override with PORTFOLIO_FIXTURES=/some/dir when the exports live elsewhere.
export const FIXTURE_BASE =
  process.env.PORTFOLIO_FIXTURES ??
  '/Users/harrysingh/Documents/Claude/Portfolio Transactions'

/**
 * Newest-or-largest matching file inside <FIXTURE_BASE>/<folder>.
 *
 * Defaults to the LARGEST match, not the newest: a broker's history is often split
 * across several exports (Selfwealth is split at 30 Jun 2026 by the Jul-2026 format
 * change) and the most recent slice can be nearly empty — the current
 * "2026-07-01..(AU)" export has zero fills because that account is dormant. The
 * largest file is the one with enough data for assertions to mean anything.
 *
 * @returns {string|null} absolute path, or null when the folder or a match is absent
 */
export function fixture(folder, pattern, { pick = 'largest' } = {}) {
  const dir = join(FIXTURE_BASE, folder)
  if (!existsSync(dir)) return null

  const matches = readdirSync(dir)
    .filter(name => pattern.test(name))
    .map(name => join(dir, name))
  if (!matches.length) return null

  if (pick === 'newest') {
    return matches.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  }
  return matches.sort((a, b) => statSync(b).size - statSync(a).size)[0]
}
