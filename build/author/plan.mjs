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
import { anchoredInstant, slotInstant } from './slots.mjs'
import { captionBrief, captionFor } from './captions.mjs'
import { deadlinePhrase, gameweekLabel } from './labels.mjs'
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
  winnerCard,
  buildUpCardStory,
  deadlineCardStory,
  matchdayCardStory,
  questionCardStory,
  resultsCardStory,
  winnerCardStory,
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

/**
 * «ماتش واحد» · «ماتشين» · «3 ماتشات».
 *
 * Arabic counts one and two in the noun rather than the numeral, so a naive `${n} ماتشات` would
 * publish «1 ماتشات» on any single-fixture day — and GW3 has one of those tomorrow.
 */
export function matchCount(n) {
  if (n === 1) return 'ماتش واحد'
  if (n === 2) return 'ماتشين'
  return `${n} ماتشات`
}

/** «الماتش ده» · «الماتشين دول» · «الماتشات دي» — the demonstrative agrees with the count too. */
export function theseMatches(n) {
  if (n === 1) return 'الماتش ده'
  if (n === 2) return 'الماتشين دول'
  return 'الماتشات دي'
}

/**
 * «ساعة» · «ساعتين» · «6 ساعات» — how long is left before the deadline, from a given slot.
 *
 * Computed, never written down. «الديدلاين كمان ساعتين» is true of a 14:00 post against a 16:00
 * deadline and false of the same post in GW18, whose deadline is 20:30. The runbook records
 * exactly this going wrong: on 2026-08-26 a queued card still read «فاضل ساعة» after the deadline
 * moved. Floored, so the number is never larger than the time actually remaining.
 */
export function hoursUntil(fromIso, deadlineIso) {
  const hours = Math.floor((Date.parse(deadlineIso) - Date.parse(fromIso)) / 3_600_000)
  if (hours <= 1) return 'ساعة'
  if (hours === 2) return 'ساعتين'
  return `${hours} ساعات`
}

/** «جولة» · «جولتين» · «3 جولات», for «ترتيب الدوري بعد جولتين». */
export function roundCount(n) {
  if (n === 1) return 'جولة'
  if (n === 2) return 'جولتين'
  return `${n} جولات`
}

/**
 * The real values a caption interpolates, per day.
 *
 * This is what separates the house style from filler. «3 ماتشات النهاردة» is about today;
 * «يوم كامل كورة قدامك» would have been equally true of any day of any round, which is exactly
 * why it read as written by nobody.
 */
function captionVars({ window: w, day, data, publishAt }) {
  const roundFixtures = data.fixtures ?? []
  const finishedInRound = roundFixtures.filter((f) => f.status === 'FINISHED').length
  const left = Math.max(0, roundFixtures.length - finishedInRound)

  return {
    matches: matchCount(day.fixtures.length),
    these: theseMatches(day.fixtures.length),
    played: matchCount(day.fixtures.length),
    remaining: matchCount(left),
    // «ترتيب الدوري بعد جولتين» — the rounds already played, not the one being authored.
    rounds: roundCount(Math.max(0, w.gameweek - 1)),
    deadline: deadlinePhrase(w.deadline),
    untilDeadline: hoursUntil(publishAt, w.deadline),
    gw: gameweekLabel(w.gameweek),
    // The prize caption is «مبروك يا مراد 🏆» — the one caption that names a person on purpose,
    // because congratulating nobody in particular is not a congratulation. Undefined until the
    // round settles, which is fine: the winner post is skipped until then, so no template that
    // uses it is ever reached with it missing.
    winner: data.gwStandings?.[0]?.name,
  }
}

/** A day holds one calendar role even when it wears several hats; the busiest wins. */
export function primaryRole(day) {
  if (day.roles.includes('buildUp')) return 'buildUp'
  if (day.roles.includes('settle')) return 'settleDay'
  if (day.roles.includes('deadline')) return 'deadlineDay'
  if (day.roles.includes('match')) return 'matchDay'
  return 'middle'
}

/**
 * The round's last day with fixtures.
 *
 * Its matchday and results posts have to read differently, because on that day nothing is still to
 * come: the generic matchday caption promises «خلي بالك من اللي لسه جاي» and the generic results
 * caption says «الجولة لسه ماخلصتش», and both are false once the last ball is kicked.
 */
export const lastMatchDate = (days) =>
  days
    .filter((d) => d.roles.includes('match'))
    .map((d) => d.date)
    .sort()
    .at(-1) ?? null

