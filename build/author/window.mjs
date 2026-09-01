/**
 * A gameweek's content window: which Cairo days carry posts, and what each day is for.
 *
 * Everything downstream hangs off this. Pure, so the whole calendar can be reasoned about from a
 * list of fixtures with no clock and no network.
 *
 * Two facts it exists to stop anyone assuming. A gameweek is **not** on a fixed weekday, and it
 * does **not** span three days — GW3 spans four. Both are stated as forbidden claims in
 * `content-design-kit.md` §5 for copy, and they are just as wrong in code.
 */

import { addCairoDays, cairoDateOf } from './slots.mjs'

/** The deadline is one hour before the first kickoff (owner's call, 2026-08-26). */
const DEADLINE_LEAD_MS = 60 * 60 * 1000

/** A postponed fixture keeps the kickoff it was postponed from, so it anchors nothing. */
const isPlayable = (f) => f.status !== 'POSTPONED'

const byDate = (a, b) => a.date.localeCompare(b.date)

/**
 * @param {{gameweek: number, fixtures: object[], previousFixtures?: object[]}} input
 * @returns {{gameweek: number, deadline: string, days: Array<{date: string, index: number, roles: string[], fixtures: object[]}>}}
 */
export function contentWindow({ gameweek, fixtures, previousFixtures = [] }) {
  const playable = (fixtures ?? []).filter(isPlayable)
  if (!playable.length) {
    throw new Error(`Gameweek ${gameweek} has no playable fixture to build a window from.`)
  }

  const kickoffs = playable.map((f) => Date.parse(f.kickoffAt)).sort((a, b) => a - b)
  const deadline = new Date(kickoffs[0] - DEADLINE_LEAD_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const deadlineDay = cairoDateOf(deadline)

  // The day a fixture is played is its CAIRO day. A 21:00 UTC kickoff is the next day in Cairo.
  const days = new Map()
  const addRole = (date, role) => {
    const day = days.get(date) ?? { date, roles: [], fixtures: [] }
    if (!day.roles.includes(role)) day.roles.push(role)
    days.set(date, day)
  }

  for (const f of playable) {
    const date = cairoDateOf(f.kickoffAt)
    addRole(date, 'match')
    days.get(date).fixtures.push(f)
  }

  addRole(deadlineDay, 'deadline')

  const matchDays = [...days.values()].filter((d) => d.roles.includes('match')).sort(byDate)
  addRole(addCairoDays(matchDays[matchDays.length - 1].date, 1), 'settle')

  // The build-up post goes out the morning after the previous round's last match, which is the
  // biggest content day of the cycle. Skipped when there is no previous round, and skipped when
  // the rounds sit so close together that it would land on or after the deadline it precedes.
  const previousPlayable = (previousFixtures ?? []).filter(isPlayable)
  let buildUpDay = null
  if (previousPlayable.length) {
    const previousEnd = previousPlayable
      .map((f) => cairoDateOf(f.kickoffAt))
      .sort()
      .at(-1)
    const candidate = addCairoDays(previousEnd, 1)
    if (candidate < deadlineDay) {
      buildUpDay = candidate
      addRole(buildUpDay, 'buildUp')
    }
  }

  // The runbook's middle day: the quiet day before the deadline, carrying the league table and
  // the captain poll. It exists only when there is actually a gap — two rounds close together
  // leave the build-up and the deadline back to back, and there is no room for it.
  const middleDay = addCairoDays(deadlineDay, -1)
  if (!days.has(middleDay) && (!buildUpDay || middleDay > buildUpDay)) addRole(middleDay, 'middle')

  const ordered = [...days.values()].sort(byDate)
  for (const day of ordered) day.fixtures.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))

  return {
    gameweek,
    deadline,
    days: ordered.map((day, i) => ({ ...day, index: i + 1 })),
  }
}
