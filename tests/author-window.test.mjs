import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contentWindow } from '../build/author/window.mjs'

const fx = (kickoffAt, over = {}) => ({
  id: `f-${kickoffAt}`,
  gw: 4,
  home: 'AHL',
  away: 'ZAM',
  kickoffAt,
  status: 'SCHEDULED',
  homeScore: null,
  awayScore: null,
  ...over,
})

// Real GW4: first kickoff 17:00 Cairo on 7 Sep, matches over three days.
const GW4 = [
  fx('2026-09-07T14:00:00.000Z'),
  fx('2026-09-07T17:00:00.000Z'),
  fx('2026-09-08T17:00:00.000Z'),
  fx('2026-09-09T18:00:00.000Z'),
]
const GW3_TAIL = [fx('2026-09-02T17:00:00.000Z', { gw: 3 }), fx('2026-09-03T17:00:00.000Z', { gw: 3 })]

const roleOf = (w, date) => w.days.find((d) => d.date === date)?.roles ?? []

test('the deadline is one hour before the first kickoff', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4 })
  assert.equal(w.deadline, '2026-09-07T13:00:00Z') // 16:00 Cairo, matching the published table
})

test('a gameweek spans as many days as it spans, never an assumed three', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4 })
  assert.deepEqual(
    w.days.filter((d) => d.roles.includes('match')).map((d) => d.date),
    ['2026-09-07', '2026-09-08', '2026-09-09'],
  )
})

test('each day carries its own fixtures, so a matchday card cannot show the wrong ones', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4 })
  const first = w.days.find((d) => d.date === '2026-09-07')
  assert.equal(first.fixtures.length, 2)
  assert.equal(w.days.find((d) => d.date === '2026-09-09').fixtures.length, 1)
})

test('the deadline day is also a match day, and holds both roles', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4 })
  assert.deepEqual(roleOf(w, '2026-09-07').sort(), ['deadline', 'match'])
})

test('the settle day is the morning after the last match', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4 })
  assert.deepEqual(roleOf(w, '2026-09-10'), ['settle'])
})

test('the build-up day is the morning after the previous round finished', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4, previousFixtures: GW3_TAIL })
  assert.deepEqual(roleOf(w, '2026-09-04'), ['buildUp'])
})

test('there is no build-up day for the first gameweek of the season', () => {
  const w = contentWindow({ gameweek: 1, fixtures: GW4 })
  assert.equal(w.days.some((d) => d.roles.includes('buildUp')), false)
})

// Two rounds back to back leave no room for a build-up post; inventing one would put it after
// the deadline it is meant to precede.
test('a build-up day that would land on or after the deadline day is dropped', () => {
  const w = contentWindow({
    gameweek: 4,
    fixtures: GW4,
    previousFixtures: [fx('2026-09-06T17:00:00.000Z', { gw: 3 })],
  })
  assert.equal(w.days.some((d) => d.roles.includes('buildUp')), false)
})

test('days are ordered and indexed, which is what names a post id', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4, previousFixtures: GW3_TAIL })
  assert.deepEqual(
    w.days.map((d) => [d.index, d.date]),
    [
      [1, '2026-09-04'],
      [2, '2026-09-06'],
      [3, '2026-09-07'],
      [4, '2026-09-08'],
      [5, '2026-09-09'],
      [6, '2026-09-10'],
    ],
  )
})

// A postponed fixture keeps a stale kickoff. Counting it would anchor the deadline to a match
// nobody is playing, and put a matchday card on an empty day.
test('a postponed fixture sets neither the deadline nor a match day', () => {
  const w = contentWindow({
    gameweek: 4,
    fixtures: [fx('2026-09-05T10:00:00.000Z', { status: 'POSTPONED' }), ...GW4],
  })
  assert.equal(w.deadline, '2026-09-07T13:00:00Z')
  assert.equal(w.days.some((d) => d.date === '2026-09-05'), false)
})

test('a gameweek with no playable fixture is refused rather than authored empty', () => {
  assert.throws(() => contentWindow({ gameweek: 4, fixtures: [] }), /no playable fixture/i)
  assert.throws(
    () => contentWindow({ gameweek: 4, fixtures: [fx('2026-09-07T14:00:00Z', { status: 'POSTPONED' })] }),
    /no playable fixture/i,
  )
})

test('the quiet day before the deadline carries the middle-day posts', () => {
  const w = contentWindow({ gameweek: 4, fixtures: GW4, previousFixtures: GW3_TAIL })
  assert.deepEqual(roleOf(w, '2026-09-06'), ['middle'])
})

// Two rounds back to back leave no quiet day; inventing one would collide with the build-up.
test('there is no middle day when the build-up sits the day before the deadline', () => {
  const w = contentWindow({
    gameweek: 4,
    fixtures: GW4,
    previousFixtures: [fx('2026-09-05T17:00:00.000Z', { gw: 3 })],
  })
  assert.deepEqual(roleOf(w, '2026-09-06'), ['buildUp'])
  assert.equal(w.days.some((d) => d.roles.includes('middle')), false)
})
