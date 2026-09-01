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
