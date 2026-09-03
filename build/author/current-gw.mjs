/**
 * Which gameweeks to author, worked out from the fixture list alone.
 *
 * `author-cli.mjs` has always required `--gameweek <n>`, which is fine for a person and useless
 * for a routine. `GET /gameweeks/current` would answer it directly and is the obvious call to
 * reach for — but it sits behind `JwtAuthGuard`, and this pipeline holds no credential by design.
 *
 * `GET /fixtures` with no `gw` returns every fixture of the season, each carrying `gw`,
 * `kickoffAt` and `status`, and it is public. That is enough: a round is running while any of its
 * fixtures has not finished, and the running one is the earliest such round.
 *
 * Pure on purpose. The network lives in sources.mjs, and the clock is injected, so the whole
 * module is still exercised with no network and no wall time.
 */

/** A fixture that has been played and scored. Everything else still owes us something. */
const isFinished = (fixture) => fixture?.status === 'FINISHED'

const gameweeksIn = (fixtures) =>
  [...new Set(fixtures.map((f) => f.gw).filter((gw) => Number.isInteger(gw)))].sort((a, b) => a - b)

/**
 * How long a round stays authorable after its final kickoff.
 *
 * A round is not done when its last ball is kicked. Its results card for that day can only be
 * built once every fixture reads FINISHED, and its settle-day slate — winner, podium, player of
 * the round, team of the week, top players — lands on the last match day + 1 (`window.mjs`),
 * whose latest slot is 20:00 Cairo. A round whose final match kicked off at noon therefore still
 * has posts to write 32 hours later.
 *
 * 48 leaves margin for a pass to land comfortably before that slot rather than exactly on it,
 * and is still far short of the next round's own settle day, so no two rounds ever contend.
 */
const SETTLE_GRACE_HOURS = 48

/** The last kickoff of a round, or null when the fixtures carry no usable time. */
const lastKickoffOf = (fixtures, gw) => {
  const times = fixtures
    .filter((f) => f?.gw === gw)
    .map((f) => Date.parse(f?.kickoffAt))
    .filter(Number.isFinite)
  return times.length ? Math.max(...times) : null
}

/**
 * The round currently being played, or waiting to be.
 *
 * Returns null only when every fixture of the season has finished — at which point there is no
 * running round, which is an answer rather than an error. It is NOT the same as "nothing to
 * author": see `gameweeksToAuthor`.
 *
 * @param {Array<{gw: number, status: string}>} fixtures
 * @returns {number|null}
 */
export function runningGameweek(fixtures = []) {
  const unfinished = fixtures.filter((f) => !isFinished(f)).map((f) => f.gw)
  if (!unfinished.length) return null
  return Math.min(...unfinished)
}

/**
 * Every round the routine keeps authored: the one being played, the one after it, and any round
 * that finished recently enough to still owe us posts.
 *
 * That last clause is load-bearing, and its absence was a silent content bug. `runningGameweek`
 * rolls over the instant a round's final fixture reads FINISHED — which is the SAME instant
 * `BUILDERS.results` will at last consent to build that day's results card, because it refuses
 * any day with an unplayed fixture. Keyed on the running round alone, the two conditions were
 * never true together: before the whistle the card could not be built, and after it the round was
 * no longer authored. The final matchday's results post of every gameweek was unreachable, and so
 * was the settle-day slate that follows a day later. Observed on 2026-09-03, GW3.
 *
 * The grace window is what makes them overlap. Rounds outside it are dropped rather than
 * re-authored forever: every post they own is long past its slot, so a pass over one writes an
 * empty manifest and nothing else.
 *
 * The next round is only included when the season actually has one, so the last gameweek does not
 * produce a phantom GW20 whose fixtures do not exist. The 2026/27 first stage stops at 19 and the
 * second-stage calendar has not been drawn (see docs/PLAN.md open item 7), so this must never
 * invent a round by adding one.
 *
 * @param {Array<{gw: number, status: string, kickoffAt?: string}>} fixtures
 * @param {{now?: number}} [options] injected clock, in epoch ms
 * @returns {number[]} ascending, possibly empty
 */
export function gameweeksToAuthor(fixtures = [], { now = Date.now() } = {}) {
  const known = gameweeksIn(fixtures)
  const running = runningGameweek(fixtures)
  const wanted = new Set()

  if (running !== null) {
    wanted.add(running)
    wanted.add(running + 1)
  }

  // A finished round is still authorable until its settle day is over. When the season itself has
  // finished there is no running round to anchor to, and this is the only clause that keeps the
  // final round's settle day alive — the same deadlock, in its last instance.
  for (const gw of known) {
    if (running !== null && gw >= running) continue
    const last = lastKickoffOf(fixtures, gw)
    if (last !== null && now - last <= SETTLE_GRACE_HOURS * 3_600_000) wanted.add(gw)
  }

  return [...wanted].filter((gw) => known.includes(gw)).sort((a, b) => a - b)
}
