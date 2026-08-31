/**
 * Facebook and Instagram publishing.
 *
 * Both run on the same Page access token, which is why Instagram needed no new
 * credential work. The HTTP layer is injected so the dry run exercises this
 * exact code path rather than a parallel one.
 */

/** Instagram containers for video take 30 to 120 seconds to process. */
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 45

const MEDIA_TYPE = {
  'ig-feed': null, // a plain feed image declares no media_type
  'ig-story': 'STORIES',
  'ig-reel': 'REELS',
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

function containerForm({ post, mediaUrl }) {
  const mediaType = MEDIA_TYPE[post.strategy]
  if (mediaType === undefined) {
    throw new Error(`"${post.strategy}" is not an Instagram strategy. Known: ${Object.keys(MEDIA_TYPE).join(', ')}.`)
  }

  const form = { caption: post.caption ?? '' }
  if (mediaType) form.media_type = mediaType
  if (post.media?.mime?.startsWith('video/')) form.video_url = mediaUrl
  else form.image_url = mediaUrl
  return form
}

async function waitForContainer({ http, containerId, sleep, maxPolls }) {
  for (let i = 0; i < maxPolls; i += 1) {
    const status = await http({ method: 'GET', path: `/${containerId}`, form: { fields: 'status_code,status' } })
    if (status.status_code === 'FINISHED') return
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} came back ${status.status_code}: ${status.status ?? 'no detail'}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Container ${containerId} did not finish after ${maxPolls} polls.`)
}

/**
 * Two steps by design: create a container, then publish it. The quota is
 * enforced on the publish call, not on container creation.
 * @returns {Promise<{remoteId: string, containerId: string}>}
 */
export async function publishInstagram({
  http,
  igUserId,
  post,
  mediaUrl,
  sleep = defaultSleep,
  maxPolls = MAX_POLLS,
}) {
  const form = containerForm({ post, mediaUrl })

  const container = await http({ method: 'POST', path: `/${igUserId}/media`, form })
  if (!container?.id) throw new Error(`No container id came back for ${post.id}.`)

  await waitForContainer({ http, containerId: container.id, sleep, maxPolls })

  const published = await http({
    method: 'POST',
    path: `/${igUserId}/media_publish`,
    form: { creation_id: container.id },
  })
  if (!published?.id) throw new Error(`No media id came back publishing ${post.id}.`)

  return { remoteId: published.id, containerId: container.id }
}

/**
 * Facebook stories are a two-step the feed does not need: upload the photo
 * unpublished, then promote that photo id to a story.
 * @returns {Promise<{remoteId: string, photoId: string}>}
 */
export async function publishFacebookStory({ http, pageId, mediaUrl }) {
  const photo = await http({
    method: 'POST',
    path: `/${pageId}/photos`,
    form: { url: mediaUrl, published: 'false' },
  })
  if (!photo?.id) throw new Error('No photo id came back from the unpublished upload.')

  const story = await http({
    method: 'POST',
    path: `/${pageId}/photo_stories`,
    form: { photo_id: photo.id },
  })

  return { remoteId: story.post_id ?? story.id ?? photo.id, photoId: photo.id }
}
