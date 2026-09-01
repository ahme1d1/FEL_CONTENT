/**
 * Data in, a `source` block out — the exact shape `render-plan.mjs` turns into a render job.
 *
 * Pure. Every filler here obeys three rules that are not obvious and are expensive to break:
 *
 * 1. **Write every slot the card uses.** An unwritten slot keeps the design's sample value, and
 *    those samples are live copy: `K_NOTICE`'s default hero says «الديدلاين ساعتين قبل», which is
 *    a forbidden claim (`content-design-kit.md` §5) that would ship as a real post.
 * 2. **Pick the row variant that fits the data** rather than blanking spare rows. Where no variant
 *    fits, refuse — a card with a leftover sample fixture on it is worse than no card.
 * 3. **Pass `keepNames: true` wherever an asset's nameSlot is not a club name.** Changing a crest
 *    auto-writes the club name into that slot, which destroys a player's name, a score or a price.
 *
 * Slot indices are written out rather than derived from `card-slot-maps.md`, because that file is
 * prose. `tests/author-cards.test.mjs` reads it and fails if any index here has moved.
 */

import { COPY, gameweekLabel, kickoffTime, deadlinePhrase } from './labels.mjs'
import { shortName } from './names.mjs'

const { cards: TEXT } = COPY

/** `A_MATCHDAY_{n}_rows` exists only for these counts; `ROW_VARIANTS` in build-cards.py is the source. */
const MATCHDAY_ROWS = [2, 3, 4, 8]

const asText = (value) => String(value)

function assertRows(kind, n, allowed) {
  if (!allowed.includes(n)) {
    throw new Error(`No ${kind} card has ${n} rows. Built variants: ${allowed.join(', ')}.`)
  }
}

/* ─────────────────────────── fixtures ─────────────────────────── */

/**
 * Today's fixtures. Three slots per row from t2 — home, kickoff, away — and two crests per row.
 * RTL puts the first slot on the right, which is the HOME team.
 */
export function matchdayCard({ gameweek, fixtures }) {
  if (fixtures.length === 1) return singleMatchCard({ gameweek, fixture: fixtures[0] })
  assertRows('matchday', fixtures.length, MATCHDAY_ROWS)

  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.matchdayTitle }
  const assets = {}
  fixtures.forEach((f, i) => {
    texts[2 + 3 * i] = f.homeClub.short
    texts[3 + 3 * i] = kickoffTime(f.kickoffAt)
    texts[4 + 3 * i] = f.awayClub.short
    assets[2 * i] = f.home
    assets[2 * i + 1] = f.away
  })

  return { card: `A_MATCHDAY_${fixtures.length}_rows`, slug: 'matchday', texts, assets }
}

/**
 * Today's results. Five slots per row from t2 — home, home score, a locked dash, away score,
 * away — so the score slots straddle a separator that must never be written to.
 */
export function resultsCard({ gameweek, fixtures }) {
  if (fixtures.length === 1) return singleMatchCard({ gameweek, fixture: fixtures[0] })
  assertRows('results', fixtures.length, [2, 3, 4])

  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.resultsTitle }
  const assets = {}
  fixtures.forEach((f, i) => {
    texts[2 + 5 * i] = f.homeClub.short
    texts[3 + 5 * i] = asText(f.homeScore)
    texts[5 + 5 * i] = asText(f.awayScore)
    texts[6 + 5 * i] = f.awayClub.short
    assets[2 * i] = f.home
    assets[2 * i + 1] = f.away
  })

  const card = fixtures.length === 4 ? 'B_RESULTS' : `B_RESULTS_${fixtures.length}_rows`
  return { card, slug: 'results', texts, assets }
}

/**
 * One match, before or after it is played. `keepNames` because the crests' nameSlots point at the
 * two SCORE slots, not at club names.
 */
export function singleMatchCard({ gameweek, fixture }) {
  const played = fixture.status === 'FINISHED'
  return {
    card: 'C_SINGLE_MATCH',
    slug: 'match',
    keepNames: true,
    texts: {
      0: gameweekLabel(gameweek),
      1: played ? asText(fixture.homeScore) : '',
      3: played ? asText(fixture.awayScore) : '',
      4: fixture.homeClub.short,
      5: fixture.awayClub.short,
      6: played ? TEXT.matchFinished : kickoffTime(fixture.kickoffAt),
    },
    assets: { 0: fixture.home, 1: fixture.away },
  }
}

/* ─────────────────────────── the round itself ─────────────────────────── */

