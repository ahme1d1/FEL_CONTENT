/**
 * TikTok drafts.
 *
 * Direct Post is off — that needs `video.publish` and an audit the app cannot
 * pass until there is a demo video of a working integration. So everything here
 * targets the creator's inbox: the file lands as a draft, and the creator writes
 * the caption and posts it in the TikTok editor. The caption in the manifest
 * never travels; the inbox endpoint has no field for it.
 *
 * FILE_UPLOAD rather than PULL_FROM_URL, for two reasons that both have to be
 * fixed before the choice changes: media.fantasyeg.com has no TLS certificate
 * yet, and PULL_FROM_URL additionally needs the domain verified in TikTok's
 * portal. Uploading the bytes from this machine needs neither.
 *
 * The HTTP layer is injected, exactly as in platforms/meta.mjs, so the tests
 * exercise this code path rather than a parallel one.
 */

const MB = 1024 * 1024

/** TikTok's documented limits, all of them. */
const MIN_CHUNK_BYTES = 5 * MB
const MAX_CHUNK_BYTES = 64 * MB
const MAX_FINAL_CHUNK_BYTES = 128 * MB
const MAX_CHUNKS = 1000
const MAX_FILE_BYTES = 4 * 1024 * MB

/** Status is capped at 30 requests a minute, so three seconds is comfortable. */
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 40

export const API_BASE = 'https://open.tiktokapis.com/v2'
export const INIT_PATH = '/post/publish/inbox/video/init/'
export const STATUS_PATH = '/post/publish/status/fetch/'

/** A draft stops here. PUBLISH_COMPLETE only arrives if a human posts it later. */
const TERMINAL = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE'])

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** TikTok answers 200 with an error object, so the status code proves nothing. */
function unwrap(json) {
  const code = json?.error?.code
  if (code && code !== 'ok') {
    throw new Error(`TikTok refused: ${code} — ${json.error.message || 'no detail'} (log ${json.error.log_id ?? '?'})`)
  }
  return json?.data ?? {}
}

/**
 * How to cut the file up.
 *
 * TikTok derives the count as floor(size / chunk_size), which is why the last
 * chunk carries the remainder and is the only one allowed past chunk_size.
 * A file at or under the ceiling goes whole, which covers every card and every
 * cut we currently render.
 *
 * @returns {{videoSize: number, chunkSize: number, totalChunkCount: number,
 *            ranges: Array<{index: number, first: number, last: number, size: number}>}}
 */
export function chunkPlan(videoSize) {
  if (!Number.isInteger(videoSize) || videoSize <= 0) {
    throw new Error(`videoSize must be a positive byte count, got ${videoSize}.`)
  }
  if (videoSize > MAX_FILE_BYTES) {
    throw new Error(`${videoSize} bytes is over the 4 GB TikTok accepts.`)
  }

  const chunkSize = videoSize <= MAX_CHUNK_BYTES ? videoSize : MAX_CHUNK_BYTES
  const totalChunkCount = Math.floor(videoSize / chunkSize)
  if (totalChunkCount > MAX_CHUNKS) {
    throw new Error(`${totalChunkCount} chunks exceeds TikTok's limit of ${MAX_CHUNKS}.`)
  }

  const ranges = []
  for (let index = 0; index < totalChunkCount; index += 1) {
    const first = index * chunkSize
    const last = index === totalChunkCount - 1 ? videoSize - 1 : first + chunkSize - 1
    const size = last - first + 1
    if (size > MAX_FINAL_CHUNK_BYTES) {
      throw new Error(`chunk ${index} would be ${size} bytes, over the ${MAX_FINAL_CHUNK_BYTES}-byte ceiling.`)
    }
    if (totalChunkCount > 1 && size < MIN_CHUNK_BYTES) {
      throw new Error(`chunk ${index} would be ${size} bytes, under the ${MIN_CHUNK_BYTES}-byte minimum.`)
    }
    ranges.push({ index, first, last, size })
  }

  return { videoSize, chunkSize, totalChunkCount, ranges }
}

/**
 * Reserve a publish id and an upload URL. The URL is good for one hour.
 * @returns {Promise<{publishId: string, uploadUrl: string, plan: object}>}
 */
export async function initFileUpload({ http, videoSize }) {
  const plan = chunkPlan(videoSize)

  const data = unwrap(
    await http({
      path: INIT_PATH,
      body: {
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: plan.videoSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      },
    }),
  )

  if (!data.publish_id) throw new Error('No publish_id came back from the inbox init.')
  if (!data.upload_url) throw new Error('No upload_url came back from the inbox init.')
  return { publishId: data.publish_id, uploadUrl: data.upload_url, plan }
}

/** Sends the bytes. Sequential because TikTok reassembles them in order. */
export async function uploadChunks({ put, uploadUrl, plan, readChunk, mime }) {
  for (const range of plan.ranges) {
    const body = await readChunk(range)
    if (body?.byteLength !== range.size) {
      throw new Error(`chunk ${range.index} read ${body?.byteLength ?? 0} bytes, expected ${range.size}.`)
    }
    await put({
      url: uploadUrl,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(range.size),
        'Content-Range': `bytes ${range.first}-${range.last}/${plan.videoSize}`,
      },
      body,
    })
  }
}

/** @returns {Promise<{status: string, fail_reason?: string}>} */
export async function fetchStatus({ http, publishId }) {
  return unwrap(await http({ path: STATUS_PATH, body: { publish_id: publishId } }))
}

/**
 * Init, upload, then wait for the draft to appear in the creator's inbox.
 * @returns {Promise<{remoteId: string, status: string}>}
 */
export async function publishTiktokDraft({
  http,
  put,
  readChunk,
  videoSize,
  mime = 'video/mp4',
  sleep = defaultSleep,
  maxPolls = MAX_POLLS,
}) {
  const { publishId, uploadUrl, plan } = await initFileUpload({ http, videoSize })
  await uploadChunks({ put, uploadUrl, plan, readChunk, mime })

  for (let i = 0; i < maxPolls; i += 1) {
    const state = await fetchStatus({ http, publishId })
    if (state.status === 'FAILED') {
      throw new Error(`Draft ${publishId} failed: ${state.fail_reason ?? 'no reason given'}`)
    }
    if (TERMINAL.has(state.status)) return { remoteId: publishId, status: state.status }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Draft ${publishId} did not finish after ${maxPolls} polls.`)
}
