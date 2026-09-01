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
