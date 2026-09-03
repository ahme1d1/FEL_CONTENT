/**
 * Handing a post to Facebook's own scheduler.
 *
 * `published=false` plus `scheduled_publish_time` puts the post in the Page's Planner, where it
 * stays editable and deletable until it goes out — which is the whole reason the routine does not
 * fire these: Meta holds them, so a laptop being closed cannot cost a post.
 *
 * The HTTP layer is injected, like every other publisher here, so the dry run exercises this exact
 * code path rather than a parallel one.
 */

/**
 * Facebook wants the time as a Unix epoch in SECONDS, UTC. Anything built from a local-time
 * constructor lands three hours out in Cairo, which is why `publishAt` is absolute to begin with.
 */
export const epochSeconds = (iso) => Math.floor(Date.parse(iso) / 1000)

function scheduledForm(post) {
  if (typeof post.caption !== 'string' || !post.caption.trim()) {
    throw new Error(`${post.id} has no caption; Facebook would publish it wordless.`)
  }
  const at = epochSeconds(post.publishAt)
  if (!Number.isFinite(at)) throw new Error(`${post.id} has no usable publishAt.`)

  return { message: post.caption, published: 'false', scheduled_publish_time: String(at) }
}

/**
 * A card, scheduled.
 *
 * The bytes are pulled by Meta from `mediaBase` rather than uploaded from here. They are already
 * public — that is why this repo is public — and already hash-verified against the manifest, so a
 * multipart upload would only add a way for the two to disagree.
 *
 * @returns {Promise<{remoteId: string}>}
 */
export async function scheduleFacebookPhoto({ http, pageId, post, mediaUrl }) {
  const body = await http({
    method: 'POST',
    path: `/${pageId}/photos`,
    form: { ...scheduledForm(post), url: mediaUrl },
  })

  const remoteId = body.post_id ?? body.id
  if (!remoteId) throw new Error(`Scheduling ${post.id} returned no id.`)
  return { remoteId }
}

/**
 * Words only. The one link a gameweek carries rides here as a real `link`, so Facebook renders
 * its preview instead of leaving a bare URL in the text.
 *
 * @returns {Promise<{remoteId: string}>}
 */
export async function scheduleFacebookText({ http, pageId, post }) {
  const form = scheduledForm(post)
  if (post.link) form.link = post.link

  const body = await http({ method: 'POST', path: `/${pageId}/feed`, form })
  if (!body.id) throw new Error(`Scheduling ${post.id} returned no id.`)
  return { remoteId: body.id }
}

/**
 * A short, scheduled.
 *
 * The Graph video endpoint is NOT the photo endpoint with a different file. It reads `file_url`
 * where /photos reads `url`, and `description` where /photos reads `message` — send the photo
 * form here and Facebook accepts it, then publishes a video with no words on it.
 *
 * Like a card, the bytes are pulled by Meta from `mediaBase` rather than uploaded from here.
 *
 * @returns {Promise<{remoteId: string}>}
 */
export async function scheduleFacebookVideo({ http, pageId, post, mediaUrl }) {
  const { message, ...timing } = scheduledForm(post)

  const body = await http({
    method: 'POST',
    path: `/${pageId}/videos`,
    form: { ...timing, description: message, file_url: mediaUrl },
  })

  const remoteId = body.post_id ?? body.id
  if (!remoteId) throw new Error(`Scheduling ${post.id} returned no id.`)
  return { remoteId }
}
