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
import { cardName, shortName } from './names.mjs'

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

/**
 * How much room a name slot has, in characters.
 *
 * Only the WIDE cards get a budget; the shirt cards keep `shortName` outright, because the 284px
 * box design-kit rule 9 measured is theirs. Both numbers were set by rendering the card and
 * looking at it — change one the same way, not by reasoning about it.
 */
const ROW_NAME_MAX = 18
const HERO_NAME_MAX = 16

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
    texts[2 + 3 * i] = cardName(p.name, { maxChars: ROW_NAME_MAX })
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
  // `G_PLAYER_SPOTLIGHT` and `G_NO_PHOTO_FALLBACK` carry the SAME eight texts and one crest, and
  // differ only by a 520x520 photo hero — so the fallback is a real fallback, not a lesser card.
  // Which one we get is decided by whether the API had a photo for this player, nothing else.
  const photoUrl = typeof player.photoUrl === 'string' && player.photoUrl.trim() ? player.photoUrl.trim() : null
  return {
    card: photoUrl ? 'G_PLAYER_SPOTLIGHT' : 'G_NO_PHOTO_FALLBACK',
    slug: 'player',
    keepNames: true,
    ...(photoUrl ? { photoUrl } : {}),
    texts: {
      0: TEXT.playerOfRoundTitle,
      1: cardName(player.name, { maxChars: HERO_NAME_MAX }),
      2: player.clubShort,
      3: asText(player.points),
      4: TEXT.pointsWord,
    },
    assets: { 0: player.club },
  }
}

/**
 * Picking the eleven moved to the API on 2026-09-04 — `GET /gameweeks/:gw/team-of-week`.
 *
 * It was done here, from `top-players?limit=50`, and it failed on exactly the rounds this card is
 * most wanted for: GW3's top fifty held ONE forward, no shipped shape could be filled, and the
 * 16:00 slot went empty. A picker needs a per-position pool rather than a leaderboard, and the API
 * is where the whole field already lives. `FORMATIONS`, `bestXi` and the pitch order that lived
 * here are gone with it; the shapes are the rules engine's now, so the two cannot drift.
 */
