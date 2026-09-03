/**
 * Instagram publishing, over Composio rather than the Graph API.
 *
 * Why not platforms/meta.mjs, which already speaks Instagram? Because that path
 * needs a Page token carrying `instagram_basic` and `instagram_content_publish`,
 * and Composio's Facebook app does not request either. Re-authorising was tried
 * on 2026-09-01 and the new token came back with the same missing-permission
 * error, so no amount of clicking fixes it.
 *
 * Composio's *Instagram* connection uses Instagram Login instead, which bypasses
 * the Page and its token entirely.
 *
 * ⚠️ It does NOT accept a local file over REST, whatever this comment used to say.
 * `INSTAGRAM_CREATE_MEDIA_CONTAINER` refuses a container with "Either image_url or
 * video_url must be provided" — verified 2026-09-03 publishing a real Reel. A file
 * may work through the MCP/SDK, but publish.mjs takes the REST path, so Instagram
 * publishing DOES still depend on media.fantasyeg.com serving the bytes first.
 * `mediaFile` is kept because the argument shape is real; it just is not usable here.
 *
 * The Graph path in meta.mjs is deliberately left intact: it is still the better
 * architecture, and becomes usable the day a properly scoped token exists.
 */

/**
 * The REST API's slugs, which are NOT the names the MCP layer uses for the same
 * two operations. Confirmed against GET /api/v3/tools?toolkit_slug=instagram;
 * the MCP names 404 here.
 */
export const COMPOSIO_TOOLS = {
  container: 'INSTAGRAM_CREATE_MEDIA_CONTAINER',
  publish: 'INSTAGRAM_CREATE_POST',
}

/** Same table as meta.mjs: a plain feed image declares no media_type. */
const MEDIA_TYPE = {
  'ig-feed': null,
  'ig-story': 'STORIES',
  'ig-reel': 'REELS',
}

/** Composio answers 200 with successful:false, so the status code proves nothing. */
function unwrap(result, what) {
  if (!result?.successful) {
    throw new Error(`Composio ${what} failed: ${result?.error ?? 'no detail'}`)
  }
  return result.data ?? {}
}

function containerArgs({ post, igUserId, mediaUrl, mediaFile }) {
  const mediaType = MEDIA_TYPE[post.strategy]
  if (mediaType === undefined) {
    throw new Error(`"${post.strategy}" is not an Instagram strategy. Known: ${Object.keys(MEDIA_TYPE).join(', ')}.`)
  }
  if (!mediaUrl && !mediaFile) {
    throw new Error(`${post.id} has neither mediaUrl nor mediaFile; there is nothing to publish.`)
  }

  const isVideo = post.media?.mime?.startsWith('video/')
  const args = { ig_user_id: igUserId, caption: post.caption ?? '' }
  if (mediaType) args.media_type = mediaType

  // A file and a URL are alternatives. Sending both lets Composio pick, and
  // which one it picks is not something we should be guessing at.
  if (mediaFile) args[isVideo ? 'video_file' : 'image_file'] = mediaFile
  else args[isVideo ? 'video_url' : 'image_url'] = mediaUrl

  return args
}

/**
 * Instagram says this while it is still transcoding a video container.
 *
 * 9007 / 2207027 is NOT a failure — the container is fine and becomes publishable a few seconds
 * later. Everything else is a real error and must surface at once rather than be retried for a
 * minute.
 */
const STILL_TRANSCODING = /\b9007\b|2207027|Media ID is not available|not ready for publishing/i

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())

/**
 * Two steps, as Instagram requires: create a container, then publish it.
 *
 * A VIDEO container is not publishable the instant it exists. This function used to claim "the
 * publish tool polls for FINISHED itself, so there is no wait loop here", which holds for an
 * image and is false for a Reel: publishing a real one on 2026-09-03 returned 9007 «Media ID is
 * not available» and succeeded ~25s later.
 *
 * That is worth retrying HERE rather than leaving to the caller, because publish.mjs records a
 * throw as `failed`, and due.mjs treats `failed` as terminal — so the routine would never come
 * back to it. The SAME container is retried; creating a second would orphan the first.
 *
 * @returns {Promise<{remoteId: string, containerId: string}>}
 */
export async function publishInstagramViaComposio({
  execute,
  igUserId,
  post,
  mediaUrl,
  mediaFile,
  waitMs = 10_000,
  attempts = 12,
}) {
  const args = containerArgs({ post, igUserId, mediaUrl, mediaFile })

  const container = unwrap(await execute({ tool: COMPOSIO_TOOLS.container, args }), 'container creation')
  if (!container.id) throw new Error(`No container id came back for ${post.id}.`)

  const isVideo = post.media?.mime?.startsWith('video/')
  let last = null

  for (let attempt = 1; attempt <= (isVideo ? attempts : 1); attempt += 1) {
    const result = await execute({
      tool: COMPOSIO_TOOLS.publish,
      args: { ig_user_id: igUserId, creation_id: container.id },
    })

    if (result?.successful) {
      const published = unwrap(result, 'publish')
      if (!published.id) throw new Error(`No media id came back publishing ${post.id}.`)
      return { remoteId: published.id, containerId: container.id }
    }

    last = result
    // Anything that is not "still transcoding" is a genuine failure; do not sit on it.
    if (!STILL_TRANSCODING.test(String(result?.error ?? ''))) break
    if (attempt < attempts) await sleep(waitMs)
  }

  return unwrap(last, 'publish')
}