/** Kinds that swap to a final-day variant on that date. Everything else reads the same either way. */
const FINAL_KIND = { matchday: 'matchdayFinal', results: 'resultsFinal' }

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

  // The table counts COMPLETED rounds — «ترتيب الدوري بعد 3 جولات» — so every fixture of the
  // previous round must be played before it can be authored. Authored mid-round it froze a table
  // showing two clubs on P2 under a caption claiming three, and mergePosts would have carried
  // that snapshot to its slot four days later.
  leagueTable: ({ data }) => {
    const unplayed = (data.previousFixtures ?? []).filter((f) => f.status !== 'FINISHED').length
    if (unplayed) throw new Error(`the previous round still has ${unplayed} fixture(s) to play`)
    return leagueTableCard({ rows: need(data.standings, 'league table') })
  },

  // Both of these name a champion, and BOTH must wait for settlement.
  //
  // `/gameweeks/:gw/standings` answers before a round settles, from live ranks — which is right for
  // a live board and wrong for a winner. Authoring early would stamp a provisional name, and
  // mergePosts keeps an existing post, so the wrong person would stay on the card through to
  // publication. `topPlayers` is the settlement signal: its endpoint 404s GAMEWEEK_NOT_SETTLED
  // until bonus points are entered, so its presence is the API's own "this round is final".
  winner: ({ window, data }) => {
    need(data.topPlayers, 'settled gameweek')
    return winnerCard({ gameweek: window.gameweek, winner: need(data.gwStandings, 'gameweek board')[0] })
  },

  podium: ({ window, data }) => {
    need(data.topPlayers, 'settled gameweek')
    return podiumCard({ gameweek: window.gameweek, rows: need(data.gwStandings, 'gameweek board').slice(0, 3) })
  },

  playerOfRound: ({ data }) => playerOfRoundCard({ player: need(data.topPlayers, 'gameweek points')[0] }),

  teamOfWeek: ({ window, data }) =>
    teamOfWeekCard({ gameweek: window.gameweek, players: need(data.topPlayers, 'gameweek points') }),

  topPlayers: ({ data }) => topPlayersCard({ players: need(data.topPlayers, 'gameweek points') }),

  priceChanges: ({ data }) => priceChangesCard({ changes: need(data.priceChanges, 'price moves') }),
}

/**
 * The vertical card a platform gets instead of the feed one, where a story card of fixed shape
 * exists. TikTok is a vertical surface and was being handed the same 4:5 image as Facebook.
 *
 * Matchday and results joined on 2026-09-02, once the design source was exported and build-cards.py
 * grew short row variants of both story cards. Before that they held eight and four rows against a
 * day that has three or four, and an unset row publishes the design's own sample fixture.
 *
 * A builder returning null means "no story layout for this shape" — a single-fixture day has none —
 * and the caller falls back to the feed image rather than inventing one.
 */
/** Shared by `results` and `resultsFinal`: the same card, a different caption register. */
const resultsStory = ({ window, day }) => {
  const fixtures = need(day.fixtures, 'fixtures')
  if (fixtures.some((f) => f.status !== 'FINISHED')) throw new Error('fixtures that day are not finished')
  return resultsCardStory({ gameweek: window.gameweek, fixtures })
}

const STORY_BUILDERS = {
  matchday: ({ window, day }) =>
    matchdayCardStory({ gameweek: window.gameweek, fixtures: need(day.fixtures, 'fixtures') }),

  matchdayFinal: ({ window, day }) =>
    matchdayCardStory({ gameweek: window.gameweek, fixtures: need(day.fixtures, 'fixtures') }),

  results: resultsStory,

  // Keyed on the FINAL kind (see FINAL_KIND), so a round's last matchday looks up `resultsFinal`
  // rather than `results`. Without this entry the lookup returned undefined and the post fell back
  // to the 1080x1350 feed card — silently, because `tiktok-draft` carries no aspect guard.
  resultsFinal: resultsStory,

  buildUp: ({ window }) => buildUpCardStory({ gameweek: window.gameweek, deadline: window.deadline }),
  deadline: ({ window }) => deadlineCardStory({ gameweek: window.gameweek, deadline: window.deadline }),
  question: ({ window, data }) =>
    questionCardStory({ gameweek: window.gameweek, players: need(data.captainCandidates, 'captain candidates').slice(0, 4) }),
  winner: ({ window, data }) => {
    need(data.topPlayers, 'settled gameweek')
    return winnerCardStory({ gameweek: window.gameweek, winner: need(data.gwStandings, 'gameweek board')[0] })
  },
}

/** Platforms that prefer a vertical card when one of fixed shape exists for the kind. */
const VERTICAL_PLATFORMS = new Set(['tiktok'])

/**
 * @param {{window: object, data: object, authoredAt: string, calendar?: object}} input
 * @returns {{posts: object[], skipped: Array<{id: string, reason: string}>}}
 */
