/**
 * Which posts a routine should act on right now.
 *
 * Pure functions over (manifest, ledger, clock) so the whole scheduler can be
 * tested offline with no account and no network. The publisher does no other
 * reasoning about time.
 */

/** States that close a post out. Anything else means work may still be owed. */
const TERMINAL = new Set(['published', 'drafted', 'failed', 'skipped'])

/**
 * Facebook feed posts and text posts are scheduled natively by Meta, and TikTok
 * drafts have no publish time at all, so all three are handled during the
 * authoring pass. Only these wait for a routine.
 *
 * `tiktok-direct` was listed here and should not have been: route.mjs throws for every strategy
 * beginning with `tiktok`, so such a post was claimed, failed, and landed in the ledger as
 * `failed` - terminal, and therefore never retried. Unreachable today because plan.mjs only ever
 * emits `tiktok-draft`, but it was a trap laid for whoever turns Direct Post on.
 *
 * TO ENABLE DIRECT POST once TikTok approves the app and grants `video.publish`: add
 * 'tiktok-direct' back here, give route.mjs a branch for it, and teach publish.mjs to obtain a
 * token. That last part is the real work - the refresh token rotates on nearly every use and
 * retires the one you sent, so the routine must persist the new one before it publishes anything.
 */
const ROUTINE_FIRED = new Set(['fb-story', 'ig-feed', 'ig-story', 'ig-reel'])

/**
 * How late a post may be and still be worth publishing. Six hours lets the next
 * routine of the day cover for one that failed. Time-critical posts (a deadline
 * reminder) should set a tighter `maxLatenessMinutes` on the post itself.
 */
const DEFAULT_MAX_LATENESS_MINUTES = 360

export const isTerminal = (state) => TERMINAL.has(state)

/** The most recent recorded state for a post id, or null if it has none. */
export function latestState(ledger, id) {
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    if (ledger[i].id === id) return ledger[i].state
  }
  return null
}

const minutes = (n) => n * 60 * 1000

/**
 * @param {{manifest: object, ledger: Array<{id: string, state: string}>, now: Date}} input
 * @returns {{due: object[], skipped: object[], crashed: object[], needsCaption: object[]}}
 *   due          - publish these, in order
 *   skipped      - too late to be worth publishing; record and alert
 *   crashed      - claimed but never closed out; reconcile against the platform, never re-post
 *   needsCaption - no caption yet; hold, and stay publishable once one is written
 */
export function selectDue({ manifest, ledger, now }) {
  const due = []
  const skipped = []
  const crashed = []
  const needsCaption = []

  const published = new Set(
    manifest.posts.filter((p) => latestState(ledger, p.id) === 'published').map((p) => p.id),
  )

  for (const post of manifest.posts) {
    if (!ROUTINE_FIRED.has(post.strategy)) continue

    const state = latestState(ledger, post.id)
    if (state && isTerminal(state)) continue
    if (state === 'claimed') {
      crashed.push(post)
      continue
    }

    // The backstop for schedule-plan.mjs's own caption check. Every kind is templated since
    // 2026-09-02 so this should never fire, which is exactly why it must: instagram.mjs sends
    // `post.caption ?? ''`, so a lookup that returned nothing would publish a bare image.
    // No ledger record — the post stays publishable the moment a caption exists.
    if (typeof post.caption !== 'string' || !post.caption.trim()) {
      needsCaption.push(post)
      continue
    }

    const when = new Date(post.publishAt)
    if (now < when) continue

    const budget = minutes(post.maxLatenessMinutes ?? DEFAULT_MAX_LATENESS_MINUTES)
    if (now.getTime() - when.getTime() >= budget) {
      skipped.push(post)
      continue
    }

    // A two-step post (upload, then publish as a story) waits for its first half.
    if (post.dependsOn && !published.has(post.dependsOn)) continue

    due.push(post)
  }

  due.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt))
  return { due, skipped, crashed, needsCaption }
}
