import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleFacebookVideo } from '../publish/platforms/fb-schedule.mjs'
import { STRATEGIES } from '../build/manifest-schema.mjs'
import { selectSchedulable } from '../publish/schedule-plan.mjs'
import { routeFor } from '../publish/route.mjs'

const post = (over = {}) => ({
  id: 'gw04-d2-2000-fb-video',
  publishAt: '2026-09-07T17:00:00Z',
  strategy: 'fb-video',
  platform: 'facebook',
  caption: 'مين فيهم يستاهل فلوسه؟',
  media: { file: 'v.mp4', sha256: 'a'.repeat(64), mime: 'video/mp4', width: 1080, height: 1920, bytes: 1, durationSeconds: 9 },
  ...over,
})

test('fb-video is a facebook video strategy that wants a vertical mp4', () => {
  const spec = STRATEGIES['fb-video']
  assert.ok(spec, 'fb-video must be a known strategy')
  assert.equal(spec.platform, 'facebook')
  assert.equal(spec.media, 'video')
  assert.deepEqual(spec.mimes, ['video/mp4'])
  assert.equal(spec.aspect, 'vertical')
})

/**
 * The video endpoint is not the photo endpoint with a different file: it takes
 * `file_url` rather than `url`, and `description` rather than `message`. Sending
 * the photo form to /videos posts a caption-less video.
 */
test('a scheduled video posts to /videos with file_url and description', async () => {
  const calls = []
  const http = async (req) => {
    calls.push(req)
    return { id: '123', post_id: '456_123' }
  }
  const out = await scheduleFacebookVideo({ http, pageId: 'P1', post: post(), mediaUrl: 'https://m/v.mp4' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/P1/videos')
  assert.equal(calls[0].form.file_url, 'https://m/v.mp4')
  assert.equal(calls[0].form.description, 'مين فيهم يستاهل فلوسه؟')
  assert.equal(calls[0].form.published, 'false')
  assert.equal(calls[0].form.scheduled_publish_time, String(Math.floor(Date.parse('2026-09-07T17:00:00Z') / 1000)))
  assert.ok(!('message' in calls[0].form), '/videos ignores message, so sending it hides the caption')
  assert.ok(!('url' in calls[0].form), '/videos ignores url, so the video would have no file')
  assert.equal(out.remoteId, '456_123')
})

test('a video with no caption is refused rather than published wordless', async () => {
  await assert.rejects(
    () => scheduleFacebookVideo({ http: async () => ({}), pageId: 'P1', post: post({ caption: '  ' }), mediaUrl: 'https://m/v.mp4' }),
    /caption/,
  )
})

test('a response with no id throws', async () => {
  await assert.rejects(
    () => scheduleFacebookVideo({ http: async () => ({}), pageId: 'P1', post: post(), mediaUrl: 'https://m/v.mp4' }),
    /no id/,
  )
})

// fb-video is scheduled by Meta during the authoring pass, exactly like fb-scheduled --
// so the authoring pass must claim it and the routine must refuse it. If both took it,
// the post would go out twice.
test('the authoring pass schedules fb-video', () => {
  const manifest = { schemaVersion: 1, mediaBase: 'https://m/gw04', posts: [post()] }
  const plan = selectSchedulable({ manifest, ledger: [], now: new Date('2026-09-07T00:00:00Z') })
  assert.deepEqual(plan.toSchedule.map((p) => p.id), ['gw04-d2-2000-fb-video'])
})

test('the routine refuses fb-video, so it cannot double-post', () => {
  assert.throws(() => routeFor('fb-video'), /scheduled at authoring time/)
})
