import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkPlan, fetchStatus, initFileUpload, publishTiktokDraft, uploadChunks } from '../publish/platforms/tiktok.mjs'

const MB = 1024 * 1024

/** Records every call and replies from a scripted queue, like tests/meta.test.mjs. */
function recorder(replies = []) {
  const calls = []
  const queue = [...replies]
  const http = async ({ path, body }) => {
    calls.push({ path, body })
    if (!queue.length) throw new Error(`no scripted reply for ${path}`)
    return queue.shift()
  }
  return { http, calls }
}

/** Collects the chunk PUTs without holding any bytes. */
function uploader() {
  const puts = []
  const put = async ({ url, headers }) => {
    puts.push({ url, headers })
  }
  return { put, puts }
}

const ok = (data) => ({ data, error: { code: 'ok', message: '', log_id: 'L1' } })
const readChunk = async ({ first, last }) => new Uint8Array(last - first + 1)
const UPLOAD_URL = 'https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=t'

// ── how a file is cut up ───────────────────────────────────────────────────

// ad-full.mp4 is 43 MB. Anything at or under the 64 MB ceiling goes whole.
test('a video inside the chunk ceiling is sent as one chunk of its own size', () => {
  const plan = chunkPlan(43 * MB)
  assert.equal(plan.totalChunkCount, 1)
  assert.equal(plan.chunkSize, 43 * MB)
  assert.deepEqual(plan.ranges, [{ index: 0, first: 0, last: 43 * MB - 1, size: 43 * MB }])
})

// TikTok computes count as floor(size / chunk_size), so the final chunk carries
// the remainder and is allowed to exceed chunk_size.
test('a larger file is split, and the last chunk absorbs the remainder', () => {
  const plan = chunkPlan(150 * MB)
  assert.equal(plan.chunkSize, 64 * MB)
  assert.equal(plan.totalChunkCount, 2)
  assert.equal(plan.ranges.at(-1).size, 86 * MB, 'the tail rides on the final chunk rather than becoming a short one')
})

test('the ranges are contiguous and cover every byte exactly once', () => {
  const size = 200 * MB + 12345
  const { ranges } = chunkPlan(size)
  assert.equal(ranges[0].first, 0)
  assert.equal(ranges.at(-1).last, size - 1)
  for (let i = 1; i < ranges.length; i += 1) assert.equal(ranges[i].first, ranges[i - 1].last + 1)
  assert.equal(ranges.reduce((n, r) => n + r.size, 0), size)
})

test('no chunk ever exceeds the 128 MB tiktok allows for a final chunk', () => {
  for (const size of [65 * MB, 127 * MB, 128 * MB, 129 * MB, 500 * MB]) {
    for (const r of chunkPlan(size).ranges) assert.ok(r.size <= 128 * MB, `${size} produced a ${r.size} chunk`)
  }
})

test('a file over the 4 GB tiktok accepts is refused before anything is uploaded', () => {
  assert.throws(() => chunkPlan(5 * 1024 * MB), /4 GB|too large/i)
})

test('an empty file is refused rather than initialising an upload of nothing', () => {
  assert.throws(() => chunkPlan(0), /size/i)
})

// ── initialising the upload ────────────────────────────────────────────────

test('init declares FILE_UPLOAD with the sizes the plan worked out', async () => {
  const { http, calls } = recorder([ok({ publish_id: 'PUB_1', upload_url: UPLOAD_URL })])
  const result = await initFileUpload({ http, videoSize: 43 * MB })

  assert.equal(calls[0].path, '/post/publish/inbox/video/init/')
  assert.deepEqual(calls[0].body.source_info, {
    source: 'FILE_UPLOAD',
    video_size: 43 * MB,
    chunk_size: 43 * MB,
    total_chunk_count: 1,
  })
  assert.equal(result.publishId, 'PUB_1')
  assert.equal(result.uploadUrl, UPLOAD_URL)
})

// The inbox endpoint takes source_info and nothing else. The caption is typed
// by the creator in the TikTok editor, so sending one would just 400.
test('no post_info travels with a draft, because the inbox endpoint has no caption', async () => {
  const { http, calls } = recorder([ok({ publish_id: 'PUB_1', upload_url: UPLOAD_URL })])
  await initFileUpload({ http, videoSize: 6 * MB })
  assert.deepEqual(Object.keys(calls[0].body), ['source_info'])
})

