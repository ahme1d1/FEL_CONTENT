/**
 * Turning a manifest into render work.
 *
 * Pure functions only, so the grouping and naming rules are testable without a
 * browser. The orchestration that actually drives Chromium and ffmpeg lives in
 * render-manifest.mjs.
 */

/** Stable stringify: key order must not change a source's identity. */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
}

/** Two posts with the same key render to the same bytes, so they share one file. */
export const sourceKey = (source) => stable(source)

const isCardSource = (source) => Boolean(source && typeof source.card === 'string')

/** "2026-09-03 11:00 Africa/Cairo" -> "1100" */
const slotTag = (slotCairo) => (slotCairo?.match(/(\d{2}):(\d{2})/) ?? [null, '00', '00']).slice(1, 3).join('')

const slugify = (card) =>
  card
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 28)
    .replace(/-+$/, '')

/**
 * Group posts by identical source content.
 * @returns {Array<{key: string, postIds: string[], slotTag: string, slug: string, job: object}>}
 */
export function planRenders(manifest) {
  const groups = new Map()

  for (const post of manifest.posts) {
    if (!isCardSource(post.source)) continue // video is Remotion's job; text posts have none

    const key = sourceKey(post.source)
    const existing = groups.get(key)
    if (existing) {
      existing.postIds.push(post.id)
      // The earliest slot in a shared group names the file.
      if (slotTag(post.slotCairo) < existing.slotTag) existing.slotTag = slotTag(post.slotCairo)
      continue
    }

    groups.set(key, {
      key,
      postIds: [post.id],
      slotTag: slotTag(post.slotCairo),
      slug: post.source.slug ?? slugify(post.source.card),
      job: {
        // The tool always exports PNG; render-manifest converts afterwards.
        file: `${key.length}-${post.id}.png`.replace(/[^\w.-]/g, '_'),
        card: post.source.card,
        texts: post.source.texts ?? {},
        assets: post.source.assets ?? {},
        ...(post.source.keepNames ? { keepNames: true } : {}),
        ...(post.source.heroFile ? { heroFile: post.source.heroFile } : {}),
      },
    })
  }

  return [...groups.values()]
}

/** Content-addressed: same bytes give the same URL, changed bytes give a new one. */
export const mediaName = (group, sha256) => `${group.slotTag}-${group.slug}-${sha256.slice(0, 8)}.jpg`

/**
 * Write render results back into the manifest, immutably.
 * @param {object} manifest
 * @param {Array<{postIds: string[], file: string, sha256: string, bytes: number, width: number, height: number, mime: string}>} results
 * @returns {object} a new manifest
 */
export function stampManifest(manifest, results) {
  const byPost = new Map()
  for (const r of results) {
    for (const id of r.postIds) {
      byPost.set(id, {
        file: r.file,
        sha256: r.sha256,
        bytes: r.bytes,
        mime: r.mime,
        width: r.width,
        height: r.height,
        // Video only, and omitted rather than nulled for stills: the schema's
        // 90s ig-reel cap reads this field, so it has to survive the stamp.
        ...(r.durationSeconds === undefined ? {} : { durationSeconds: r.durationSeconds }),
      })
    }
  }

  return {
    ...manifest,
    posts: manifest.posts.map((post) =>
      byPost.has(post.id) ? { ...post, media: byPost.get(post.id) } : post,
    ),
  }
}
