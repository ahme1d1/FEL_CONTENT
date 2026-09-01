/**
 * Warnings about text the author did not write and cannot fix.
 *
 * A manager's team name is user input, and it goes onto a card verbatim. The runbook already has
 * the GW1 example (`فريقالاهليي في FEL`); GW2's real top three contains `My FEL Team`. `FEL` was
 * retired from every user-facing surface on 2026-08-25, so that card would put it back.
 *
 * These are warnings, not errors. The name belongs to a real person and cannot be rewritten — the
 * decision is whether to post the card, use a different one, or lead with the manager instead. It
 * is a person's call, and this is what makes it in time to be made.
 */

/** Cards with a slot fed straight from something a user typed, and which slots those are. */
const USER_CONTENT = {
  E_PODIUM: { label: 'team name', slots: [3, 7, 11] },
}

/** Retired from every user-facing surface on 2026-08-25, and not in the caption linter's lists. */
const RETIRED_WORDMARK = /\bFEL\b/

/**
 * @param {{posts: object[], rules: object}} input
 * @returns {Array<{id: string, slot: number, text: string, reason: string}>}
 */
export function reviewUserContent({ posts, rules }) {
  const warnings = []
  const seen = new Set()

  for (const post of posts) {
    const spec = USER_CONTENT[post.source?.card]
    if (!spec) continue

    for (const slot of spec.slots) {
      const text = post.source.texts?.[slot]
      if (typeof text !== 'string') continue

      // One warning per distinct string: the same card fans out to several platforms.
      const key = `${post.source.card}:${slot}:${text}`
      if (seen.has(key)) continue
      seen.add(key)

      const add = (reason) => warnings.push({ id: post.id, slot, text, reason: `${spec.label} ${reason}` })

      if (RETIRED_WORDMARK.test(text)) add('carries «FEL», retired from every user-facing surface')
      for (const { term } of rules.retiredVocabulary) {
        if (text.includes(term)) add(`carries «${term}», which is retired`)
      }
      for (const banned of rules.bannedCharacters) {
        for (const ch of banned.chars) if (text.includes(ch)) add(`carries «${ch}» (${banned.id})`)
      }
    }
  }

  return warnings
}