// TikTok answers 200 with an error object rather than an HTTP status.
test('an error payload throws even though the request itself succeeded', async () => {
  const { http } = recorder([{ data: {}, error: { code: 'spam_risk_too_many_posts', message: 'daily limit', log_id: 'L9' } }])
  await assert.rejects(() => initFileUpload({ http, videoSize: 6 * MB }), /spam_risk_too_many_posts|daily limit/)
})

test('an init with no upload url throws rather than PUTting to undefined', async () => {
  const { http } = recorder([ok({ publish_id: 'PUB_1' })])
  await assert.rejects(() => initFileUpload({ http, videoSize: 6 * MB }), /upload_url/)
})

// ── sending the bytes ──────────────────────────────────────────────────────

test('each chunk carries the exact content-range tiktok parses', async () => {
  const { put, puts } = uploader()
  const plan = chunkPlan(150 * MB)
  await uploadChunks({ put, uploadUrl: UPLOAD_URL, plan, readChunk, mime: 'video/mp4' })

  assert.equal(puts.length, 2)
  assert.equal(puts[0].url, UPLOAD_URL)
  assert.equal(puts[0].headers['Content-Range'], `bytes 0-${64 * MB - 1}/${150 * MB}`)
  assert.equal(puts[0].headers['Content-Length'], String(64 * MB))
  assert.equal(puts[0].headers['Content-Type'], 'video/mp4')
  assert.equal(puts[1].headers['Content-Range'], `bytes ${64 * MB}-${150 * MB - 1}/${150 * MB}`)
})

test('chunks go up in order, because tiktok requires them sequentially', async () => {
  const seen = []
  const put = async ({ headers }) => seen.push(headers['Content-Range'])
  await uploadChunks({ put, uploadUrl: UPLOAD_URL, plan: chunkPlan(200 * MB), readChunk, mime: 'video/mp4' })
  assert.deepEqual(seen, [...seen].sort((a, b) => Number(a.split(' ')[1].split('-')[0]) - Number(b.split(' ')[1].split('-')[0])))
})

test('a chunk that reads short is refused rather than silently truncating the video', async () => {
  const { put } = uploader()
  await assert.rejects(
    () => uploadChunks({ put, uploadUrl: UPLOAD_URL, plan: chunkPlan(6 * MB), readChunk: async () => new Uint8Array(10), mime: 'video/mp4' }),
    /bytes/i,
  )
})

// ── waiting for the draft to land ──────────────────────────────────────────

test('the status call asks by publish id', async () => {
  const { http, calls } = recorder([ok({ status: 'SEND_TO_USER_INBOX' })])
  const status = await fetchStatus({ http, publishId: 'PUB_1' })
  assert.equal(calls[0].path, '/post/publish/status/fetch/')
  assert.deepEqual(calls[0].body, { publish_id: 'PUB_1' })
  assert.equal(status.status, 'SEND_TO_USER_INBOX')
})

// SEND_TO_USER_INBOX is where a draft stops. PUBLISH_COMPLETE only arrives once
// a human opens the notification and posts it, which may be never.
test('a draft is done when it reaches the inbox, not when it is published', async () => {
  const { http } = recorder([
    ok({ publish_id: 'PUB_1', upload_url: UPLOAD_URL }),
    ok({ status: 'PROCESSING_UPLOAD', uploaded_bytes: 0 }),
    ok({ status: 'SEND_TO_USER_INBOX' }),
  ])
  const { put } = uploader()
  const result = await publishTiktokDraft({
    http,
    put,
    readChunk,
    videoSize: 6 * MB,
    mime: 'video/mp4',
    sleep: async () => {},
  })

  assert.equal(result.remoteId, 'PUB_1')
  assert.equal(result.status, 'SEND_TO_USER_INBOX')
})

test('a failed upload throws carrying the reason tiktok gave', async () => {
  const { http } = recorder([
    ok({ publish_id: 'PUB_1', upload_url: UPLOAD_URL }),
    ok({ status: 'FAILED', fail_reason: 'video_format_unsupported' }),
  ])
  const { put } = uploader()
  await assert.rejects(
    () => publishTiktokDraft({ http, put, readChunk, videoSize: 6 * MB, mime: 'video/mp4', sleep: async () => {} }),
    /video_format_unsupported/,
  )
})

