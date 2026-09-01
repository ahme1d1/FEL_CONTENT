import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectDue, isTerminal, latestState } from '../publish/due.mjs'

// A caption is part of a publishable post, not decoration: selectDue holds anything without one,
// because instagram.mjs sends `post.caption ?? ''` and would otherwise post a bare image.
const post = (over = {}) => ({
  id: 'gw03-d1-1100-ig-feed',
  publishAt: '2026-09-03T08:00:00Z',
  platform: 'instagram',
  strategy: 'ig-feed',
  caption: 'بدأنا 🔴',
  ...over,
})

const manifest = (posts) => ({ schemaVersion: 1, gameweek: 3, posts })
const at = (iso) => new Date(iso)
const ids = (list) => list.map((p) => p.id)

test('nothing is due before its publishAt', () => {
  const r = selectDue({ manifest: manifest([post()]), ledger: [], now: at('2026-09-03T07:00:00Z') })
  assert.deepEqual(ids(r.due), [])
})

test('a post is due at its publishAt', () => {
  const r = selectDue({ manifest: manifest([post()]), ledger: [], now: at('2026-09-03T08:00:00Z') })
  assert.deepEqual(ids(r.due), ['gw03-d1-1100-ig-feed'])
})

test('a post already published is not due again', () => {
  const ledger = [
    { id: 'gw03-d1-1100-ig-feed', state: 'claimed' },
    { id: 'gw03-d1-1100-ig-feed', state: 'published', remoteId: '123' },
  ]
  const r = selectDue({ manifest: manifest([post()]), ledger, now: at('2026-09-03T08:05:00Z') })
  assert.deepEqual(ids(r.due), [])
})

// A duplicate on a public brand account is much worse than a miss, so a run that
// claimed and then died is never retried blind. It is reported for reconciliation.
test('a claimed post with no terminal record is reported crashed, never retried', () => {
  const ledger = [{ id: 'gw03-d1-1100-ig-feed', state: 'claimed' }]
  const r = selectDue({ manifest: manifest([post()]), ledger, now: at('2026-09-03T08:30:00Z') })
  assert.deepEqual(ids(r.due), [], 'must not re-post')
  assert.deepEqual(ids(r.crashed), ['gw03-d1-1100-ig-feed'])
})

test('a post past its lateness budget is skipped, not posted', () => {
  const r = selectDue({ manifest: manifest([post()]), ledger: [], now: at('2026-09-03T15:00:00Z') })
  assert.deepEqual(ids(r.due), [])
  assert.deepEqual(ids(r.skipped), ['gw03-d1-1100-ig-feed'])
})

test('a later routine picks up an earlier slot that never fired', () => {
  const r = selectDue({ manifest: manifest([post()]), ledger: [], now: at('2026-09-03T12:00:00Z') })
  assert.deepEqual(ids(r.due), ['gw03-d1-1100-ig-feed'], 'within the 6h budget, so it self-heals')
})

// A deadline reminder five hours late is worse than silence, so time-critical
// posts declare a tighter budget than the default.
test('a post may declare a tighter lateness budget', () => {
  const tight = post({ id: 'gw03-deadline', maxLatenessMinutes: 30 })
  const r = selectDue({ manifest: manifest([tight]), ledger: [], now: at('2026-09-03T09:00:00Z') })
  assert.deepEqual(ids(r.due), [])
  assert.deepEqual(ids(r.skipped), ['gw03-deadline'])
})

test('strategies that fire at authoring time are never picked up by a routine', () => {
  const posts = [
    post({ id: 'a', platform: 'facebook', strategy: 'fb-scheduled' }),
    post({ id: 'b', platform: 'facebook', strategy: 'fb-text' }),
    post({ id: 'c', platform: 'tiktok', strategy: 'tiktok-draft' }),
    post({ id: 'd', platform: 'facebook', strategy: 'fb-story' }),
  ]
  const r = selectDue({ manifest: manifest(posts), ledger: [], now: at('2026-09-03T08:00:00Z') })
  assert.deepEqual(ids(r.due), ['d'], 'only fb-story waits for the routine')
})

