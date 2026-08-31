import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceKey, planRenders, mediaName, stampManifest } from '../build/render-plan.mjs'

const cardPost = (over = {}) => ({
  id: 'gw03-d1-1100-ig-feed',
  slotCairo: '2026-09-03 11:00 Africa/Cairo',
  strategy: 'ig-feed',
  source: { card: 'P_WINNER_THEIR_TEAM', texts: { 0: 'بطل الجولة' }, assets: { 0: 'AHL' } },
  media: null,
  ...over,
})
const manifest = (posts) => ({ schemaVersion: 1, gameweek: 3, mediaBase: 'https://m/gw03', posts })

test('sourceKey ignores key order, so equal content dedupes', () => {
  const a = { card: 'X', texts: { 0: 'a', 1: 'b' }, assets: { 0: 'AHL' } }
  const b = { assets: { 0: 'AHL' }, texts: { 1: 'b', 0: 'a' }, card: 'X' }
  assert.equal(sourceKey(a), sourceKey(b))
})

test('sourceKey separates different content', () => {
  assert.notEqual(
    sourceKey({ card: 'X', texts: { 0: 'a' } }),
    sourceKey({ card: 'X', texts: { 0: 'b' } }),
  )
})

// Same bytes must give the same URL, so the same card with the same content is
// rendered once and shared, not rendered twice into two identical files.
test('two posts with identical sources become one render job', () => {
  const posts = [
    cardPost({ id: 'fb', strategy: 'fb-scheduled', slotCairo: '2026-09-03 10:30 Africa/Cairo' }),
    cardPost({ id: 'ig', strategy: 'ig-feed' }),
  ]
  const plan = planRenders(manifest(posts))
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].postIds.sort(), ['fb', 'ig'])
})

test('different content stays as separate jobs', () => {
  const posts = [
    cardPost({ id: 'a' }),
    cardPost({ id: 'b', source: { card: 'P_WINNER_THEIR_TEAM', texts: { 0: 'حاجة تانية' }, assets: {} } }),
  ]
  assert.equal(planRenders(manifest(posts)).length, 2)
})

test('video posts are not card jobs; Remotion renders those', () => {
  const posts = [
    cardPost({ id: 'card' }),
    cardPost({ id: 'reel', strategy: 'ig-reel', source: { composition: 'TeamOfTheWeek', props: {} } }),
  ]
  const plan = planRenders(manifest(posts))
  assert.deepEqual(plan.map((j) => j.postIds).flat(), ['card'])
})

test('posts with no source at all are skipped, not crashed on', () => {
  const posts = [cardPost({ id: 'text', strategy: 'fb-text', source: null })]
  assert.deepEqual(planRenders(manifest(posts)), [])
})

test('a job carries the render-cards.mjs job shape', () => {
  const [job] = planRenders(manifest([cardPost({ source: { card: 'C', texts: { 0: 'x' }, assets: { 0: 'AHL' }, keepNames: true } })]))
  assert.equal(job.job.card, 'C')
  assert.deepEqual(job.job.texts, { 0: 'x' })
  assert.deepEqual(job.job.assets, { 0: 'AHL' })
  assert.equal(job.job.keepNames, true)
  assert.match(job.job.file, /\.png$/, 'the tool exports PNG; we convert afterwards')
})

test('the earliest slot in a shared group names the file', () => {
  const posts = [
    cardPost({ id: 'late', slotCairo: '2026-09-03 16:00 Africa/Cairo' }),
    cardPost({ id: 'early', slotCairo: '2026-09-03 10:30 Africa/Cairo' }),
  ]
  const [job] = planRenders(manifest(posts))
  assert.equal(mediaName(job, 'abcdef1234567890'), '1030-p-winner-their-team-abcdef12.jpg')
})

test('the filename carries the first 8 hex of the sha, so bytes and URL agree', () => {
  const [job] = planRenders(manifest([cardPost()]))
  const name = mediaName(job, '9f2c7a41b3d5e6f7')
  assert.ok(name.endsWith('-9f2c7a41.jpg'))
  assert.ok(name.startsWith('1100-'))
})

test('an explicit slug overrides the derived one', () => {
  const [job] = planRenders(manifest([cardPost({ source: { card: 'P_WINNER_THEIR_TEAM', slug: 'winner', texts: {} } })]))
  assert.equal(mediaName(job, 'aaaaaaaabbbb'), '1100-winner-aaaaaaaa.jpg')
})

test('stampManifest returns a new manifest and never mutates the original', () => {
  const original = manifest([cardPost()])
  const frozen = JSON.stringify(original)
  const stamped = stampManifest(original, [
    { postIds: ['gw03-d1-1100-ig-feed'], file: 'x.jpg', sha256: 'a'.repeat(64), bytes: 123, width: 1080, height: 1350, mime: 'image/jpeg' },
  ])
  assert.equal(JSON.stringify(original), frozen, 'the input must be untouched')
  assert.notEqual(stamped, original)
  assert.deepEqual(stamped.posts[0].media, {
    file: 'x.jpg', sha256: 'a'.repeat(64), bytes: 123, mime: 'image/jpeg', width: 1080, height: 1350,
  })
})

test('stampManifest fills every post that shared a render', () => {
  const posts = [cardPost({ id: 'fb', strategy: 'fb-scheduled' }), cardPost({ id: 'ig' })]
  const stamped = stampManifest(manifest(posts), [
    { postIds: ['fb', 'ig'], file: 'shared.jpg', sha256: 'b'.repeat(64), bytes: 9, width: 1080, height: 1350, mime: 'image/jpeg' },
  ])
  assert.equal(stamped.posts[0].media.file, 'shared.jpg')
  assert.equal(stamped.posts[1].media.file, 'shared.jpg')
  assert.equal(stamped.posts[0].media.sha256, stamped.posts[1].media.sha256)
})

test('stampManifest leaves posts it has no result for alone', () => {
  const stamped = stampManifest(manifest([cardPost({ id: 'untouched' })]), [])
  assert.equal(stamped.posts[0].media, null)
})