export function deadlineCard({ gameweek, deadline }) {
  return {
    card: 'H_DEADLINE',
    slug: 'deadline',
    texts: {
      0: gameweekLabel(gameweek),
      1: deadlinePhrase(deadline),
      2: TEXT.deadlineSubtitle,
    },
    assets: {},
  }
}

/** One fact, large. The card is the hook; `hero` must stay under ~16 characters or it wraps. */
export function statCard({ gameweek, hero, support }) {
  if (hero.length > 16) throw new Error(`STAT hero "${hero}" is ${hero.length} chars; it wraps past 16.`)
  return {
    card: 'D_STAT',
    slug: 'stat',
    texts: { 0: gameweekLabel(gameweek), 1: hero, 2: support },
    assets: {},
  }
}

/**
 * The build-up post, days before the round opens: the deadline as one large fact.
 *
 * A STAT card rather than the next round's fixtures, because ten fixtures do not fit any built
 * matchday variant, and rather than H_DEADLINE, because that card runs again on the day itself
 * and two identical images three days apart read as a repost. `gw01-day2.md` set the precedent:
 * hero is the time, support names what the time is.
 */
export function buildUpCard({ gameweek, deadline }) {
  return {
    ...statCard({ gameweek, hero: deadlinePhrase(deadline), support: TEXT.deadlineWord }),
    slug: 'buildup',
  }
}

/** Four captain candidates. `keepNames` because each crest's nameSlot holds a PLAYER's name. */
export function questionCard({ gameweek, players }) {
  if (players.length !== 4) throw new Error(`The question card takes 4 players, got ${players.length}.`)
  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.questionTitle }
  const assets = {}
  players.forEach((p, i) => {
    texts[2 + i] = shortName(p.name)
    assets[i] = p.club
  })
  return { card: 'J_QUESTION', slug: 'question', keepNames: true, texts, assets }
}

/* ─────────────────────────── players ─────────────────────────── */

/** Three slots per row from t1 — rank, name, points — with the crest beside the points slot. */
export function topPlayersCard({ players }) {
  const rows = players.length >= 10 ? 10 : 3
  if (players.length < 3) throw new Error(`The top-players card needs 3 or 10 rows, got ${players.length}.`)

  const texts = { 0: TEXT.topPlayersTitle }
  const assets = {}
  players.slice(0, rows).forEach((p, i) => {
    texts[1 + 3 * i] = asText(i + 1)
    texts[2 + 3 * i] = shortName(p.name)
    texts[3 + 3 * i] = asText(p.points)
    assets[i] = p.club
  })

  return {
    card: `F1_TOP_PLAYERS_${rows}_rows`,
    slug: 'top-players',
    keepNames: true,
    texts,
    assets,
  }
}

/** The round's best player, without a photo — the 192x200 portraits cannot fill a 520px hero. */
export function playerOfRoundCard({ player }) {
  return {
    card: 'G_NO_PHOTO_FALLBACK',
    slug: 'player',
    keepNames: true,
    texts: {
      0: TEXT.playerOfRoundTitle,
      1: shortName(player.name),
      2: player.clubShort,
      3: asText(player.points),
      4: TEXT.pointsWord,
    },
    assets: { 0: player.club },
  }
}

/** Two slots per pitch position from t2 — points then name — and one shirt per player. */
const FORMATIONS = [
  { card: 'M_TEAM_OF_THE_WEEK_4_4_2', shape: { FWD: 2, MID: 4, DEF: 4 } },
  { card: 'M_TEAM_OF_THE_WEEK_5_2_3', shape: { FWD: 3, MID: 2, DEF: 5 } },
]

/** Top of the pitch downwards, which is the order the slots run in. */
const PITCH_ORDER = ['FWD', 'MID', 'DEF']

function bestXi(players, shape) {
  const keeper = players.find((p) => p.pos === 'GK')
  if (!keeper) return null

  const picked = []
  for (const pos of PITCH_ORDER) {
    const forPos = players.filter((p) => p.pos === pos).slice(0, shape[pos])
    if (forPos.length < shape[pos]) return null
    picked.push(...forPos)
  }
  picked.push(keeper)

  return { xi: picked, total: picked.reduce((sum, p) => sum + p.points, 0) }
}

/**
 * The best legal XI of the round.
 *
 * A pure top eleven does not fit a pitch, so both shipped formations are filled and the one that
 * scores more wins — the rule in `posting-runbook.md` §3, where GW1 came out 4-4-2 112 to 5-2-3
 * 111. Ties keep 4-4-2, so the same data always renders the same bytes.
 */