export function teamOfWeekCard({ gameweek, team }) {
  // The API picks the side now — across every shape the rules engine admits, from the whole field
  // rather than a leaderboard. Assembling one here from `top-players` is what left GW3 with a
  // single forward, no fillable shape and an empty 16:00 slot. This renders what it was given.
  const players = team?.players
  if (!Array.isArray(players)) throw new Error('no gameweek team available yet')
  if (players.length !== 11) {
    throw new Error(`The team of the week is eleven players, got ${players.length}.`)
  }
  const card = `M_TEAM_OF_THE_WEEK_${String(team.formation).replace(/-/g, '_')}`
  if (!DRAWABLE_FORMATIONS.includes(team.formation)) {
    throw new Error(`No card template for a ${team.formation}; ask the API for ${DRAWABLE_FORMATIONS.join(', ')}.`)
  }
  const best = { xi: players, card }

  // Full names here as well, owner call 2026-09-05. This card used `shortName` outright while the
  // winner's pitch used a budget, so the same man from the same round printed two ways —
  // `أحمد سامى` on the winner card and `سامى` here. The budget is per LINE, because a five-wide
  // defensive line has a 164px box and a lone forward has 900px of column to sit in.
  const widths = lineWidths(team.formation)
  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.teamOfWeekTitle }
  const assets = {}
  best.xi.forEach((p, i) => {
    texts[2 + 2 * i] = asText(p.points)
    texts[3 + 2 * i] = cardName(p.name, { maxChars: SHIRT_NAME_MAX_BY_LINE[widths[i]] })
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

/**
 * The weekly prize post: who won the round, their score, and that a shirt is coming to them.
 *
 * This is the one post the audience is waiting for after a round settles, so the manager's name
 * is never dropped. The STAT hero wraps and collides past 16 characters, so a long name moves to
 * the support line under a «بطل الجولة» hero rather than being truncated — a person's name is not
 * something to cut in half.
 *
 * The card this SHOULD use is `P_WINNER_THEIR_TEAM_NO_CLUB_SET`, which shows the winner's whole XI
 * with the captain marked. It cannot be built here: that needs `GET /managers/:id/squad`, behind
 * `JwtAuthGuard`, and handing a publishing routine a manager's token is the worse trade.
 *
 * The name is a manager's own and goes on verbatim, exactly as it does on the podium.
 */
/**
 * The team-of-the-week formations we hold a card template for.
 *
 * The API picks across all eight shapes the rules engine admits; this repo can only DRAW the ones
 * with a template, so it is told which. Add a template, add it here — `M_TEAM_OF_THE_WEEK_<shape>`
 * is the naming rule.
 *
 * The WINNER card cannot be constrained this way and has its own list below: he played what he
 * played, and no query parameter changes it.
 */
export const DRAWABLE_FORMATIONS = [
  '3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1',
]

/**
 * The shapes the winner's pitch can draw, as `P_WINNER_THEIR_TEAM_NO_CLUB_SET_<shape>`.
 *
 * "NO CLUB SET" is not decoration in that name. `build-cards.py` gives any card whose name holds
 * WINNER but not NO CLUB a shirt hero: it finds the first square silhouette and replaces its
 * children, which on a pitch card is the first player's disc — costing one shirt, one points
 * badge and one captain marker. These variants are the same no-club family and keep the phrase.
 */
export const DRAWABLE_WINNER_FORMATIONS = [
  '3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1',
]

/** How many men stand in each line of a shape, forwards first and the keeper last. */
export function linesOf(formation) {
  const [def, mid, fwd] = String(formation).split('-').map(Number)
  return [fwd, mid, def, 1]
}

/**
 * The shape an eleven actually played, read off its own positions.
 *
 * The API sends `pos` on every player and never sends a formation for the winner — the note in
 * both repos is that none is needed, and this is why. Auto-subs preserve `XI_RULES`, so a settled
 * XI is always one of the eight the rules engine admits.
 */
export function formationOf(xi) {
  const n = (p) => xi.filter((x) => x.pos === p).length
  return `${n('DEF')}-${n('MID')}-${n('FWD')}`
}

/**
 * How much room a name has under a shirt, by how many men share the line.
 *
 * ONE NUMBER CANNOT DO THIS. The name box is `min(900/N - 16, 300)` px inside a fixed 900px well,
 * so it runs 300 / 300 / 284 / 209 / 164 as a line goes from one man to five, and the five-wide
 * line drops to a 22px face as well. A budget measured against the 284px box overflows the 164px
 * one and wraps every defender onto two lines.
 *
 * Set by rendering the real longest names in the league into every line width and looking, which
 * is what rule 9 asks for and is not the same as measuring the box. A synthetic worst-glyph
 * measurement said 17 for a one-wide line; the render puts «محمود عبد المنعم كهربا» — twenty-two
 * characters — on one line there comfortably, because Arabic script sets far narrower than a
 * repeated glyph and, on the one- and two-wide lines, the 300px box sits inside a 900px or 450px
 * column, so the little it does overflow has nothing to collide with.
 *
 * Where it bites is the five-wide line: 164px at a 22px face, with 8px of slack. «عبد الله السعيد»
 * holds one line there and «محمود حمدي الونش» wraps onto two, so the budget sits below that.
 * The old single `SHIRT_NAME_MAX = 14` was the 284px figure applied to every line at once.
 */
const SHIRT_NAME_MAX_BY_LINE = { 1: 22, 2: 20, 3: 16, 4: 14, 5: 12 }

/** The width of the line each of the eleven stands in, by their index down the pitch. */
function lineWidths(formation) {
  return linesOf(formation).flatMap((n) => Array.from({ length: n }, () => n))
}

/**
 * The winner and the eleven he won with, in the shape he actually played.
 *
 * PITCH ORDER IS LOAD-BEARING NOW. It did not used to be: the card drew a fixed 3/3/4/1 whoever
 * won, so ordering by position bought nothing and the captain was promoted to the front instead,
 * because the template pinned its one marker to cell one. Drawing the real shape while leaving
 * the armband on cell one would still put a man in the wrong place — the very bug this fixes — so
 * every cell of every `_<shape>` template carries its own marker and the API's order survives
 * untouched. That order is forwards first, keeper last, which is the order the lines run in.
 *
 * The armband is the EFFECTIVE one: if the captain did not play it moved to the vice, and the
 * doubled points moved with it.
 *
 * Slots run points, captain, name per man from t5 — t(5+3i) / t(6+3i) / t(7+3i) — after a
 * five-slot header. ALL ELEVEN MARKERS ARE WRITTEN, the ten empty ones included: an unwritten
 * slot keeps the design's sample value and every marker's sample is 'C'. The card tool hides an
 * empty one with `.cap:empty{display:none!important}` — !important because the marker carries
 * `display:flex` inline to centre its letter, and an inline style beats a stylesheet rule.
 */
function winnerTeamCard({ gameweek, winner, formation }) {
  const widths = lineWidths(formation)

  const texts = {
    0: `${TEXT.winnerHero} ${gameweekLabel(gameweek).replace(/^الجولة /, '')}`.trim(),
    1: winner.teamName ?? '',
    2: winner.name,
    3: asText(winner.gwPts),
    4: TEXT.pointsWord,
  }

  const assets = {}
  winner.xi.forEach((p, i) => {
    texts[5 + 3 * i] = asText(p.points)
    texts[6 + 3 * i] = p.isCaptain ? 'C' : ''
    texts[7 + 3 * i] = cardName(p.name, { maxChars: SHIRT_NAME_MAX_BY_LINE[widths[i]] })
    assets[i] = p.club
  })

  const card = `P_WINNER_THEIR_TEAM_NO_CLUB_SET_${formation.replace(/-/g, '_')}`
  return { card, slug: 'winner', keepNames: true, texts, assets }
}

/**
 * The fixed-shape card, kept as the fallback.
 *
 * A settle day is the wrong moment to discover a shape nobody drew. Auto-subs preserve XI_RULES
 * so this should be unreachable, which is exactly why it is here rather than a thrown error.
 */
function winnerTeamCardFixed({ gameweek, winner }) {
  const captain = winner.xi.find((p) => p.isCaptain)
  const xi = captain ? [captain, ...winner.xi.filter((p) => p !== captain)] : winner.xi

  const texts = {
    0: `${TEXT.winnerHero} ${gameweekLabel(gameweek).replace(/^الجولة /, '')}`.trim(),
    1: winner.teamName ?? '',
    2: winner.name,
    3: asText(winner.gwPts),
    4: TEXT.pointsWord,
  }
  if (captain) texts[6] = 'C'

  const assets = {}
  xi.forEach((p, i) => {
    const j = i + 1
    texts[j === 1 ? 5 : 2 * j + 4] = asText(p.points)
    texts[j === 1 ? 7 : 2 * j + 5] = cardName(p.name, { maxChars: SHIRT_NAME_MAX_BY_LINE[3] })
    assets[i] = p.club
  })

  return { card: 'P_WINNER_THEIR_TEAM_NO_CLUB_SET', slug: 'winner', keepNames: true, texts, assets }
}

export function winnerCard({ gameweek, winner }) {
  if (!winner?.name) throw new Error('no gameweek winner available yet')

  // The eleven is the card we want. The STAT card is what a round answers with when the winner
  // endpoint has not been deployed or has nothing to say — a name and a score beats no post.
  if (Array.isArray(winner.xi) && winner.xi.length === 11) {
    const formation = formationOf(winner.xi)
    return DRAWABLE_WINNER_FORMATIONS.includes(formation)
      ? winnerTeamCard({ gameweek, winner, formation })
      : winnerTeamCardFixed({ gameweek, winner })
  }

  const points = `${asText(winner.gwPts)} ${TEXT.pointsWord}`
  const fits = winner.name.length <= 16

  // Owner call, 2026-09-04: the card names his TEAM as well as him. D_STAT has one support line,
  // so the shirt promise moves off the card and lives in the caption, which already says it. A
  // manager with no team name still gets a clean line rather than a stray separator.
  const support = [winner.teamName?.trim(), points].filter(Boolean).join(' · ')

  return {
    ...statCard({
      gameweek,
      hero: fits ? winner.name : TEXT.winnerHero,
      support: fits ? support : `${winner.name} · ${support}`,
    }),
    slug: 'winner',
  }
}

/* ─────────────────────────── vertical, for TikTok ─────────────────────────── */

/** Row counts the story cards actually ship. A day outside these has no vertical layout. */
const STORY_MATCHDAY_ROWS = [2, 3, 4, 8]
const STORY_RESULTS_ROWS = [2, 3, 4]

/**
 * TikTok is a vertical surface, and the tool ships ten 1080 × 1920 cards the calendar had never
 * used — TikTok was being handed the same 4:5 feed image as Facebook.
 *
 * Only the FIXED-SHAPE story cards are wired up here, and that is the whole constraint:
 * `A_MATCHDAY_1080_1920` holds **eight** fixture rows with sixteen crests, a matchday never has
 * more than four, and an unset slot does not go blank — it publishes the design's own sample
 * fixture, with a crest picked off a rotating guess list. There is no 3-row story variant to fall
 * back on: `ROW_VARIANTS` in build-cards.py generates short variants for the feed cards only, and
 * regenerating the tool needs the Claude Design source, which is not in this checkout.
 *
 * So matchday and results stay on their feed cards until a short story variant exists, and the
 * kinds below — which carry a fixed number of slots on every round — go out vertical.
 */

/** Captain poll, story shape. Always exactly four candidates, so nothing is left unset. */
export function questionCardStory({ gameweek, players }) {
  if (players.length !== 4) throw new Error(`The question story takes 4 players, got ${players.length}.`)
  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.questionTitle }
  const assets = {}
  players.forEach((p, i) => {
    texts[2 + i] = shortName(p.name)
    assets[i] = p.club
  })
  return { card: 'J_QUESTION_1080_1920', slug: 'question-story', keepNames: true, texts, assets }
}

/** Deadline, story shape. t3–t5 are the locked Fantasy EG footer and must never be written. */
export function deadlineCardStory({ gameweek, deadline }) {
  return {
    card: 'H_DEADLINE_1080_1920',
    slug: 'deadline-story',
    texts: { 0: gameweekLabel(gameweek), 1: deadlinePhrase(deadline), 2: TEXT.deadlineSubtitle },
    assets: {},
  }
}

/** One fact, large, story shape. Three slots and no assets — the safest card to fill. */
export function statCardStory({ gameweek, hero, support }) {
  if (hero.length > 16) throw new Error(`STAT hero "${hero}" is ${hero.length} chars; it wraps past 16.`)
  return {
    card: 'D_STAT_1080_1920',
    slug: 'stat-story',
    texts: { 0: gameweekLabel(gameweek), 1: hero, 2: support },
    assets: {},
  }
}

/** The build-up post, story shape. Same fact as the feed card: the deadline, large. */
export function buildUpCardStory({ gameweek, deadline }) {
  return { ...statCardStory({ gameweek, hero: deadlinePhrase(deadline), support: TEXT.deadlineWord }), slug: 'buildup-story' }
}

/** The prize post, story shape. Same rule: the manager is named either way. */
export function winnerCardStory({ gameweek, winner }) {
  if (!winner?.name) throw new Error('no gameweek winner available yet')
  const points = `${asText(winner.gwPts)} ${TEXT.pointsWord}`
  const fits = winner.name.length <= 16
  return {
    ...statCardStory({
      gameweek,
      hero: fits ? winner.name : TEXT.winnerHero,
      support: fits ? `${points} · ${TEXT.winnerShirt}` : `${winner.name} · ${points}`,
    }),
    slug: 'winner-story',
  }
}

/**
 * Today's fixtures, story shape. Unblocked on 2026-09-02, when the owner exported the design
 * source and `ROW_VARIANTS` grew short variants of the matchday and results story cards.
 *
 * The slot arithmetic is identical to the feed card — three slots per row from t2, two crests per
 * row — so only the key changes. What made this unsafe before was purely the row count: the base
 * story card holds eight rows and an unset row publishes the design's own sample fixture.
 *
 * A single-fixture day returns null rather than a card: there is no one-match story layout, and
 * the caller falls back to the feed image rather than inventing a shape.
 */
export function matchdayCardStory({ gameweek, fixtures }) {
  if (!STORY_MATCHDAY_ROWS.includes(fixtures.length)) return null

  const texts = { 0: gameweekLabel(gameweek), 1: TEXT.matchdayTitle }
  const assets = {}
  fixtures.forEach((f, i) => {
    texts[2 + 3 * i] = f.homeClub.short
    texts[3 + 3 * i] = kickoffTime(f.kickoffAt)
    texts[4 + 3 * i] = f.awayClub.short
    assets[2 * i] = f.home
    assets[2 * i + 1] = f.away
  })

  const card = fixtures.length === 8 ? 'A_MATCHDAY_1080_1920' : `A_MATCHDAY_1080_1920_${fixtures.length}_rows`
  return { card, slug: 'matchday-story', texts, assets }
}

/** Tonight's results, story shape. Five slots per row from t2, straddling a locked dash. */
export function resultsCardStory({ gameweek, fixtures }) {
  if (!STORY_RESULTS_ROWS.includes(fixtures.length)) return null

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

  const card = fixtures.length === 4 ? 'B_RESULTS_1080_1920' : `B_RESULTS_1080_1920_${fixtures.length}_rows`
  return { card, slug: 'results-story', texts, assets }
}
