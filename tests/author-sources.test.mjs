import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apiReader, fetchGameweekData } from '../build/author/sources.mjs'

const envelope = (data) => ({ success: true, message: 'ok', data, error: null, code: 200 })
const ok = (data) => ({ ok: true, status: 200, json: async () => envelope(data) })
const fail = (status, error) => ({
  ok: false,
  status,
  json: async () => ({ success: false, message: error, data: null, error, code: status }),
})

const CLUBS = [
  { id: 'AHL', short: 'الأهلي' },
  { id: 'ZAM', short: 'الزمالك' },
]

function stubApi(overrides = {}) {
  const seen = []
  const routes = {
    '/clubs': ok(CLUBS),
    '/fixtures?gw=4': ok([{ home: 'AHL' }]),
    '/fixtures?gw=3': ok([{ home: 'ZAM' }]),
    '/standings': ok([{ club: 'AHL', p: 4, pts: 12 }]),
    '/gameweeks/4/standings?limit=3': ok({ data: [{ name: 'مدير', gwPts: 80 }] }),
    '/gameweeks/4/top-players?limit=50': ok([{ playerId: 1, club: 'ZAM', points: 14 }]),
    // `top-players` carries no photoUrl, so the top scorer is looked up on his own for the
    // player-of-the-round card's photo hero. Site-absolute, exactly as the API answers.
    '/players/1': ok({ id: 1, name: 'إمام عاشور', photoUrl: '/api/v1/assets/players/1.jpg' }),
    // The settle-day pair. Both are settled fact and both 404 until the round is final.
    '/gameweeks/4/winner': ok({ gw: 4, name: 'Mohamed Sadek', teamName: 'العالمي', gwPts: 80, xi: [] }),
    '/gameweeks/4/team-of-week?formations=3-4-3,3-5-2,4-3-3,4-4-2,4-5-1,5-2-3,5-3-2,5-4-1': ok({
      gw: 4,
      formation: '4-4-2',
      totalPoints: 128,
      players: [],
    }),
    '/players?sortBy=price&per_page=12': ok({
      data: [
        { id: 1, club: 'AHL', form: 2 },
        { id: 2, club: 'ZAM', form: 9 },
      ],
    }),
    '/players/price-changes?window=168h': ok({
      risers: [{ name: 'أ', club: 'AHL', price: 10.7, change: 0.2 }],
      fallers: [{ name: 'ب', club: 'ZAM', price: 7.4, change: -0.5 }],
    }),
    ...overrides,
  }
  const fetchFn = async (url) => {
    const path = url.replace('https://api.fantasyeg.com/api/v1', '')
    seen.push(path)
    if (!routes[path]) throw new Error(`unstubbed path ${path}`)
    return routes[path]
  }
  return { read: apiReader({ fetchFn }), seen }
}

test('a snapshot carries everything the calendar can draw on', async () => {
  const { read } = stubApi()
  const data = await fetchGameweekData({ gameweek: 4, read })

  assert.equal(data.fixtures.length, 1)
  assert.equal(data.previousFixtures.length, 1)
  assert.equal(data.gwStandings.length, 1)
  assert.equal(data.topPlayers.length, 1)
  assert.equal(data.captainCandidates.length, 2)
  assert.deepEqual(data.notes, [])
})

test('a club code becomes the short Arabic name a card prints', () => {
  return stubApi().read('/clubs').then(async () => {
    const { read } = stubApi()
    const data = await fetchGameweekData({ gameweek: 4, read })
    assert.equal(data.standings[0].clubShort, 'الأهلي')
    assert.equal(data.topPlayers[0].clubShort, 'الزمالك')
  })
})

test('a paginated payload is unwrapped, a plain one is not', async () => {
  const { read } = stubApi()
  const data = await fetchGameweekData({ gameweek: 4, read })
  assert.equal(data.captainCandidates[0].id, 2, 'players are paginated')
  assert.equal(data.standings[0].club, 'AHL', 'standings are a plain array')
})

test('risers and fallers arrive as one list, biggest move first', async () => {
  const { read } = stubApi()
  const data = await fetchGameweekData({ gameweek: 4, read })
  assert.deepEqual(data.priceChanges.map((c) => c.change), [-0.5, 0.2])
})

// An unsettled round has no winner and no player points, and the API says so with a 404 rather
// than an empty list. That is an answer, not a failure.
test('a gameweek that has not settled leaves a note, not an exception', async () => {
  const { read } = stubApi({
    '/gameweeks/4/standings?limit=3': fail(404, 'GAMEWEEK_NOT_SETTLED'),
    '/gameweeks/4/top-players?limit=50': fail(404, 'GAMEWEEK_NOT_SETTLED'),
  })
  const data = await fetchGameweekData({ gameweek: 4, read })

  assert.equal(data.gwStandings, null)
  assert.equal(data.topPlayers, null)
  assert.deepEqual(data.notes, [
    'gwStandings: GAMEWEEK_NOT_SETTLED',
    'topPlayers: GAMEWEEK_NOT_SETTLED',
  ])
})

// /gameweeks/:gw/top-players is new. An API that predates it 404s with no machine code, and
// "the endpoint is not deployed" must not read like "the round is not settled".
test('an endpoint the deployment does not have yet says so in its own words', async () => {
  const { read } = stubApi({
    '/gameweeks/4/top-players?limit=50': { ok: false, status: 404, json: async () => ({}) },
  })
  const data = await fetchGameweekData({ gameweek: 4, read })
  assert.match(data.notes.join(''), /topPlayers: not served by/)
})

test('a genuine failure is thrown, never turned into a missing card', async () => {
  const { read } = stubApi({ '/standings': fail(500, 'INTERNAL') })
  await assert.rejects(() => fetchGameweekData({ gameweek: 4, read }), /GET \/standings failed: INTERNAL/)
})

test('the first gameweek does not ask for a round before it', async () => {
  const { read, seen } = stubApi({ '/fixtures?gw=1': ok([]), '/gameweeks/1/standings?limit=3': fail(404, 'GAMEWEEK_NOT_SETTLED'), '/gameweeks/1/top-players?limit=50': fail(404, 'GAMEWEEK_NOT_SETTLED'), '/gameweeks/1/winner': fail(404, 'GAMEWEEK_NOT_SETTLED'), '/gameweeks/1/team-of-week?formations=3-4-3,3-5-2,4-3-3,4-4-2,4-5-1,5-2-3,5-3-2,5-4-1': fail(404, 'GAMEWEEK_NOT_SETTLED') })
  await fetchGameweekData({ gameweek: 1, read })
  assert.equal(seen.some((p) => p.includes('gw=0')), false)
})

// Sorting the whole league by form offers four names nobody would captain. The candidates are the
// expensive players, ranked by who is in form among them.
test('captain candidates come from the price list, ordered by form', async () => {
  const { read, seen } = stubApi()
  const data = await fetchGameweekData({ gameweek: 4, read })

  assert.ok(seen.includes('/players?sortBy=price&per_page=12'))
  assert.deepEqual(data.captainCandidates.map((p) => p.id), [2, 1])
})
