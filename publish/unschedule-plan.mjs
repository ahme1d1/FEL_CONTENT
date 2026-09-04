/**
 * Which scheduled Facebook posts to pull back out of Meta's queue, and which to leave alone.
 *
 * `schedule-plan.mjs` is deliberately one-way: a post whose latest ledger state is `scheduled` is
 * HELD forever, because that guard is the only thing standing between a re-run and a duplicate on
 * a live brand account. That is right until the card itself changes underneath a post Meta is
 * already holding — then the queue contains a rendering we no longer want to publish, and there is
 * no way to say so.
 *
 * This is that way. It is deliberately narrow: it names posts explicitly rather than inferring
 * them, refuses an id the manifest does not carry, and will not touch a post that has already gone
 * out. Pulling a post from a queue is reversible; deleting one the audience has already seen is not.
 *
 * Pure on purpose — the Graph call and the token live in `schedule-facebook.mjs`.
 */

/**
 * The state written after Meta has let go of a post.
 *
 * Chosen so `selectSchedulable` offers the post again: it is neither `scheduled` (held), `claimed`
 * (crashed) nor a member of that module's TERMINAL set. `unschedule-plan.test.mjs` asserts the
 * round trip rather than trusting this comment, because if it were wrong the post would be deleted
 * at Facebook and never re-sent — the one outcome worse than leaving the stale card up.
 */
export const UNSCHEDULED = 'unscheduled'

/** The most recent recorded entry for a post id, or null. */
function latestEntry(ledger, id) {
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    if (ledger[i]?.id === id) return ledger[i]
  }
  return null
}

/**
 * @param {{manifest: object, ledger: object[], ids: string[]}} input
 * @returns {{toDelete: Array<{id: string, remoteId: string}>, notScheduled: string[], unknown: string[]}}
 *
 *   toDelete     - Meta is holding these; delete the remote post, then record UNSCHEDULED
 *   notScheduled - nothing to pull back: never scheduled, or already published
 *   unknown      - not in this manifest at all, which is almost always a typo
 */
export function planUnschedule({ manifest, ledger = [], ids = [] }) {
  const known = new Set((manifest?.posts ?? []).map((p) => p.id))
  const out = { toDelete: [], notScheduled: [], unknown: [] }

  for (const id of new Set(ids)) {
    if (!known.has(id)) {
      out.unknown.push(id)
      continue
    }

    const entry = latestEntry(ledger, id)
    // Only a post whose LATEST state is `scheduled` is still in the queue. A later `published`
    // means it has gone out, and pulling that is not this tool's job.
    if (entry?.state !== 'scheduled' || !entry.remoteId) {
      out.notScheduled.push(id)
      continue
    }

    out.toDelete.push({ id, remoteId: entry.remoteId })
  }

  return out
}
