import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEDULE_CEILING_MS, SCHEDULE_FLOOR_MS, selectSchedulable } from '../publish/schedule-plan.mjs'

const post = (over = {}) => ({
  id: 'gw04-d1-2000-fb-feed',
  publishAt: '2026-09-04T17:00:00Z',
  strategy: 'fb-scheduled',
  caption: 'الجولة الجاية فتحت 🔜\nجهّز فريقك ⏰',
  media: { file: 'x.jpg', sha256: 'a'.repeat(64) },
  ...over,
})
const manifest = (posts) => ({ schemaVersion: 1, gameweek: 4, posts })
const NOW = new Date('2026-09-01T09:00:00Z')
const select = (posts, ledger = [], now = NOW) =>
  selectSchedulable({ manifest: manifest(posts), ledger, now })

const ids = (list) => list.map((p) => p.id)

// due.mjs deliberately skips these two strategies because "the authoring pass handles them".
// This is that pass. Anything the routine fires must never be touched here, or one post goes out
// twice from two different processes.
test('only the two strategies the routine refuses are scheduled here', () => {
  const posts = [
    post({ id: 'photo', strategy: 'fb-scheduled' }),
    post({ id: 'text', strategy: 'fb-text', media: null }),
    post({ id: 'story', strategy: 'fb-story' }),
    post({ id: 'ig', strategy: 'ig-feed' }),
    post({ id: 'tik', strategy: 'tiktok-draft' }),
  ]
  assert.deepEqual(ids(select(posts).toSchedule).sort(), ['photo', 'text'])
})

test('a post already scheduled is left alone', () => {
  const ledger = [{ id: 'gw04-d1-2000-fb-feed', state: 'scheduled' }]
  const out = select([post()], ledger)
  assert.deepEqual(out.toSchedule, [])
  assert.deepEqual(ids(out.alreadyScheduled), ['gw04-d1-2000-fb-feed'])
})

// The same rule publish.mjs lives by: a claim was flushed before the call, so a claim with no
// outcome means we do not know whether the post exists. A duplicate on a live page is worse.
test('a claim that never closed out is reported, never re-sent', () => {
  const out = select([post()], [{ id: 'gw04-d1-2000-fb-feed', state: 'claimed' }])
  assert.deepEqual(out.toSchedule, [])
  assert.deepEqual(ids(out.crashed), ['gw04-d1-2000-fb-feed'])
})

test('a failure stays closed until a human looks, as it does in the routine', () => {
  const out = select([post()], [{ id: 'gw04-d1-2000-fb-feed', state: 'failed' }])
  assert.deepEqual(out.toSchedule, [])
  assert.deepEqual(out.crashed, [])
})

test('the latest state wins, so a retry after reconciliation goes through', () => {
  const ledger = [
    { id: 'gw04-d1-2000-fb-feed', state: 'claimed' },
    { id: 'gw04-d1-2000-fb-feed', state: 'scheduled' },
  ]
  assert.deepEqual(ids(select([post()], ledger).alreadyScheduled), ['gw04-d1-2000-fb-feed'])
})

/* ─────────────── the window Facebook will accept ─────────────── */

test('a time inside Facebook ten-minute floor is refused before the request', () => {
  const soon = new Date(NOW.getTime() + SCHEDULE_FLOOR_MS - 60_000).toISOString()
  const out = select([post({ publishAt: soon })])
  assert.deepEqual(out.toSchedule, [])
  assert.equal(out.tooSoon.length, 1)
})

test('a slot that has already gone cannot be scheduled, and says so', () => {
  const out = select([post({ publishAt: '2026-08-30T17:00:00Z' })])
  assert.deepEqual(out.toSchedule, [])
  assert.match(out.tooSoon[0].reason, /already passed/)
})

test('a time past the six-month ceiling is refused before the request', () => {
  const far = new Date(NOW.getTime() + SCHEDULE_CEILING_MS + 86_400_000).toISOString()
  const out = select([post({ publishAt: far })])
  assert.deepEqual(out.toSchedule, [])
  assert.equal(out.tooFar.length, 1)
})

test('a time comfortably inside the window is scheduled', () => {
  assert.equal(select([post()]).toSchedule.length, 1)
})

/* ─────────────── copy that is not written yet ─────────────── */

// The author leaves a null caption on the posts that name a real person. Facebook would happily
// publish a photo with no words at all.
test('a post with no caption written is held back, not published wordless', () => {
  const out = select([post({ caption: null })])
  assert.deepEqual(out.toSchedule, [])
  assert.equal(out.needsCaption.length, 1)
})

test('a text post with no caption is nothing at all', () => {
  const out = select([post({ strategy: 'fb-text', media: null, caption: null })])
  assert.equal(out.needsCaption.length, 1)
})

/* ─────────────── ordering ─────────────── */

test('posts are scheduled in the order they will publish', () => {
  const posts = [
    post({ id: 'late', publishAt: '2026-09-08T17:00:00Z' }),
    post({ id: 'early', publishAt: '2026-09-04T17:00:00Z' }),
  ]
  assert.deepEqual(ids(select(posts).toSchedule), ['early', 'late'])
})
