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
 * the Page and its token entirely. It also accepts a local file, so Instagram
 * publishing no longer depends on media.fantasyeg.com being reachable.
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
 * Two steps, as Instagram requires: create a container, then publish it. The
 * publish tool polls for FINISHED itself, so there is no wait loop here.
 * @returns {Promise<{remoteId: string, containerId: string}>}
 */
export async function publishInstagramViaComposio({ execute, igUserId, post, mediaUrl, mediaFile }) {
  const args = containerArgs({ post, igUserId, mediaUrl, mediaFile })

  const container = unwrap(await execute({ tool: COMPOSIO_TOOLS.container, args }), 'container creation')
  if (!container.id) throw new Error(`No container id came back for ${post.id}.`)

  const published = unwrap(
    await execute({ tool: COMPOSIO_TOOLS.publish, args: { ig_user_id: igUserId, creation_id: container.id } }),
    'publish',
  )
  if (!published.id) throw new Error(`No media id came back publishing ${post.id}.`)

  return { remoteId: published.id, containerId: container.id }
}