test('a failed post is terminal and is not retried automatically', () => {
  const ledger = [
    { id: 'gw03-d1-1100-ig-feed', state: 'claimed' },
    { id: 'gw03-d1-1100-ig-feed', state: 'failed', error: 'container rejected' },
  ]
  const r = selectDue({ manifest: manifest([post()]), ledger, now: at('2026-09-03T08:30:00Z') })
  assert.deepEqual(ids(r.due), [])
  assert.deepEqual(ids(r.crashed), [])
})

test('a drafted post is terminal and distinct from published', () => {
  assert.equal(isTerminal('drafted'), true)
  assert.equal(isTerminal('published'), true)
  assert.equal(isTerminal('failed'), true)
  assert.equal(isTerminal('skipped'), true)
  assert.equal(isTerminal('claimed'), false)
})

test('latestState reads the last record for an id and ignores others', () => {
  const ledger = [
    { id: 'a', state: 'claimed' },
    { id: 'b', state: 'claimed' },
    { id: 'a', state: 'published' },
  ]
  assert.equal(latestState(ledger, 'a'), 'published')
  assert.equal(latestState(ledger, 'b'), 'claimed')
  assert.equal(latestState(ledger, 'zzz'), null)
})

test('dependsOn holds a post back until its dependency has published', () => {
  const posts = [
    post({ id: 'photo', strategy: 'fb-story', platform: 'facebook' }),
    post({ id: 'story', strategy: 'fb-story', platform: 'facebook', dependsOn: 'photo' }),
  ]
  const empty = selectDue({ manifest: manifest(posts), ledger: [], now: at('2026-09-03T08:00:00Z') })
  assert.deepEqual(ids(empty.due), ['photo'], 'the dependent waits')

  const after = selectDue({
    manifest: manifest(posts),
    ledger: [{ id: 'photo', state: 'published' }],
    now: at('2026-09-03T08:00:00Z'),
  })
  assert.deepEqual(ids(after.due), ['story'])
})

test('due posts come back in publish order, earliest first', () => {
  const posts = [
    post({ id: 'late', publishAt: '2026-09-03T09:00:00Z', strategy: 'fb-story', platform: 'facebook' }),
    post({ id: 'early', publishAt: '2026-09-03T08:00:00Z', strategy: 'fb-story', platform: 'facebook' }),
  ]
  const r = selectDue({ manifest: manifest(posts), ledger: [], now: at('2026-09-03T09:30:00Z') })
  assert.deepEqual(ids(r.due), ['early', 'late'])
})


// The backstop for schedule-plan.mjs's own check. Every caption kind is templated since
// 2026-09-02, so this should never fire on a real manifest - which is exactly why it exists.
test('a post with no caption is held, not published', () => {
  for (const caption of [null, undefined, '', '   ']) {
    const r = selectDue({
      manifest: manifest([post({ caption })]),
      ledger: [],
      now: at('2026-09-03T08:00:00Z'),
    })
    assert.deepEqual(ids(r.due), [], `caption ${JSON.stringify(caption)} should not publish`)
    assert.deepEqual(ids(r.needsCaption), ['gw03-d1-1100-ig-feed'])
  }
})

// Held is not skipped. A skipped post has missed its window for good; a held one publishes the
// moment somebody writes the copy, so nothing may be written to the ledger to close it out.
test('a held post stays publishable once its caption arrives', () => {
  const withCaption = post({ caption: 'الجولة خلصت ✅ بكرة نشوف مين طلع الأول 🏆' })
  const r = selectDue({
    manifest: manifest([withCaption]),
    ledger: [],
    now: at('2026-09-03T08:00:00Z'),
  })
  assert.deepEqual(ids(r.due), ['gw03-d1-1100-ig-feed'])
  assert.deepEqual(ids(r.needsCaption), [])
})