export function planPosts({ window, data, authoredAt, calendar = CALENDAR }) {
  const posts = []
  const skipped = []

  const finalDate = lastMatchDate(window.days)

  for (const day of window.days) {
    const entries = calendar.days[primaryRole(day)] ?? []

    for (const entry of entries) {
      // Two ways a post gets its instant. A SLOTTED entry lands on one of the six calendar slots,
      // which is right for anything the calendar can predict — a matchday card in the morning, a
      // deadline reminder. An ANCHORED entry has no wall clock at all: it is authored on the first
      // pass that can build its card, and goes out `leadMinutes` later.
      //
      // Results are anchored because 22:30 was a guess about when football ends, and the guess lost
      // the race on every day of GW3 — the card cannot be built until every fixture that day reads
      // FINISHED, and by the time that was true the slot had gone, so the post was skipped as
      // `has already passed` three days running. `BUILDERS.results` refusing an unplayed day is now
      // the TRIGGER rather than a reason to miss a slot: it throws, the entry is skipped by name,
      // and the next pass tries again until the day is done.
      const anchored = Boolean(entry.anchor)
      const { publishAt, slotCairo } = anchored
        ? anchoredInstant(authoredAt, entry.leadMinutes)
        : slotInstant(day.date, entry.slot)

      // The id is `mergePosts`' key, so nothing in it may move between passes. A slotted id names
      // its slot; an anchored id names its KIND, because its instant is different every pass and a
      // time-derived id would mint a fresh duplicate each time instead of recognising itself.
      const idPrefix = anchored
        ? `${gwTag(window.gameweek)}-d${day.index}-${entry.kind}`
        : `${gwTag(window.gameweek)}-d${day.index}-${entry.slot.replace(':', '')}`

      // publishAt must be after authoredAt or the manifest is invalid. Re-authoring mid-round is
      // normal, so a slot that has already gone is expected, not an error. An anchored instant is
      // computed forward from `authoredAt`, so it is never in the past and never needs this.
      if (!anchored && Date.parse(publishAt) <= Date.parse(authoredAt)) {
        skipped.push({ id: idPrefix, reason: `${slotCairo} has already passed` })
        continue
      }

      // An anchored entry fires whenever its card becomes buildable, which for results means
      // "whenever the day finished". Without a cutoff that is also true of every day that finished
      // LAST week: the pass that first sees them would mint a results post for each and publish
      // three days of old scores twenty minutes from now. `staleAfterHours` measures from the day's
      // last kickoff, so a day the pipeline missed is dropped by name rather than posted late.
      if (anchored && entry.staleAfterHours) {
        const lastKickoff = Math.max(...(day.fixtures ?? []).map((f) => Date.parse(f.kickoffAt)))
        const ageHours = (Date.parse(authoredAt) - lastKickoff) / 3_600_000
        if (Number.isFinite(ageHours) && ageHours > entry.staleAfterHours) {
          skipped.push({
            id: idPrefix,
            reason: `too late — ${entry.kind} is ${Math.round(ageHours)}h past kickoff, over the ${entry.staleAfterHours}h limit`,
          })
          continue
        }
      }

      // Some cards read data that never stops moving — a league table, a rolling week of price
      // changes. A card is a SNAPSHOT and mergePosts keeps it, so authoring one days ahead
      // publishes what was true when it rendered under a caption written for the day it goes out.
      // `freshWithinHours` holds those back until the slot is close; the two-hourly loop picks
      // them up with time to spare.
      const freshMs = (entry.freshWithinHours ?? 0) * 3_600_000
      if (freshMs && Date.parse(publishAt) - Date.parse(authoredAt) > freshMs) {
        skipped.push({
          id: idPrefix,
          reason: `too early — ${entry.kind} is authored within ${entry.freshWithinHours}h of its slot`,
        })
        continue
      }

      let source
      try {
        source = BUILDERS[entry.card]({ window, day, data })
      } catch (err) {
        skipped.push({ id: idPrefix, reason: `${entry.card}: ${err.message}` })
        continue
      }

      const kind = day.date === finalDate ? (FINAL_KIND[entry.kind] ?? entry.kind) : entry.kind
      const vars = captionVars({ window, day, data, publishAt })

      for (const platform of entry.platforms) {
        const { strategy, suffix } = PLATFORMS[platform]

        // A vertical platform takes the story card where one exists. Its own `source` means
        // render-plan groups it separately, so the feed and story images both get rendered.
        const build = VERTICAL_PLATFORMS.has(platform) ? STORY_BUILDERS[kind] : null
        const platformSource = (build && build({ window, day, data })) || source
        const caption = captionFor({
          kind,
          platform,
          gameweek: window.gameweek,
          dayIndex: day.index,
          vars,
        })

        posts.push({
          id: `${idPrefix}-${suffix}`,
          publishAt,
          slotCairo,
          platform,
          strategy,
          // Travels in the manifest because the caption rules are per kind, not per platform:
          // validateManifest has to know whether this post is one of the ones allowed to ask a
          // question. It also saves every reader of a manifest re-deriving it from the card.
          kind,
          media: null,
          source: platformSource,
          caption,
          // Travels with the post so the ask survives the handoff to whoever writes the copy.
          ...(caption === null ? { captionBrief: captionBrief(kind) } : {}),
          // One link a gameweek, on the build-up post. Facebook only: Instagram and TikTok do not
          // make a link clickable, and the linter rejects one in their captions.
          link: entry.carriesLink && platform === 'facebook' ? calendar.link : null,
          dependsOn: null,
          // Travels with the post because `validateManifest` cannot otherwise tell an off-slot
          // instant from a mistake — an anchored post is exempt from the calendar-slot rule.
          ...(anchored ? { anchor: entry.anchor } : {}),
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
