/**
 * Player names as a card writes them.
 *
 * The name box under a shirt is 284px, so a card carries the last name only
 * (`content-design-kit.md` §2 rule 9). This is a job-data convention, not an API field: `Player`
 * has one `name` column and no `shortName`, so the shortening has to happen where the render job
 * is assembled — here.
 */

/** Words that belong to the surname they precede. أبو علي is a name; علي is a different man. */
const SURNAME_PREFIXES = new Set(['أبو', 'ابو', 'عبد', 'ابن'])

/**
 * @param {string} full the player's full Arabic name
 * @returns {string} the last name, with its prefix when it has one
 */
export function shortName(full) {
  if (typeof full !== 'string' || !full.trim()) {
    throw new Error(`A player name is required, got ${JSON.stringify(full)}.`)
  }

  const words = full.trim().split(/\s+/)
  const last = words[words.length - 1]
  const before = words[words.length - 2]

  return before && SURNAME_PREFIXES.has(before) ? `${before} ${last}` : last
}

/**
 * A player's name as a WIDE card writes it: in full where it fits, by last name where it does not.
 *
 * This is rule 9 as the rule is worded — "if the name is long, take the last name" — rather than as
 * its worked table shows, which shortens everything. The table is right for the card it was
 * measured on: the 284px box the rule cites sits UNDER A SHIRT, on the team-of-the-week and winner
 * pitches, where eleven names compete for one row of space. A top-players row and the
 * player-of-the-round hero are not that box, and their own templates carry «أحمد سيد زيزو» in full.
 *
 * Owner call, 2026-09-04: full names on the wide cards. `shortName` is untouched and still what
 * the shirt cards use, so the rule keeps holding exactly where it was measured.
 *
 * The budget is in characters, not pixels, because that is what this module can honestly know —
 * the render lives in FEL_WEBSITE. Verify a new budget by rendering the card and looking at it.
 *
 * @param {string} full the player's full Arabic name
 * @param {{maxChars: number}} budget how much room the card's name slot has
 * @returns {string} the full name, or the last name when the full one will not fit
 */
export function cardName(full, { maxChars }) {
  const short = shortName(full) // validates, and is the fallback
  const normalised = full.trim().replace(/\s+/g, ' ')
  return normalised.length <= maxChars ? normalised : short
}
