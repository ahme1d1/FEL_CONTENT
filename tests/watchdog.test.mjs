import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assess, BACKLOG_GRACE_MINUTES } from '../publish/watchdog-plan.mjs'

// The watchdog answers one question: is anything owed that has not gone out? It asks `selectDue`
// rather than keeping its own idea of lateness, so there is exactly one definition of "late" in
// the repo and the alarm cannot drift away from what the publisher actually does.
const post = (over = {}) => ({
  id: 'gw03-d7-1200-ig-feed',
  publishAt: '2026-09-04T09:00:00Z',
  platform: 'instagram',
  strategy: 'ig-feed',
  caption: 'بطل الجولة 🏆',
  ...over,
})

const manifest = (posts, gameweek = 3) => ({ schemaVersion: 1, gameweek, posts })
const at = (iso) => new Date(iso)
const kinds = (r) => r.alarms.map((a) => a.kind)

test('a quiet day is quiet: nothing due, no alarm', () => {
  const r = assess({
    manifests: [manifest([post()])],
    ledger: [{ id: 'gw03-d7-1200-ig-feed', state: 'published' }],
    now: at('2026-09-04T20:00:00Z'),
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.alarms, [])
})

// The false positive worth designing against. An empty ledger on a day with nothing scheduled is
// the normal morning state; an age check would cry wolf every single day.
test('an untouched ledger is not an alarm when nothing is due', () => {
  const r = assess({
    manifests: [manifest([post({ publishAt: '2026-09-05T09:00:00Z' })])],
    ledger: [],
    now: at('2026-09-04T20:00:00Z'),
  })
  assert.equal(r.ok, true)
})

test('a post due but inside the grace period is not yet an alarm', () => {
  const r = assess({
    manifests: [manifest([post()])],
    ledger: [],
    now: at('2026-09-04T10:00:00Z'), // 60 min late, grace is 90
  })
  assert.equal(r.ok, true)
})

test('a post past the grace period raises a backlog alarm', () => {
  const r = assess({
    manifests: [manifest([post()])],
    ledger: [],
    now: at('2026-09-04T10:31:00Z'), // 91 min late
  })
  assert.equal(r.ok, false)
  assert.deepEqual(kinds(r), ['backlog'])
  assert.equal(r.alarms[0].posts[0].id, 'gw03-d7-1200-ig-feed')
  assert.equal(r.alarms[0].posts[0].lateMinutes, 91)
})

// The grace exists to leave room to act. due.mjs deletes at 360 minutes, so an alarm at 90 leaves
// four and a half hours — enough to be woken up, look, and dispatch by hand.
test('the grace period leaves headroom before due.mjs deletes the post', () => {
  assert.ok(BACKLOG_GRACE_MINUTES < 360 / 2)
})

test('a post already deleted for lateness is the loudest alarm', () => {
  const r = assess({
    manifests: [manifest([post()])],
    ledger: [],
    now: at('2026-09-04T16:00:00Z'), // 7h late — selectDue calls this skipped
  })
  assert.equal(r.ok, false)
  assert.ok(kinds(r).includes('lost'))
  assert.equal(r.alarms.find((a) => a.kind === 'lost').posts[0].id, 'gw03-d7-1200-ig-feed')
})

test('a post claimed but never closed out needs reconciling, never re-posting', () => {
  const r = assess({
    manifests: [manifest([post()])],
    ledger: [{ id: 'gw03-d7-1200-ig-feed', state: 'claimed' }],
    now: at('2026-09-04T10:00:00Z'),
  })
  assert.equal(r.ok, false)
  assert.deepEqual(kinds(r), ['stuck'])
})

test('a post held for a caption is reported but is not an alarm', () => {
  const r = assess({
    manifests: [manifest([post({ caption: '' })])],
    ledger: [],
    now: at('2026-09-04T16:00:00Z'),
  })
  assert.equal(r.ok, true)
  assert.equal(r.heldForCaption.length, 1)
})

test('every manifest is checked, and the alarm names the one at fault', () => {
  const r = assess({
    manifests: [
      manifest([post({ id: 'gw03-a-ig-feed' })], 3),
      manifest([post({ id: 'gw04-b-ig-feed' })], 4),
    ],
    ledger: [{ id: 'gw03-a-ig-feed', state: 'published' }],
    now: at('2026-09-04T10:31:00Z'),
  })
  assert.equal(r.ok, false)
  assert.deepEqual(
    r.alarms[0].posts.map((p) => p.id),
    ['gw04-b-ig-feed'],
  )
  assert.equal(r.alarms[0].posts[0].gameweek, 4)
})

// Facebook feed posts sit in Meta's own planner and do not wait for the routine, so a late one
// says nothing about the clock. Only the four strategies due.mjs fires can raise a backlog.
test('a Facebook feed post is not the clock’s problem', () => {
  const r = assess({
    manifests: [manifest([post({ id: 'gw03-d7-1200-fb-feed', strategy: 'fb-feed' })])],
    ledger: [],
    now: at('2026-09-04T16:00:00Z'),
  })
  assert.equal(r.ok, true)
})

test('the grace period is configurable, because 90 minutes is a judgement not a law', () => {
  const args = {
    manifests: [manifest([post()])],
    ledger: [],
    now: at('2026-09-04T09:31:00Z'), // 31 min late
  }
  assert.equal(assess(args).ok, true)
  assert.equal(assess({ ...args, maxBacklogMinutes: 30 }).ok, false)
})

test('the summary carries enough to write an issue without re-reading the ledger', () => {
  const r = assess({
    manifests: [manifest([post()])],
    ledger: [],
    now: at('2026-09-04T10:31:00Z'),
  })
  assert.match(r.summary, /gw03-d7-1200-ig-feed/)
  assert.match(r.summary, /91/)
})

test('assess mutates nothing it is given', () => {
  const posts = [post()]
  const m = manifest(posts)
  const ledger = []
  const before = JSON.stringify({ m, ledger })
  assess({ manifests: [m], ledger, now: at('2026-09-04T16:00:00Z') })
  assert.equal(JSON.stringify({ m, ledger }), before)
})
