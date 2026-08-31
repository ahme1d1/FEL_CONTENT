import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishInstagram, publishFacebookStory } from '../publish/platforms/meta.mjs'

/** Records every call and replies from a scripted queue. */
function recorder(replies = []) {
  const calls = []
  const queue = [...replies]
  const http = async ({ method, path, form }) => {
    calls.push({ method, path, form })
    if (!queue.length) throw new Error(`no scripted reply for ${method} ${path}`)
    return queue.shift()
  }
  return { http, calls }
}

const ctx = (http) => ({ http, igUserId: '17841400000000000', pageId: '1236455056218105' })

const feedPost = {
  id: 'gw03-d1-1100-ig-feed',
  strategy: 'ig-feed',
  caption: 'كهربا جاب 14 نقطة 🔥',
  media: { file: 'a.jpg', mime: 'image/jpeg' },
}
const url = 'https://media.fantasyeg.com/gw03/a.jpg'

test('a feed image creates a container, waits for it, then publishes', async () => {
  const { http, calls } = recorder([
    { id: 'CONTAINER_1' },
    { status_code: 'FINISHED' },
    { id: 'MEDIA_9' },
  ])
  const result = await publishInstagram({ ...ctx(http), post: feedPost, mediaUrl: url })

  assert.equal(result.remoteId, 'MEDIA_9')
  assert.equal(calls.length, 3)

  assert.equal(calls[0].path, '/17841400000000000/media')
  assert.equal(calls[0].form.image_url, url)
  assert.equal(calls[0].form.caption, 'كهربا جاب 14 نقطة 🔥')
  assert.ok(!('media_type' in calls[0].form), 'a plain feed image declares no media_type')

  assert.match(calls[1].path, /^\/CONTAINER_1/)
  assert.equal(calls[2].path, '/17841400000000000/media_publish')
  assert.equal(calls[2].form.creation_id, 'CONTAINER_1')
})

test('a reel sends video_url with media_type REELS', async () => {
  const { http, calls } = recorder([{ id: 'C' }, { status_code: 'FINISHED' }, { id: 'M' }])
  const post = { ...feedPost, strategy: 'ig-reel', media: { file: 'a.mp4', mime: 'video/mp4' } }
  await publishInstagram({ ...ctx(http), post, mediaUrl: url })

  assert.equal(calls[0].form.media_type, 'REELS')
  assert.equal(calls[0].form.video_url, url)
  assert.ok(!('image_url' in calls[0].form))
})

test('a story sends media_type STORIES', async () => {
  const { http, calls } = recorder([{ id: 'C' }, { status_code: 'FINISHED' }, { id: 'M' }])
  await publishInstagram({ ...ctx(http), post: { ...feedPost, strategy: 'ig-story' }, mediaUrl: url })
  assert.equal(calls[0].form.media_type, 'STORIES')
})

// Video containers take 30 to 120 seconds, so publishing is a poll loop.
test('it keeps polling while the container is still processing', async () => {
  const { http, calls } = recorder([
    { id: 'C' },
    { status_code: 'IN_PROGRESS' },
    { status_code: 'IN_PROGRESS' },
    { status_code: 'FINISHED' },
    { id: 'M' },
  ])
  const result = await publishInstagram({
    ...ctx(http),
    post: { ...feedPost, strategy: 'ig-reel', media: { file: 'a.mp4', mime: 'video/mp4' } },
    mediaUrl: url,
    sleep: async () => {},
  })
  assert.equal(result.remoteId, 'M')
  assert.equal(calls.filter((c) => c.method === 'GET').length, 3)
})

test('a container that errors throws instead of publishing', async () => {
  const { http, calls } = recorder([{ id: 'C' }, { status_code: 'ERROR', status: 'bad aspect ratio' }])
  await assert.rejects(
    () => publishInstagram({ ...ctx(http), post: feedPost, mediaUrl: url, sleep: async () => {} }),
    /ERROR|bad aspect ratio/,
  )
  assert.equal(calls.filter((c) => c.path.endsWith('/media_publish')).length, 0, 'must not publish')
})

test('a container that never finishes throws rather than hanging forever', async () => {
  const { http } = recorder(Array(50).fill({ status_code: 'IN_PROGRESS' }).map((r, i) => (i === 0 ? { id: 'C' } : r)))
  await assert.rejects(
    () => publishInstagram({ ...ctx(http), post: feedPost, mediaUrl: url, sleep: async () => {}, maxPolls: 3 }),
    /did not finish/i,
  )
})

test('a facebook story uploads unpublished, then promotes the photo id', async () => {
  const { http, calls } = recorder([{ id: 'PHOTO_7' }, { success: true, post_id: 'STORY_2' }])
  const result = await publishFacebookStory({
    http,
    pageId: '1236455056218105',
    mediaUrl: url,
  })

  assert.equal(calls[0].path, '/1236455056218105/photos')
  assert.equal(calls[0].form.published, 'false')
  assert.equal(calls[0].form.url, url)
  assert.equal(calls[1].path, '/1236455056218105/photo_stories')
  assert.equal(calls[1].form.photo_id, 'PHOTO_7')
  assert.equal(result.remoteId, 'STORY_2')
})

test('an unknown instagram strategy throws rather than guessing', async () => {
  const { http } = recorder([])
  await assert.rejects(
    () => publishInstagram({ ...ctx(http), post: { ...feedPost, strategy: 'ig-carousel' }, mediaUrl: url }),
    /ig-carousel/,
  )
})
