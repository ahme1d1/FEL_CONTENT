/**
 * Everything the author reads, and nothing it writes.
 *
 * Every call here is an unauthenticated GET against the public API. That is not a limitation to
 * work around, it is the design: this runs in a cloud routine and on a laptop, and a pipeline
 * that publishes to a brand account should not be holding a manager's credentials. Where a fact
 * needs a token, the card that wanted it is skipped and said so.
 *
 * `fetch` is injected, so the whole module is testable with no network and a snapshot can stand in
 * for the API — which is also what makes a manifest reproducible.
 */

import { DRAWABLE_FORMATIONS } from './cards.mjs'

export const DEFAULT_API_BASE = 'https://api.fantasyeg.com/api/v1'

/** How deep into the price list a captain is plausibly picked from. */
const CAPTAIN_POOL = 12

/**
 * Answers that mean "not yet", not "broken".
 *
 * A gameweek that has not settled has no winner and no player points, and the API says so with a
 * 404 rather than an empty list — deliberately, so an unscored round never reads as "nobody
 * scored". The author treats it as a card it cannot write today.
 */
const NOT_YET = new Set(['GAMEWEEK_NOT_SETTLED', 'GAMEWEEK_NOT_FOUND'])

/** @returns {(path: string) => Promise<unknown>} */
export function apiReader({ base = DEFAULT_API_BASE, fetchFn = fetch } = {}) {
  return async function read(path) {
    const res = await fetchFn(`${base}${path}`, { headers: { accept: 'application/json' } })
    const body = await res.json().catch(() => null)

    if (!res.ok || body?.success === false) {
      const code = body?.error ?? `HTTP ${res.status}`
      throw Object.assign(new Error(`GET ${path} failed: ${code}`), { code, status: res.status })
    }
    return body?.data ?? null
  }
}

/** A paginated payload nests the rows one level down; a plain one does not. */
const rows = (data) => (Array.isArray(data) ? data : (data?.data ?? []))

/**
 * Read something the round may not be ready to answer.
 * @returns {Promise<{value: unknown|null, note: string|null}>}
 */
async function optional(read, path, label) {
  try {
    return { value: await read(path), note: null }
  } catch (err) {
    if (NOT_YET.has(err.code)) return { value: null, note: `${label}: ${err.code}` }
    // A 404 with no machine code is the endpoint itself missing — worth saying plainly, because
    // `/gameweeks/:gw/top-players` is new and an old deployment simply will not have it.
    if (err.status === 404) return { value: null, note: `${label}: not served by ${path}` }
    throw err
  }
}

/**
 * One snapshot of everything the calendar can draw on.
 *
 * @param {{gameweek: number, read: Function}} input
 * @returns {Promise<object>} pass it straight to `planPosts` as `data`
 */
export async function fetchGameweekData({ gameweek, read, apiBase = DEFAULT_API_BASE }) {
  const notes = []
  const take = async (path, label) => {
    const { value, note } = await optional(read, path, label)
    if (note) notes.push(note)
    return value
  }

  const [clubs, fixtures, previousFixtures, standings, gwBoard, topPlayers, winner, teamOfWeek, premiums, prices] =
    await Promise.all([
      read('/clubs'),
      read(`/fixtures?gw=${gameweek}`),
      gameweek > 1 ? read(`/fixtures?gw=${gameweek - 1}`) : Promise.resolve([]),
      read('/standings'),
      take(`/gameweeks/${gameweek}/standings?limit=3`, 'gwStandings'),
      take(`/gameweeks/${gameweek}/top-players?limit=50`, 'topPlayers'),
      // The settle-day pair. Both are settled fact and both 404 GAMEWEEK_NOT_SETTLED until the
      // round is final, which `optional` already reads as "not yet" rather than "broken".
      take(`/gameweeks/${gameweek}/winner`, 'winner'),
      // Only the shapes we hold a card template for. Without this the API is free to answer with
      // the best legal formation of the eight, which may be one we cannot draw.
      take(`/gameweeks/${gameweek}/team-of-week?formations=${DRAWABLE_FORMATIONS.join(',')}`, 'teamOfWeek'),
      read(`/players?sortBy=price&per_page=${CAPTAIN_POOL}`),
      take('/players/price-changes?window=168h', 'priceChanges'),
    ])

  // `top-players` does not carry photoUrl and `/players/:id` does, so the ONE player who gets a
  // photo card — the top scorer on the player-of-the-round card — is looked up individually.
  // Fetching fifty player records to use one would be rude to an API we do not pay for.
  const topRows = topPlayers ? rows(topPlayers) : []
  let heroPhoto = null
  if (topRows.length) {
    // Never fatal. The photo is the nicer half of a card that already has a working fallback, so a
    // player record that 404s or an API having a bad minute must cost us the photo and nothing
    // else — not the player-of-the-round card, and not the four other cards in this same pass.
    // Recorded as a note rather than swallowed, so a run that lost the photo says so.
    let record = null
    try {
      record = await take(`/players/${topRows[0].playerId}`, 'playerPhoto')
    } catch (err) {
      notes.push(`playerPhoto: ${err.message}`)
    }
    const href = record?.photoUrl
    // The API answers with a site-absolute path; a card is rendered somewhere else entirely, so it
    // needs an absolute URL. An absolute href is left alone in case the API ever serves one.
    if (href) heroPhoto = /^https?:\/\//.test(href) ? href : new URL(href, apiBase).toString()
  }

  // Players and the league table carry a club CODE; a card prints the club's short Arabic name.
  const shortById = new Map(clubs.map((c) => [c.id, c.short]))
  const withClubName = (row) => ({ ...row, clubShort: shortById.get(row.club) ?? row.club })

  const moves = prices ? [...(prices.risers ?? []), ...(prices.fallers ?? [])] : []

  return {
    fetchedAt: new Date().toISOString(),
    gameweek,
    clubs,
    fixtures,
    previousFixtures,
    standings: rows(standings).map(withClubName),
    gwStandings: gwBoard ? rows(gwBoard) : null,
    // Only the first carries a photo: it is the only one that lands on a card with a photo hero.
    topPlayers: topPlayers
      ? rows(topPlayers).map(withClubName).map((p, i) => (i === 0 && heroPhoto ? { ...p, photoUrl: heroPhoto } : p))
      : null,
    // The premiums, in form order. Sorting the whole league by form instead offers four names
    // nobody would captain: after three rounds the top of that table is whoever had one good
    // week, not the players a manager is actually choosing between.
    captainCandidates: rows(premiums).sort((a, b) => b.form - a.form || a.id - b.id),
    // Biggest movers first; the card holds eight and there is no point showing the smallest.
    priceChanges: moves.length
      ? moves.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).map(withClubName)
      : null,
    winner,
    teamOfWeek,
    notes,
  }
}
