import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, overlayJobs, overlayFilters, COVER_PAD } from '../build/swap-plan.mjs'

const args = (s) => parseArgs(s.split(' ').filter(Boolean))

/** A resolved player, shaped as loadPlayer() returns one. */
const player = (over = {}) => ({
  id: 260,
  fullName: 'شيكو بانزا',
  cardName: 'بانزا',
  club: 'ZAM',
  gw: 3,
  points: 5,
  goals: 0,
  assists: 1,
  ...over,
})

// ── parsing ────────────────────────────────────────────────────────────────

test('a single player with one card parses to one pick', () => {
  const plan = args('--file a.mp4 --player 3 --card 10,20,30,40')
  assert.equal(plan.picks.length, 1)
  assert.deepEqual(plan.picks[0].card, { x: 10, y: 20, w: 30, h: 40 })
  assert.equal(plan.picks[0].player, 3)
  assert.equal(plan.picks[0].captain, false)
})

// The whole point of the change: one pass, six cards, six different players.
test('each --player opens a new pick and the boxes after it belong to that player', () => {
  const plan = args('--file a.mp4 --player 13 --card 1,1,10,10 --player 35 --card 2,2,10,10 --player 9 --card 3,3,10,10')
  assert.deepEqual(
    plan.picks.map((p) => [p.player, p.card.x]),
    [[13, 1], [35, 2], [9, 3]],
  )
})

test('--captain and --gameweek bind to the pick they follow, not to every pick', () => {
  const plan = args('--file a.mp4 --player 13 --card 1,1,10,10 --player 9 --captain --gameweek 3 --card 2,2,10,10')
  assert.deepEqual(plan.picks.map((p) => p.captain), [false, true])
  assert.deepEqual(plan.picks.map((p) => p.gameweek), [null, 3])
})

// The old CLI took --captain as a global flag and the usage line put it before
// the boxes; that ordering has to keep meaning what it meant.
test('--captain written before the first --player still applies to it', () => {
  const plan = args('--file a.mp4 --captain --gameweek 2 --player 3 --card 1,1,10,10')
  assert.equal(plan.picks[0].captain, true)
  assert.equal(plan.picks[0].gameweek, 2)
})

// The star is FPL's "in your XI" marker. Some footage carries it and some does not, and six
// cards each wearing one the source never had is decoration, not data.
test('--no-star drops the badge for the pick it follows and no other', () => {
  const plan = args('--file a.mp4 --player 13 --no-star --card 1,1,10,10 --player 9 --card 2,2,10,10')
  assert.deepEqual(plan.picks.map((p) => p.star), [false, true])
})

test('a box with no player at all is refused', () => {
  assert.throws(() => args('--file a.mp4 --card 1,1,10,10'), /--player/)
})

test('two cards on one player is refused rather than silently dropping one', () => {
  assert.throws(() => args('--file a.mp4 --player 3 --card 1,1,10,10 --card 2,2,10,10'), /already/)
})

test('a box needs four finite numbers', () => {
  assert.throws(() => args('--file a.mp4 --player 3 --card 1,2,3'), /x,y,w,h/)
  assert.throws(() => args('--file a.mp4 --player 3 --card 1,2,3,four'), /x,y,w,h/)
})

test('a source is required', () => {
  assert.throws(() => args('--player 3 --card 1,1,10,10'), /usage/)
})

test('--probe needs nothing else', () => {
  const plan = args('--file a.mp4 --probe')
  assert.equal(plan.probe, true)
  assert.equal(plan.picks.length, 0)
})

test('asking for no overlay at all is refused', () => {
  assert.throws(() => args('--file a.mp4'), /Nothing to replace/)
})

test('--text needs the words to paint', () => {
  assert.throws(() => args('--file a.mp4 --text 0,0,10,10'), /--line/)
})

test('--points needs the number to show', () => {
  assert.throws(() => args('--file a.mp4 --points 0,0,10,10'), /--total/)
})

test('an unknown flag is an error, not a silently ignored typo', () => {
  assert.throws(() => args('--file a.mp4 --playre 3'), /Unexpected/)
})