test('a status that never settles throws rather than polling forever', async () => {
  const { http } = recorder([
    ok({ publish_id: 'PUB_1', upload_url: UPLOAD_URL }),
    ...Array(10).fill(ok({ status: 'PROCESSING_UPLOAD' })),
  ])
  const { put } = uploader()
  await assert.rejects(
    () => publishTiktokDraft({ http, put, readChunk, videoSize: 6 * MB, mime: 'video/mp4', sleep: async () => {}, maxPolls: 3 }),
    /did not finish|never/i,
  )
})

// ── photos ─────────────────────────────────────────────────────────────────
// Cards are the weekly rhythm; video is occasional. A video-only integration
// would leave TikTok with almost nothing to post.

import { PHOTO_INIT_PATH, publishTiktokPhotoDraft } from '../publish/platforms/tiktok.mjs'

const IMG = 'https://media.fantasyeg.com/gw03/gw3-d2-matchday.jpg'

test('a photo draft declares MEDIA_UPLOAD and PHOTO, pulling from the verified domain', async () => {
  const { http, calls } = recorder([ok({ publish_id: 'PUB_P1' }), ok({ status: 'SEND_TO_USER_INBOX' })])
  const result = await publishTiktokPhotoDraft({ http, photoUrls: [IMG], sleep: async () => {} })

  assert.equal(calls[0].path, PHOTO_INIT_PATH)
  assert.equal(calls[0].body.post_mode, 'MEDIA_UPLOAD')
  assert.equal(calls[0].body.media_type, 'PHOTO')
  assert.deepEqual(calls[0].body.source_info, {
    source: 'PULL_FROM_URL',
    photo_images: [IMG],
    photo_cover_index: 0,
  })
  assert.equal(result.remoteId, 'PUB_P1')
  assert.equal(result.status, 'SEND_TO_USER_INBOX')
})

// Photos have no FILE_UPLOAD option at all, so an unreachable or unverified
// URL is the whole failure mode. Catching it here beats a TikTok rejection.
test('a non-https url is refused before the request', async () => {
  const { http, calls } = recorder([])
  await assert.rejects(
    () => publishTiktokPhotoDraft({ http, photoUrls: ['http://media.fantasyeg.com/a.jpg'] }),
    /https/i,
  )
  assert.equal(calls.length, 0)
})

test('an empty photo list is refused rather than initialising an empty post', async () => {
  const { http } = recorder([])
  await assert.rejects(() => publishTiktokPhotoDraft({ http, photoUrls: [] }), /photo/i)
})

test('more than the 35 photos tiktok accepts is refused', async () => {
  const { http } = recorder([])
  const many = Array.from({ length: 36 }, (_, i) => `${IMG}?i=${i}`)
  await assert.rejects(() => publishTiktokPhotoDraft({ http, photoUrls: many }), /35/)
})

test('a carousel keeps the given order and cover', async () => {
  const { http, calls } = recorder([ok({ publish_id: 'P' }), ok({ status: 'SEND_TO_USER_INBOX' })])
  const urls = [`${IMG}?a`, `${IMG}?b`, `${IMG}?c`]
  await publishTiktokPhotoDraft({ http, photoUrls: urls, coverIndex: 2, sleep: async () => {} })

  assert.deepEqual(calls[0].body.source_info.photo_images, urls)
  assert.equal(calls[0].body.source_info.photo_cover_index, 2)
})

test('a cover index outside the list is refused', async () => {
  const { http } = recorder([])
  await assert.rejects(() => publishTiktokPhotoDraft({ http, photoUrls: [IMG], coverIndex: 3 }), /cover/i)
})

test('a failed photo draft throws carrying the reason', async () => {
  const { http } = recorder([ok({ publish_id: 'P' }), ok({ status: 'FAILED', fail_reason: 'url_ownership_unverified' })])
  await assert.rejects(
    () => publishTiktokPhotoDraft({ http, photoUrls: [IMG], sleep: async () => {} }),
    /url_ownership_unverified/,
  )
})
