import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameweeksToAuthor, runningGameweek } from '../build/author/current-gw.mjs'

/** A season of `rounds` gameweeks, `perGw` fixtures each, with the first `finished` of them played. */
const season = ({ rounds = 3, perGw = 2, finished = 0 } = {}) => {
  const out = []
  for (let gw = 1; gw <= rounds; gw += 1) {
    for (let i = 0; i < perGw; i += 1) {
      const index = (gw - 1) * perGw + i
      out.push({ gw, status: index < finished ? 'FINISHED' : 'SCHEDULED' })
    }
  }
  return out
}

test('before a ball is kicked the first round is the running one', () => {
  assert.equal(runningGameweek(season()), 1)
})

// The case this was written for: GW3 was six fixtures into ten when the routine was built, and
// "which gameweek is it" had no tokenless answer.
test('a part-played round is still the running round', () => {
  const fixtures = season({ finished: 3 })
  assert.equal(runningGameweek(fixtures), 2)
})

test('a round rolls over only once its last fixture is finished', () => {
  assert.equal(runningGameweek(season({ finished: 1 })), 1)
  assert.equal(runningGameweek(season({ finished: 2 })), 2)
})

// A fixture can be LIVE or POSTPONED as well as SCHEDULED. Only FINISHED closes a round out, so
// anything else must keep it open — a postponed match is exactly the case that would otherwise
// hand the routine the wrong round.
test('only FINISHED closes a round; live and postponed keep it open', () => {
  for (const status of ['SCHEDULED', 'LIVE', 'POSTPONED']) {
    assert.equal(runningGameweek([{ gw: 1, status: 'FINISHED' }, { gw: 1, status }]), 1, status)
  }
})

test('a finished season has no running round rather than a wrong one', () => {
  assert.equal(runningGameweek(season({ finished: 6 })), null)
  assert.equal(runningGameweek([]), null)
})

test('the routine authors the running round and the next one', () => {
  assert.deepEqual(gameweeksToAuthor(season({ finished: 3 })), [2, 3])
})

// The 2026/27 first stage stops at GW19 and the second-stage calendar does not exist yet, so
// running + 1 must never conjure a round whose fixtures were never drawn.
test('the last round of the season does not invent a next one', () => {
  assert.deepEqual(gameweeksToAuthor(season({ rounds: 3, finished: 5 })), [3])
})

test('a finished season gives the routine nothing to do', () => {
  assert.deepEqual(gameweeksToAuthor(season({ finished: 6 })), [])
})

// ── the settle-day grace window ────────────────────────────────────────────────────────────────
//
// 2026-09-03: GW3's last fixture finished at 21:50 Cairo and its results post was never authored.
// `runningGameweek` rolls over the instant a round's last fixture reads FINISHED — which is the
// SAME instant `BUILDERS.results` will finally build that day's results card. The two conditions
// were mutually exclusive, so the final matchday's results post of every round was unreachable,
// and so was the whole settle-day slate that follows it a day later.

const HOUR = 3_600_000
const NOW = Date.parse('2026-09-03T20:00:00Z')
/** A kickoff `hours` before NOW; negative for one still to come. */
const kickoff = (hours) => new Date(NOW - hours * HOUR).toISOString()

test('a round stays authorable after its last whistle, so its results post can be written', () => {
  const fixtures = [
    { gw: 3, status: 'FINISHED', kickoffAt: kickoff(3) },
    { gw: 4, status: 'SCHEDULED', kickoffAt: kickoff(-24) },
  ]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [3, 4])
})

// The settle day is the last match day + 1 (window.mjs), and its latest slot is 20:00 Cairo, so a
// round has to stay authorable for well over a day after its final kickoff.
test('a round stays authorable through the whole of its settle day', () => {
  const fixtures = [
    { gw: 3, status: 'FINISHED', kickoffAt: kickoff(33) },
    { gw: 4, status: 'SCHEDULED', kickoffAt: kickoff(-24) },
  ]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [3, 4])
})

// Without a cutoff the routine would re-author every round of the season on every pass, and mint
// an empty manifest for each one whose slots have all gone.
test('a round drops out once its settle day is over', () => {
  const fixtures = [
    { gw: 3, status: 'FINISHED', kickoffAt: kickoff(72) },
    { gw: 4, status: 'SCHEDULED', kickoffAt: kickoff(-24) },
  ]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [4])
})

test('the grace runs from the round’s last kickoff, not its first', () => {
  const fixtures = [
    { gw: 3, status: 'FINISHED', kickoffAt: kickoff(120) },
    { gw: 3, status: 'FINISHED', kickoffAt: kickoff(3) },
    { gw: 4, status: 'SCHEDULED', kickoffAt: kickoff(-24) },
  ]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [3, 4])
})

// The same deadlock, in its last instance: when the final round finishes there is no running round
// at all, and its settle day would go with it.
test('the last round of the season keeps its settle day', () => {
  const fixtures = [
    { gw: 18, status: 'FINISHED', kickoffAt: kickoff(200) },
    { gw: 19, status: 'FINISHED', kickoffAt: kickoff(3) },
  ]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [19])
})

test('a season finished long ago still gives the routine nothing to do', () => {
  const fixtures = [{ gw: 19, status: 'FINISHED', kickoffAt: kickoff(300) }]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [])
})

// A fixture list with no kickoff times must not resurrect the whole season on a NaN comparison.
test('a fixture with no kickoff time is never counted as recent', () => {
  const fixtures = [
    { gw: 3, status: 'FINISHED' },
    { gw: 4, status: 'SCHEDULED' },
  ]
  assert.deepEqual(gameweeksToAuthor(fixtures, { now: NOW }), [4])
})