// ── jobs ───────────────────────────────────────────────────────────────────

const jobsFor = (plan) => overlayJobs(plan)

test('a card job carries the shortened name, the club and the live points', () => {
  const [job] = jobsFor({
    picks: [{ card: { x: 1, y: 2, w: 3, h: 4 }, panel: null, captain: false, resolved: player() }],
    brand: {},
  })
  assert.equal(job.composition, 'CardOnly')
  assert.deepEqual(job.props, { name: 'بانزا', club: 'ZAM', value: '5', badge: null, star: true })
})

test('a captained card carries the C badge', () => {
  const [job] = jobsFor({
    picks: [{ card: { x: 1, y: 2, w: 3, h: 4 }, panel: null, captain: true, resolved: player({ points: 10 }) }],
    brand: {},
  })
  assert.equal(job.props.badge, 'C')
  assert.equal(job.props.value, '10')
})

test('a pick with the star off renders without one', () => {
  const [job] = jobsFor({
    picks: [{ card: { x: 1, y: 2, w: 3, h: 4 }, panel: null, star: false, resolved: player() }],
    brand: {},
  })
  assert.equal(job.props.star, false)
})

test('six picks give six card jobs in the order they were written', () => {
  const picks = [13, 35, 14, 9, 234, 51].map((id, i) => ({
    card: { x: i, y: 0, w: 10, h: 10 },
    panel: null,
    captain: false,
    resolved: player({ id, cardName: `p${id}` }),
  }))
  const jobs = jobsFor({ picks, brand: {} })
  assert.equal(jobs.length, 6)
  assert.deepEqual(jobs.map((j) => j.props.name), ['p13', 'p35', 'p14', 'p9', 'p234', 'p51'])
})

test('--no-panel drops the panel and keeps the card', () => {
  const jobs = jobsFor({
    picks: [{ card: { x: 1, y: 1, w: 1, h: 1 }, panel: { x: 2, y: 2, w: 2, h: 2 }, resolved: player() }],
    brand: {},
    noPanel: true,
  })
  assert.deepEqual(jobs.map((j) => j.composition), ['CardOnly'])
})

// Painted last so it sits over anything sharing the bar, and padded to zero so
// a solid fill we reproduce exactly does not eat into the picture below it.
test('the text bar is painted last and covers exactly its box', () => {
  const jobs = jobsFor({
    picks: [],
    brand: {
      text: { x: 0, y: 0, w: 10, h: 10 },
      line: 'كلام',
      logo: { x: 1, y: 1, w: 1, h: 1 },
      points: { x: 2, y: 2, w: 2, h: 2 },
      total: '9',
    },
  })
  assert.equal(jobs.at(-1).composition, 'TextLine')
  assert.equal(jobs.at(-1).pad, 0)
})

test('--bar overrides the bar colour only when given', () => {
  const withBar = jobsFor({ picks: [], brand: { text: { x: 0, y: 0, w: 1, h: 1 }, line: 'a', bar: '#101010' } })
  assert.equal(withBar[0].props.background, '#101010')
  const without = jobsFor({ picks: [], brand: { text: { x: 0, y: 0, w: 1, h: 1 }, line: 'a' } })
  assert.equal('background' in without[0].props, false)
})

// ── filters ────────────────────────────────────────────────────────────────

test('each overlay scales to its padded box and chains onto the last', () => {
  const { filters, last } = overlayFilters([
    { box: { x: 100, y: 200, w: 50, h: 60 } },
    { box: { x: 10, y: 20, w: 5, h: 6 }, pad: 0 },
  ])
  const p = COVER_PAD
  assert.deepEqual(filters, [
    `[1:v]scale=${50 + p * 2}:${60 + p * 2}[o0]`,
    `[0:v][o0]overlay=${100 - p}:${200 - p}[v0]`,
    '[2:v]scale=5:6[o1]',
    '[v0][o1]overlay=10:20[v1]',
  ])
  assert.equal(last, '[v1]')
})

test('with no overlays the chain is still the source stream', () => {
  const { filters, last } = overlayFilters([])
  assert.deepEqual(filters, [])
  assert.equal(last, '[0:v]')
})
