import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPOSIO_TOOLS, publishInstagramViaComposio } from '../publish/platforms/instagram.mjs'

/** Records every call and replies from a scripted queue, like tests/meta.test.mjs. */
function recorder(replies = []) {
  const calls = []
  const queue = [...replies]
  const execute = async ({ tool, args }) => {
    calls.push({ tool, args })
    if (!queue.length) throw new Error(`no scripted reply for ${tool}`)
    const reply = queue.shift()
    if (reply instanceof Error) throw reply
    return reply
  }
  return { execute, calls }
}

const ok = (data) => ({ successful: true, data })
const ctx = (execute) => ({ execute, igUserId: '17841435734309470' })

const feedPost = {
  id: 'gw03-d1-1100-ig-feed',
  strategy: 'ig-feed',
  caption: 'كهربا جاب 14 نقطة 🔥',
  media: { file: 'a.jpg', mime: 'image/jpeg' },
}
const url = 'https://media.fantasyeg.com/gw03/a.jpg'

test('a feed image creates a container, then publishes it', async () => {
  const { execute, calls } = recorder([ok({ id: 'CONTAINER_1' }), ok({ id: 'MEDIA_9' })])
  const result = await publishInstagramViaComposio({ ...ctx(execute), post: feedPost, mediaUrl: url })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].tool, COMPOSIO_TOOLS.container)
  assert.equal(calls[0].args.image_url, url)
  assert.equal(calls[0].args.caption, 'كهربا جاب 14 نقطة 🔥')
  assert.equal(calls[0].args.ig_user_id, '17841435734309470')

  assert.equal(calls[1].tool, COMPOSIO_TOOLS.publish)
  assert.equal(calls[1].args.creation_id, 'CONTAINER_1')
  assert.equal(result.remoteId, 'MEDIA_9')
})

test('a reel sends video_url with media_type REELS', async () => {
  const { execute, calls } = recorder([ok({ id: 'C' }), ok({ id: 'M' })])
  const post = { ...feedPost, strategy: 'ig-reel', media: { file: 'a.mp4', mime: 'video/mp4' } }
  await publishInstagramViaComposio({ ...ctx(execute), post, mediaUrl: url })

  assert.equal(calls[0].args.media_type, 'REELS')
  assert.equal(calls[0].args.video_url, url)
  assert.ok(!('image_url' in calls[0].args))
})

test('a story sends media_type STORIES', async () => {
  const { execute, calls } = recorder([ok({ id: 'C' }), ok({ id: 'M' })])
  await publishInstagramViaComposio({ ...ctx(execute), post: { ...feedPost, strategy: 'ig-story' }, mediaUrl: url })
  assert.equal(calls[0].args.media_type, 'STORIES')
})

// A plain feed image must declare no media_type at all - Meta rejects the
// container if one is sent, which is the same rule the Graph path follows.
test('a plain feed image declares no media_type', async () => {
  const { execute, calls } = recorder([ok({ id: 'C' }), ok({ id: 'M' })])
  await publishInstagramViaComposio({ ...ctx(execute), post: feedPost, mediaUrl: url })
  assert.ok(!('media_type' in calls[0].args))
})

// The whole reason this path exists: it takes a local file, so Instagram does
// not need media.fantasyeg.com to be reachable.
test('a local file is sent instead of a url when one is given', async () => {
  const { execute, calls } = recorder([ok({ id: 'C' }), ok({ id: 'M' })])
  await publishInstagramViaComposio({ ...ctx(execute), post: feedPost, mediaFile: 'gw03/card.jpg' })

  assert.equal(calls[0].args.image_file, 'gw03/card.jpg')
  assert.ok(!('image_url' in calls[0].args), 'a file and a url are alternatives, never both')
})

test('publishing without either a url or a file is refused before any call', async () => {
  const { execute, calls } = recorder([])
  await assert.rejects(() => publishInstagramViaComposio({ ...ctx(execute), post: feedPost }), /mediaUrl|mediaFile/)
  assert.equal(calls.length, 0)
})

