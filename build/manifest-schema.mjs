/**
 * Validator for a weekly content manifest.
 *
 * The manifest is the only artifact the authoring session produces and the
 * publisher consumes, so every rule that would otherwise fail at publish time
 * fails here instead, in a reviewed pull request.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lintCaption } from './lint-copy.mjs'
import { asksQuestion } from './author/captions.mjs'

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./copy-rules.json', import.meta.url)), 'utf8'),
)

/**
 * Cairo wall-clock times the calendar is allowed to use.
 *
 * **The day starts at noon** — owner call, 2026-09-02. The morning slots (09:00, 10:30, 11:00)
 * were retired: nothing goes out before 12:00 Cairo. `publish.yml`'s crons fire on exactly these
 * times, so the two lists must be changed together or a slot has no routine to send it.
 */
export const SLOTS_CAIRO = ['12:00', '13:00', '14:00', '16:00', '20:00', '22:30']

/**
 * Instagram accepts 4:5 (0.8) through 1.91:1 for feed images and rejects the
 * container outright outside that band. Stories and Reels are 9:16.
 */
const ASPECT = {
  feed: { min: 0.8, max: 1.91 },
  vertical: { min: 0.55, max: 0.58 },
}

const IMAGE = ['image/jpeg', 'image/webp']
const VIDEO = ['video/mp4']

export const STRATEGIES = {
  'fb-scheduled': { platform: 'facebook', media: 'image', mimes: [...IMAGE, 'image/png'], aspect: null },
  'fb-text': { platform: 'facebook', media: 'none', mimes: [], aspect: null },
  'fb-story': { platform: 'facebook', media: 'image', mimes: [...IMAGE, 'image/png'], aspect: 'vertical' },
  'ig-feed': { platform: 'instagram', media: 'image', mimes: ['image/jpeg'], aspect: 'feed' },
  'ig-story': { platform: 'instagram', media: 'image', mimes: ['image/jpeg'], aspect: 'vertical' },
  'ig-reel': { platform: 'instagram', media: 'video', mimes: VIDEO, aspect: 'vertical' },
  'tiktok-draft': { platform: 'tiktok', media: 'any', mimes: [...IMAGE, ...VIDEO], aspect: null },
  'tiktok-direct': { platform: 'tiktok', media: 'any', mimes: [...IMAGE, ...VIDEO], aspect: null },
}

/** Instagram downscales above 1440px wide; we resample ourselves instead. */
const MAX_WIDTH = 1440
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
/** Our own editorial cap, not a platform limit. Short-form should be short. */
const MAX_REEL_SECONDS = 90
const SHA256 = /^[0-9a-f]{64}$/

const CAIRO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
})

