import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planUnschedule, UNSCHEDULED } from '../publish/unschedule-plan.mjs'
import { selectSchedulable } from '../publish/schedule-plan.mjs'

const post = (id, over = {}) => ({
  id,
  strategy: 'fb-scheduled',
  publishAt: '2026-09-04T11:00:00Z',
  caption: 'كلام',
  media: { sha256: 'a'.repeat(64) },
  ...over,
})

const MANIFEST = { posts: [post('gw03-d7-1400-fb-feed'), post('gw03-d7-2000-fb-feed'), post('gw03-d7-1200-fb-feed')] }
const led = (id, state, extra = {}) => ({ ts: '2026-09-04T03:00:00.000Z', id, state, ...extra })

test('a scheduled post is planned for deletion, carrying the remote id to delete', () => {
  const ledger = [led('gw03-d7-1400-fb-feed', 'claimed'), led('gw03-d7-1400-fb-feed', 'scheduled', { remoteId: '122' })]
  const plan = planUnschedule({ manifest: MANIFEST, ledger, ids: ['gw03-d7-1400-fb-feed'] })
  assert.deepEqual(plan.toDelete, [{ id: 'gw03-d7-1400-fb-feed', remoteId: '122' }])
  assert.deepEqual(plan.notScheduled, [])
  assert.deepEqual(plan.unknown, [])
})

// Deleting something Facebook never took is not an error, but it must not be reported as a deletion
// either — the operator asked for a state, and it is already in it.
test('a post Facebook never took is reported, not deleted', () => {
  const plan = planUnschedule({ manifest: MANIFEST, ledger: [], ids: ['gw03-d7-1400-fb-feed'] })
  assert.deepEqual(plan.toDelete, [])
  assert.deepEqual(plan.notScheduled, ['gw03-d7-1400-fb-feed'])
})

// A typo in an id must not silently unschedule nothing and report success.
test('an id that is not in the manifest is refused by name', () => {
  const plan = planUnschedule({ manifest: MANIFEST, ledger: [], ids: ['gw03-d7-9999-fb-feed'] })
  assert.deepEqual(plan.unknown, ['gw03-d7-9999-fb-feed'])
})

// A post already published is gone from our side. Deleting a LIVE post is a different, louder act
// than pulling one out of a queue, and this tool must never be the thing that does it by accident.
test('a published post is never planned for deletion', () => {
  const ledger = [led('gw03-d7-1400-fb-feed', 'scheduled', { remoteId: '122' }), led('gw03-d7-1400-fb-feed', 'published', { remoteId: '122' })]
  const plan = planUnschedule({ manifest: MANIFEST, ledger, ids: ['gw03-d7-1400-fb-feed'] })
  assert.deepEqual(plan.toDelete, [])
  assert.deepEqual(plan.notScheduled, ['gw03-d7-1400-fb-feed'])
})

// The whole point: after the unschedule entry lands, the ordinary scheduler must offer the post
// again. If this fails the post is stranded — deleted at Facebook and never re-sent.
test('an unscheduled post is offered to the scheduler again', () => {
  const before = [led('gw03-d7-1400-fb-feed', 'scheduled', { remoteId: '122' })]
  const now = new Date('2026-09-04T06:00:00Z')

  const held = selectSchedulable({ manifest: MANIFEST, ledger: before, now })
  assert.ok(held.alreadyScheduled.some((p) => p.id === 'gw03-d7-1400-fb-feed'), 'held while scheduled')

  const after = [...before, led('gw03-d7-1400-fb-feed', UNSCHEDULED)]
  const reopened = selectSchedulable({ manifest: MANIFEST, ledger: after, now })
  assert.ok(reopened.toSchedule.some((p) => p.id === 'gw03-d7-1400-fb-feed'), 'offered again once unscheduled')
  assert.equal(reopened.alreadyScheduled.some((p) => p.id === 'gw03-d7-1400-fb-feed'), false)
})

test('duplicate ids are collapsed so nothing is deleted twice', () => {
  const ledger = [led('gw03-d7-1400-fb-feed', 'scheduled', { remoteId: '122' })]
  const ids = ['gw03-d7-1400-fb-feed', 'gw03-d7-1400-fb-feed']
  assert.equal(planUnschedule({ manifest: MANIFEST, ledger, ids }).toDelete.length, 1)
})
