/**
 * Which gameweeks to author, worked out from the fixture list alone.
 *
 * `author-cli.mjs` has always required `--gameweek <n>`, which is fine for a person and useless
 * for a routine. `GET /gameweeks/current` would answer it directly and is the obvious call to
 * reach for — but it sits behind `JwtAuthGuard`, and this pipeline holds no credential by design.
 *
 * `GET /fixtures` with no `gw` returns every fixture of the season, each carrying `gw`,
 * `kickoffAt` and `status`, and it is public. That is enough: a round is running while any of its
 * fixtures has not finished, and the running one is the earliest such round. No clock is needed,
 * which is what makes this testable — and it agrees with the API's own view because both are
 * reading the same `status`.
 *
 * Pure on purpose. The network lives in sources.mjs.
 */

/** A fixture that has been played and scored. Everything else still owes us something. */
const isFinished = (fixture) => fixture?.status === 'FINISHED'

const gameweeksIn = (fixtures) =>
  [...new Set(fixtures.map((f) => f.gw).filter((gw) => Number.isInteger(gw)))].sort((a, b) => a - b)

/**
 * The round currently being played, or waiting to be.
 *
 * Returns null only when every fixture of the season has finished — at which point there is no
 * running round and nothing to author, which is an answer rather than an error.
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
 * The running round and the one after it — the two a routine keeps authored.
 *
 * The next round is only included when the season actually has one, so the last gameweek does not
 * produce a phantom GW20 whose fixtures do not exist. The 2026/27 first stage stops at 19 and the
 * second-stage calendar has not been drawn (see docs/PLAN.md open item 7), so this must never
 * invent a round by adding one.
 *
 * @param {Array<{gw: number, status: string}>} fixtures
 * @returns {number[]} zero, one or two gameweek numbers, ascending
 */
export function gameweeksToAuthor(fixtures = []) {
  const running = runningGameweek(fixtures)
  if (running === null) return []

  const known = new Set(gameweeksIn(fixtures))
  return [running, running + 1].filter((gw) => known.has(gw))
}
