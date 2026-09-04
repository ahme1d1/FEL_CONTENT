/**
 * Is anything owed that has not gone out?
 *
 * Pure functions over (manifests, ledger, clock), like due.mjs, so the alarm can be tested
 * offline with no account and no network.
 *
 * WHY THIS EXISTS. Two failures here are silent. A workflow that FAILS is caught by the
 * `if: failure()` step on author.yml and publish.yml. A workflow that NEVER RAN is not — and on
 * 2026-09-04 GitHub ran publish.yml not at all between 01:21Z and 13:22Z, putting four Instagram
 * posts out together with the first 4h23 late. Nothing said so.
 *
 * IT ASKS selectDue RATHER THAN THE LEDGER'S AGE. The obvious watchdog — "the newest ledger
 * entry is older than N hours" — cries wolf every morning, because on a day with nothing
 * scheduled the ledger legitimately does not move. Asking selectDue means there is exactly one
 * definition of "late" in this repo and the alarm cannot drift away from what the publisher
 * actually does.
 */

import { selectDue } from './due.mjs'

/**
 * How late the oldest unsent post may be before this is worth waking someone for.
 *
 * due.mjs deletes a post at 360 minutes (`skipped`, terminal). Ninety leaves four and a half
 * hours to notice, look, and dispatch by hand — and is comfortably longer than the gap between
 * two ticks of a five-minute clock, so an ordinary slow run never trips it.
 */
export const BACKLOG_GRACE_MINUTES = 90

const MS_PER_MINUTE = 60 * 1000

const lateMinutes = (post, now) =>
  Math.floor((now.getTime() - new Date(post.publishAt).getTime()) / MS_PER_MINUTE)

/** The fields an alarm needs; deliberately a new object, so nothing upstream is shared out. */
const describe = (post, gameweek, now) => ({
  id: post.id,
  gameweek,
  strategy: post.strategy,
  publishAt: post.publishAt,
  lateMinutes: lateMinutes(post, now),
})

const byLatestFirst = (a, b) => b.lateMinutes - a.lateMinutes

/**
 * @param {{manifests: object[], ledger: object[], now: Date, maxBacklogMinutes?: number}} input
 * @returns {{ok: boolean, alarms: object[], heldForCaption: object[], summary: string}}
 *   alarms         - what to shout about, worst kind first
 *   heldForCaption - reported for the log, never an alarm: recoverable and self-healing
 */
export function assess({ manifests, ledger, now, maxBacklogMinutes = BACKLOG_GRACE_MINUTES }) {
  const backlog = []
  const lost = []
  const stuck = []
  const heldForCaption = []

  for (const manifest of manifests) {
    const { due, skipped, crashed, needsCaption } = selectDue({ manifest, ledger, now })
    const gw = manifest.gameweek

    for (const post of due) {
      if (lateMinutes(post, now) > maxBacklogMinutes) backlog.push(describe(post, gw, now))
    }
    for (const post of skipped) lost.push(describe(post, gw, now))
    for (const post of crashed) stuck.push(describe(post, gw, now))
    for (const post of needsCaption) heldForCaption.push(describe(post, gw, now))
  }

  const alarms = []

  // Worst first. A lost post is already gone and nothing will bring it back; a backlog is still
  // recoverable; a stuck one is a reconciliation, not an outage.
  if (lost.length) {
    alarms.push({
      kind: 'lost',
      headline: `${lost.length} post(s) passed the lateness budget and will NEVER be sent`,
      posts: lost.sort(byLatestFirst),
    })
  }
  if (backlog.length) {
    alarms.push({
      kind: 'backlog',
      headline: `${backlog.length} post(s) more than ${maxBacklogMinutes} minutes late — the clock has stopped`,
      posts: backlog.sort(byLatestFirst),
    })
  }
  if (stuck.length) {
    alarms.push({
      kind: 'stuck',
      headline: `${stuck.length} post(s) claimed but never closed out — reconcile by hand, do NOT re-post`,
      posts: stuck.sort(byLatestFirst),
    })
  }

  return {
    ok: alarms.length === 0,
    alarms,
    heldForCaption,
    summary: summarise(alarms, heldForCaption, now),
  }
}

const line = (p) => `- \`${p.id}\` (gw${p.gameweek}, ${p.strategy}) due ${p.publishAt} — ${p.lateMinutes} min late`

/** Markdown, because its one consumer pastes it straight into a GitHub issue. */
export function summarise(alarms, heldForCaption, now) {
  if (!alarms.length) {
    const held = heldForCaption.length ? ` ${heldForCaption.length} held for a caption.` : ''
    return `Nothing owed at ${now.toISOString()}.${held}`
  }

  const parts = alarms.map((a) => `**${a.headline}**\n${a.posts.map(line).join('\n')}`)
  if (heldForCaption.length) {
    parts.push(`Held for a caption (not an alarm, publishes once one exists):\n${heldForCaption.map(line).join('\n')}`)
  }
  return `Checked at ${now.toISOString()}.\n\n${parts.join('\n\n')}`
}
