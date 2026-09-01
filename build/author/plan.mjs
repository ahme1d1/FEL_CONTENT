/**
 * The week's plan: a content window plus live data becomes the posts a manifest carries.
 *
 * Pure, so the whole calendar can be exercised with no clock, no network and no browser. It
 * decides only what `validateManifest` and `posting-runbook.md` already constrain — the slot, the
 * card, the caption, the id — and leaves `media` null for `render-manifest.mjs` to stamp.
 *
 * Anything it cannot author it SKIPS and reports rather than guessing. Most of the time that is a
 * results card for a day that has not been played yet, which is not a failure: the runbook's own
 * loop is to schedule everything that needs no scores, then come back.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sourceKey } from '../render-plan.mjs'
import { slotInstant } from './slots.mjs'
import { captionBrief, captionFor } from './captions.mjs'
import {
  buildUpCard,
  deadlineCard,
  leagueTableCard,
  matchdayCard,
  playerOfRoundCard,
  podiumCard,
  priceChangesCard,
  questionCard,
  resultsCard,
  teamOfWeekCard,
  topPlayersCard,
} from './cards.mjs'

export const CALENDAR = JSON.parse(
  readFileSync(fileURLToPath(new URL('./calendar.json', import.meta.url)), 'utf8'),
)

/** How each platform's post is made, and what its id ends with. */
const PLATFORMS = {
  facebook: { strategy: 'fb-scheduled', suffix: 'fb-feed' },
  instagram: { strategy: 'ig-feed', suffix: 'ig-feed' },
  tiktok: { strategy: 'tiktok-draft', suffix: 'tiktok' },
}

const gwTag = (gw) => `gw${String(gw).padStart(2, '0')}`
export const mediaBaseFor = (gw) => `https://media.fantasyeg.com/${gwTag(gw)}`

/** A day holds one calendar role even when it wears several hats; the busiest wins. */
export function primaryRole(day) {
  if (day.roles.includes('buildUp')) return 'buildUp'
  if (day.roles.includes('settle')) return 'settleDay'
  if (day.roles.includes('deadline')) return 'deadlineDay'
  if (day.roles.includes('match')) return 'matchDay'
  return 'middle'
}

/** Reads better in a skip line than a TypeError from three frames down. */
function need(value, what) {
  const empty = value == null || (Array.isArray(value) && value.length === 0)
  if (empty) throw new Error(`no ${what} available yet`)
  return value
}

const BUILDERS = {
  buildUp: ({ window }) => buildUpCard({ gameweek: window.gameweek, deadline: window.deadline }),

  deadline: ({ window }) => deadlineCard({ gameweek: window.gameweek, deadline: window.deadline }),

  matchday: ({ window, day }) =>
    matchdayCard({ gameweek: window.gameweek, fixtures: need(day.fixtures, 'fixtures') }),

  // The runbook is explicit: check EVERY fixture that day reads FINISHED before rendering.
  // A results card with a blank score is the one mistake nobody forgives.
  results: ({ window, day }) => {
    const fixtures = need(day.fixtures, 'fixtures')
    const unplayed = fixtures.filter((f) => f.status !== 'FINISHED')
    if (unplayed.length) {
      throw new Error(`${unplayed.length} of ${fixtures.length} fixtures that day are not finished`)
    }
    return resultsCard({ gameweek: window.gameweek, fixtures })
  },

  question: ({ window, data }) =>
    questionCard({
      gameweek: window.gameweek,
      players: need(data.captainCandidates, 'captain candidates').slice(0, 4),
    }),

  leagueTable: ({ data }) => leagueTableCard({ rows: need(data.standings, 'league table') }),

  podium: ({ window, data }) =>
    podiumCard({ gameweek: window.gameweek, rows: need(data.gwStandings, 'gameweek board').slice(0, 3) }),

  playerOfRound: ({ data }) => playerOfRoundCard({ player: need(data.topPlayers, 'gameweek points')[0] }),

  teamOfWeek: ({ window, data }) =>
    teamOfWeekCard({ gameweek: window.gameweek, players: need(data.topPlayers, 'gameweek points') }),

  topPlayers: ({ data }) => topPlayersCard({ players: need(data.topPlayers, 'gameweek points') }),

  priceChanges: ({ data }) => priceChangesCard({ changes: need(data.priceChanges, 'price moves') }),
}