/** The Cairo wall-clock "HH:MM" for a UTC instant, DST included. */
export function cairoWallClock(iso) {
  const parts = Object.fromEntries(CAIRO.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return `${parts.hour}:${parts.minute}`
}

const at = (i, ruleId, message) => ({ ruleId, post: i, message })

function checkTiming(post, i, authoredAt, out) {
  if (!/Z$/.test(post.publishAt ?? '')) {
    out.push(at(i, 'publish-not-utc', 'publishAt must be an absolute UTC instant ending in Z.'))
    return
  }
  const when = new Date(post.publishAt)
  if (Number.isNaN(when.getTime())) {
    out.push(at(i, 'publish-not-utc', `publishAt "${post.publishAt}" is not a date.`))
    return
  }
  if (when <= new Date(authoredAt)) {
    out.push(at(i, 'publish-before-authored', 'publishAt must be after authoredAt.'))
  }

  const wall = cairoWallClock(post.publishAt)
  // An ANCHORED post has no calendar slot by design: it is timed by an event — a day's fixtures all
  // reading FINISHED — which lands wherever the football lands, not on one of six chosen times.
  // Everything else about its instant is still checked: UTC, strictly after authoredAt, and
  // `slotCairo` agreeing with it below. Only the "must be one of the six" rule is lifted.
  if (!post.anchor && !SLOTS_CAIRO.includes(wall)) {
    out.push(at(i, 'not-a-slot', `${wall} Cairo is not a calendar slot (${SLOTS_CAIRO.join(', ')}).`))
  }
  if (post.slotCairo && !post.slotCairo.includes(wall)) {
    out.push(at(i, 'slot-mismatch', `slotCairo says "${post.slotCairo}" but publishAt is ${wall} Cairo.`))
  }
}

function checkMedia(post, i, spec, out) {
  const m = post.media
  if (spec.media === 'none') {
    if (m) out.push(at(i, 'unexpected-media', `${post.strategy} carries no media.`))
    return
  }
  if (!m) {
    out.push(at(i, 'missing-media', `${post.strategy} requires media.`))
    return
  }

  if (!SHA256.test(m.sha256 ?? '')) {
    out.push(at(i, 'bad-sha256', 'media.sha256 must be 64 lowercase hex characters.'))
  }
  if (!spec.mimes.includes(m.mime)) {
    out.push(at(i, 'bad-mime', `${m.mime} is not accepted for ${post.strategy}. Allowed: ${spec.mimes.join(', ')}.`))
  }
  if (!(m.width > 0 && m.height > 0)) {
    out.push(at(i, 'bad-dimensions', 'media.width and media.height must be positive.'))
    return
  }
  if (m.width > MAX_WIDTH) {
    out.push(at(i, 'too-wide', `${m.width}px exceeds ${MAX_WIDTH}px, so Meta would resample it for us.`))
  }
  if (m.mime.startsWith('image/') && m.bytes > MAX_IMAGE_BYTES) {
    out.push(at(i, 'too-large', `${m.bytes} bytes exceeds the ${MAX_IMAGE_BYTES}-byte image limit.`))
  }

  const band = spec.aspect && ASPECT[spec.aspect]
  if (band) {
    const ratio = m.width / m.height
    if (ratio < band.min || ratio > band.max) {
      out.push(
        at(i, 'bad-aspect', `${m.width}x${m.height} is ${ratio.toFixed(3)}; ${post.strategy} needs ${band.min} to ${band.max}.`),
      )
    }
  }
  if (post.strategy === 'ig-reel' && (m.durationSeconds ?? 0) > MAX_REEL_SECONDS) {
    out.push(at(i, 'reel-too-long', `${m.durationSeconds}s exceeds our ${MAX_REEL_SECONDS}s cap for short-form.`))
  }
}

function checkPost(post, i, authoredAt, out) {
  const spec = STRATEGIES[post.strategy]
  if (!spec) {
    out.push(at(i, 'unknown-strategy', `"${post.strategy}" is not a strategy. Known: ${Object.keys(STRATEGIES).join(', ')}.`))
    return
  }
  if (post.platform !== spec.platform) {
    out.push(at(i, 'platform-strategy-mismatch', `${post.strategy} is a ${spec.platform} strategy, not ${post.platform}.`))
  }

  checkTiming(post, i, authoredAt, out)
  checkMedia(post, i, spec, out)

  if (typeof post.caption === 'string' && RULES.platforms[post.platform]) {
    // allowQuestion is a property of the post's kind, which is why `kind` travels in the manifest.
    // A manifest predating that field simply gets the stricter platform default.
    const lint = lintCaption({
      text: post.caption,
      platform: post.platform,
      rules: RULES,
      allowQuestion: asksQuestion(post.kind),
    })
    for (const f of lint.findings) {
      out.push({ ...at(i, f.ruleId, f.message), match: f.match })
    }
  }
}

/**
 * @param {object} manifest
 * @returns {Array<{ruleId: string, post: number|null, message: string}>} empty when valid
 */
export function validateManifest(manifest) {
  const out = []

  if (manifest?.schemaVersion !== 1) {
    out.push(at(null, 'bad-schema-version', 'schemaVersion must be 1.'))
    return out
  }
  if (!Array.isArray(manifest.posts)) {
    out.push(at(null, 'no-posts', 'posts must be an array.'))
    return out
  }

  const seen = new Set()
  for (const [i, post] of manifest.posts.entries()) {
    if (seen.has(post.id)) out.push(at(i, 'duplicate-id', `"${post.id}" appears more than once.`))
    seen.add(post.id)
    checkPost(post, i, manifest.authoredAt, out)
  }

  const links = manifest.posts.filter((p) => p.link).length
  if (links > 1) {
    out.push(at(null, 'too-many-links', `${links} links in one gameweek; the rule is one, on the build-up post.`))
  }

  return out
}