test('an unknown instagram strategy throws rather than guessing', async () => {
  const { execute } = recorder([])
  await assert.rejects(
    () => publishInstagramViaComposio({ ...ctx(execute), post: { ...feedPost, strategy: 'ig-carousel' }, mediaUrl: url }),
    /ig-carousel/,
  )
})

// Composio answers 200 with successful:false rather than an HTTP error.
test('an unsuccessful composio result throws instead of publishing', async () => {
  const { execute, calls } = recorder([{ successful: false, error: 'container failed: bad aspect ratio' }])
  await assert.rejects(
    () => publishInstagramViaComposio({ ...ctx(execute), post: feedPost, mediaUrl: url }),
    /bad aspect ratio/,
  )
  assert.equal(calls.length, 1, 'must not attempt the publish step')
})

test('a container with no id throws rather than publishing undefined', async () => {
  const { execute } = recorder([ok({})])
  await assert.rejects(() => publishInstagramViaComposio({ ...ctx(execute), post: feedPost, mediaUrl: url }), /container/i)
})

/* --- Video containers are not publishable the instant they are created --- */

const reelPost = {
  id: 'gw03-d1-1100-ig-reel',
  strategy: 'ig-reel',
  caption: 'فانتازي بلاعيبة الدوري المصري ⚽',
  media: { file: 'a.mp4', mime: 'video/mp4' },
}
const videoUrl = 'https://media.fantasyeg.com/memes/a.mp4'

/** What Instagram actually returns while it is still transcoding a Reel. */
const notReady = {
  successful: false,
  error:
    'Failed to create post (status 400). Response: {"error":{"message":"Media ID is not available",' +
    '"code":9007,"error_subcode":2207027}}',
}

/**
 * Regression, seen publishing a real Reel on 2026-09-03: the first publish came back 9007
 * «Media ID is not available», and the second, ~25s later, succeeded. The comment on this
 * function claimed "the publish tool polls for FINISHED itself, so there is no wait loop here",
 * which holds for an image and not for a video.
 *
 * It matters beyond a one-off: publish.mjs records a failure as `failed`, which due.mjs treats
 * as TERMINAL, so the routine would never retry the post.
 */
test('a reel that is still transcoding is retried rather than failed', async () => {
  const { execute, calls } = recorder([ok({ id: 'C' }), notReady, notReady, ok({ id: 'M' })])
  const result = await publishInstagramViaComposio({
    ...ctx(execute),
    post: reelPost,
    mediaUrl: videoUrl,
    waitMs: 0,
  })

  assert.equal(result.remoteId, 'M')
  assert.equal(calls.length, 4, 'one container, three publish attempts')
  assert.equal(calls[0].tool, COMPOSIO_TOOLS.container)
  // The SAME container is retried; creating a second one would orphan the first.
  for (const c of calls.slice(1)) {
    assert.equal(c.tool, COMPOSIO_TOOLS.publish)
    assert.equal(c.args.creation_id, 'C')
  }
})

test('an image publishes on the first attempt, with no waiting', async () => {
  const { execute, calls } = recorder([ok({ id: 'C' }), ok({ id: 'M' })])
  await publishInstagramViaComposio({ ...ctx(execute), post: feedPost, mediaUrl: url, waitMs: 0 })
  assert.equal(calls.length, 2, 'an image must not pay the video retry cost')
})

test('a reel that never finishes transcoding still throws', async () => {
  const { execute } = recorder([ok({ id: 'C' }), ...Array.from({ length: 12 }, () => notReady)])
  await assert.rejects(
    () => publishInstagramViaComposio({ ...ctx(execute), post: reelPost, mediaUrl: videoUrl, waitMs: 0, attempts: 3 }),
    /publish/,
  )
})

// An error that is not "still transcoding" must surface at once, not be retried for a minute.
test('a real publish error is not mistaken for transcoding', async () => {
  const { execute, calls } = recorder([
    ok({ id: 'C' }),
    { successful: false, error: 'Permissions error: instagram_content_publish missing' },
  ])
  await assert.rejects(
    () => publishInstagramViaComposio({ ...ctx(execute), post: reelPost, mediaUrl: videoUrl, waitMs: 0 }),
    /Permissions/,
  )
  assert.equal(calls.length, 2, 'it should not have retried')
})
