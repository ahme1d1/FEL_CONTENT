/**
 * Which posts the authoring pass should hand to Facebook's scheduler right now.
 *
 * The counterpart to `due.mjs`, and deliberately its mirror image: `due.mjs` skips `fb-scheduled`
 * and `fb-text` because "Facebook feed posts and text posts are scheduled natively by Meta … so
 * all three are handled during the authoring pass". This is that pass. The two sets do not
 * overlap, which is what stops one post going out twice from two different processes.
 *
 * Pure over (manifest, ledger, clock), so the whole thing is testable with no account and no
 * network — the same property that makes `due.mjs` safe to trust.
 */

/** The strategies `due.mjs` leaves to us, and the only ones we may touch. */
const AUTHORING_PASS = new Set(['fb-scheduled', 'fb-text', 'fb-video'])

/** Anything here closes a post out. `claimed` is deliberately absent: it means we do not know. */
const TERMINAL = new Set(['scheduled', 'failed', 'skipped'])

/** Graph rejects a scheduled time less than ten minutes out. */
export const SCHEDULE_FLOOR_MS = 10 * 60 * 1000

/**
 * …and how far ahead we hand a post over at all: **two days**.
 *
 * This is OUR lead, not Meta's limit, and it is deliberately far under it. Meta caps a scheduled
 * Page post at roughly 29 days; this constant read six months until 2026-09-15, quoting a Graph
 * doc line that does not hold for a scheduled photo. Every GW6 post was authored 31-34 days out,
 * sailed past a ceiling six times too generous, and came back `(#100) The specified scheduled
 * publish time was invalid`. `failed` is TERMINAL, so none was retried once its date came into
 * range — six posts lost to a comment.
 *
 * Two days rather than twenty-eight, because a long queue is the other failure this repo keeps
 * meeting: a scheduled photo cannot be edited, so every day a card sits at Meta is another day it
 * can be made wrong by a moved fixture, and pulling it back is a delete-and-resend. Two days is
 * about as long as a card stays true. Holding costs nothing — the authoring pass runs hourly, so
 * a slot is picked up within an hour of entering the window, and `tooFar` writes no ledger state.
 */
export const SCHEDULE_CEILING_MS = 2 * 24 * 60 * 60 * 1000

/** The most recent recorded state for a post id, or null if it has none. */
export function latestState(ledger, id) {
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    if (ledger[i].id === id) return ledger[i].state
  }
  return null
}

const withReason = (post, reason) => ({ ...post, reason })

/**
 * @param {{manifest: object, ledger: Array<{id: string, state: string}>, now: Date}} input
 * @returns {{toSchedule: object[], alreadyScheduled: object[], needsCaption: object[], tooSoon: object[], tooFar: object[], crashed: object[]}}
 *   toSchedule       - send these, in publish order
 *   alreadyScheduled - Facebook already holds them; doing nothing is the whole point
 *   needsCaption     - the author left the copy to a human and nobody has written it
 *   tooSoon          - past, or inside Facebook's ten-minute floor
 *   tooFar           - further ahead than our two-day lead; re-offered by a later pass
 *   crashed          - claimed but never closed out; reconcile by hand, never re-send
 */
export function selectSchedulable({ manifest, ledger, now }) {
  const out = { toSchedule: [], alreadyScheduled: [], needsCaption: [], tooSoon: [], tooFar: [], crashed: [] }

  for (const post of manifest.posts) {
    if (!AUTHORING_PASS.has(post.strategy)) continue

    const state = latestState(ledger, post.id)
    if (state === 'scheduled') {
      out.alreadyScheduled.push(post)
      continue
    }
    if (state === 'claimed') {
      out.crashed.push(post)
      continue
    }
    if (state && TERMINAL.has(state)) continue

    if (typeof post.caption !== 'string' || !post.caption.trim()) {
      out.needsCaption.push(withReason(post, 'the caption is still the human’s to write'))
      continue
    }

    const when = Date.parse(post.publishAt)
    const lead = when - now.getTime()
    if (lead < SCHEDULE_FLOOR_MS) {
      const reason =
        lead <= 0
          ? `${post.publishAt} has already passed`
          : `${post.publishAt} is inside Facebook’s ten-minute floor`
      out.tooSoon.push(withReason(post, reason))
      continue
    }
    if (lead > SCHEDULE_CEILING_MS) {
      out.tooFar.push(withReason(post, `${post.publishAt} is further out than the two-day lead`))
      continue
    }

    out.toSchedule.push(post)
  }

  out.toSchedule.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id))
  return out
}