/**
 * @param {{window: object, data: object, authoredAt: string, calendar?: object}} input
 * @returns {{posts: object[], skipped: Array<{id: string, reason: string}>}}
 */
export function planPosts({ window, data, authoredAt, calendar = CALENDAR }) {
  const posts = []
  const skipped = []

  for (const day of window.days) {
    const entries = calendar.days[primaryRole(day)] ?? []

    for (const entry of entries) {
      const { publishAt, slotCairo } = slotInstant(day.date, entry.slot)
      const idPrefix = `${gwTag(window.gameweek)}-d${day.index}-${entry.slot.replace(':', '')}`

      // publishAt must be after authoredAt or the manifest is invalid. Re-authoring mid-round is
      // normal, so a slot that has already gone is expected, not an error.
      if (Date.parse(publishAt) <= Date.parse(authoredAt)) {
        skipped.push({ id: idPrefix, reason: `${slotCairo} has already passed` })
        continue
      }

      let source
      try {
        source = BUILDERS[entry.card]({ window, day, data })
      } catch (err) {
        skipped.push({ id: idPrefix, reason: `${entry.card}: ${err.message}` })
        continue
      }

      for (const platform of entry.platforms) {
        const { strategy, suffix } = PLATFORMS[platform]
        const caption = captionFor({
          kind: entry.kind,
          platform,
          gameweek: window.gameweek,
          dayIndex: day.index,
        })

        posts.push({
          id: `${idPrefix}-${suffix}`,
          publishAt,
          slotCairo,
          platform,
          strategy,
          media: null,
          source,
          caption,
          // Travels with the post so the ask survives the handoff to whoever writes the copy.
          ...(caption === null ? { captionBrief: captionBrief(entry.kind) } : {}),
          // One link a gameweek, on the build-up post. Facebook only: Instagram and TikTok do not
          // make a link clickable, and the linter rejects one in their captions.
          link: entry.carriesLink && platform === 'facebook' ? calendar.link : null,
          dependsOn: null,
          ...(entry.maxLatenessMinutes ? { maxLatenessMinutes: entry.maxLatenessMinutes } : {}),
        })
      }
    }
  }

  posts.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id))
  return { posts, skipped }
}

/** The manifest envelope. `media` stays null until `render-manifest.mjs` stamps it. */
export function buildManifest({ gameweek, authoredAt, posts }) {
  return {
    schemaVersion: 1,
    gameweek,
    authoredAt,
    mediaBase: mediaBaseFor(gameweek),
    posts,
  }
}

/**
 * Fold a fresh plan into a manifest that already exists.
 *
 * Re-authoring mid-round is the normal loop, not an exception: everything that needs no scores is
 * scheduled first, and the results cards are added a day at a time. So an existing post always
 * wins — it may already carry stamped `media` and a human's caption, and overwriting either would
 * silently unrender it or throw the copy away.
 *
 * Identity is `sourceKey`, the same order-insensitive comparison the renderer dedupes on. A post
 * whose source has changed under us is REPORTED rather than quietly replaced: that is the failure
 * from 2026-08-26, when a deadline moved an hour and two already-queued posts stayed wrong.
 *
 * @returns {{posts: object[], added: string[], drifted: string[]}}
 */
export function mergePosts({ existing = [], fresh = [], refresh = false }) {
  const freshById = new Map(fresh.map((p) => [p.id, p]))
  const merged = []
  const drifted = []

  for (const prior of existing) {
    const next = freshById.get(prior.id)
    // No fresh twin means its slot has passed or its data is gone. It may already be published.
    if (!next || sourceKey(prior.source) === sourceKey(next.source)) {
      merged.push(prior)
      continue
    }
    drifted.push(prior.id)
    merged.push(refresh ? next : prior)
  }

  const known = new Set(existing.map((p) => p.id))
  const added = fresh.filter((p) => !known.has(p.id))
  merged.push(...added)
  merged.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id))

  return { posts: merged, added: added.map((p) => p.id), drifted }
}