export function teamOfWeekCard({ gameweek, players }) {
  const ranked = [...players].sort((a, b) => b.points - a.points || a.playerId - b.playerId)

  let best = null
  for (const formation of FORMATIONS) {
    const built = bestXi(ranked, formation.shape)
    if (built && (!best || built.total > best.total)) best = { ...built, card: formation.card }
  }
  if (!best) throw new Error('No shipped formation can be filled from these players.')

  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.teamOfWeekTitle }
  const assets = {}
  best.xi.forEach((p, i) => {
    texts[2 + 2 * i] = asText(p.points)
    texts[3 + 2 * i] = shortName(p.name)
    assets[i] = p.club
  })

  return { card: best.card, slug: 'totw', keepNames: true, texts, assets }
}

/**
 * The direction arrow and its colour are BAKED INTO EACH ROW of the design, exactly like the
 * badge colours on the fixture-difficulty cards. They are not derived from the two numbers, so a
 * riser dropped into row 4 renders with a red ▼ beside a price that went up.
 *
 * Verified from a render, because it is invisible in the JSON: the design's own sample runs
 * up, up, up, down, down, up, down, up. The data has to be arranged to match it.
 */
const PRICE_ROW_RISES = [true, true, true, false, false, true, false, true]

const RISERS_NEEDED = PRICE_ROW_RISES.filter(Boolean).length
const FALLERS_NEEDED = PRICE_ROW_RISES.length - RISERS_NEEDED

/**
 * Eight price moves. Four slots per row from t1 — name, old price, a fixed arrow, new price.
 * `keepNames` because each crest's nameSlot points at the old-price slot.
 *
 * Refuses rather than mismatching an arrow: five risers and three fallers, or no card.
 */
export function priceChangesCard({ changes }) {
  const risers = changes.filter((c) => c.change > 0)
  const fallers = changes.filter((c) => c.change < 0)

  if (risers.length < RISERS_NEEDED || fallers.length < FALLERS_NEEDED) {
    throw new Error(
      `The prices card needs ${RISERS_NEEDED} risers and ${FALLERS_NEEDED} fallers to match its ` +
        `fixed arrows, got ${risers.length} and ${fallers.length}.`,
    )
  }

  const texts = { 0: TEXT.pricesTitle }
  const assets = {}
  PRICE_ROW_RISES.forEach((rises, i) => {
    const c = (rises ? risers : fallers).shift()
    texts[1 + 4 * i] = shortName(c.name)
    texts[2 + 4 * i] = (c.price - c.change).toFixed(1)
    texts[4 + 4 * i] = c.price.toFixed(1)
    assets[i] = c.club
  })

  return { card: 'F3_PRICE_CHANGES', slug: 'prices', keepNames: true, texts, assets }
}

/* ─────────────────────────── managers and clubs ─────────────────────────── */

/**
 * The round's top three managers.
 *
 * Four slots per row from t2 — rank, team name, manager name, points. A team name is user input,
 * so this is the one card whose diff must be read before it renders; the runbook has the GW1
 * example (`فريقالاهليي في FEL`).
 */
export function podiumCard({ gameweek, rows }) {
  if (rows.length !== 3) throw new Error(`The podium card takes 3 managers, got ${rows.length}.`)

  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.podiumTitle }
  rows.forEach((r, i) => {
    texts[2 + 4 * i] = asText(i + 1)
    texts[3 + 4 * i] = r.teamName
    texts[4 + 4 * i] = r.name
    texts[5 + 4 * i] = asText(r.gwPts)
  })

  return { card: 'E_PODIUM', slug: 'podium', texts, assets: {} }
}

/** The top eight of the league. Four slots per row from t3 — rank, club, played, points. */
export function leagueTableCard({ rows }) {
  if (rows.length < 8) throw new Error(`The table card takes 8 rows, got ${rows.length}.`)

  const texts = { 0: TEXT.leagueTableTitle, 1: TEXT.leagueTablePlayed, 2: TEXT.leagueTablePoints }
  const assets = {}
  rows.slice(0, 8).forEach((r, i) => {
    texts[3 + 4 * i] = asText(i + 1)
    texts[4 + 4 * i] = r.clubShort
    texts[5 + 4 * i] = asText(r.p)
    texts[6 + 4 * i] = asText(r.pts)
    assets[i] = r.club
  })

  return { card: 'F2_LEAGUE_TABLE', slug: 'table', texts, assets }
}
