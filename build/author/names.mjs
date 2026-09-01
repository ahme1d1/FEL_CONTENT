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
