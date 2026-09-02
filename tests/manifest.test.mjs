import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest, cairoWallClock, SLOTS_CAIRO } from '../build/manifest-schema.mjs'

/** A minimal valid manifest; each test bends one thing out of shape. */
const base = () => ({
  schemaVersion: 1,
  gameweek: 3,
  authoredAt: '2026-09-01T18:22:11Z',
  mediaBase: 'https://media.fantasyeg.com/gw03',
  posts: [
    {
      id: 'gw03-d1-1100-ig-feed',
      publishAt: '2026-09-03T11:00:00Z', // 14:00 Cairo, UTC+3 in September
      slotCairo: '2026-09-03 14:00 Africa/Cairo',
      platform: 'instagram',
      strategy: 'ig-feed',
      media: {
        file: '1100-winner-9f2c7a41.jpg',
        sha256: 'a'.repeat(64),
        bytes: 483920,
        mime: 'image/jpeg',
        width: 1080,
        height: 1350,
      },
      source: { card: 'P_WINNER_THEIR_TEAM', texts: { 0: 'بطل الجولة' }, assets: { 0: 'AHL' } },
      caption: 'كهربا جاب 14 نقطة لوحده 🔥',
      link: null,
      dependsOn: null,
    },
  ],
})

const idsFor = (m) => validateManifest(m).map((f) => f.ruleId)

test('a well-formed manifest validates clean', () => {
  const findings = validateManifest(base())
  assert.deepEqual(findings, [], `expected clean, got ${JSON.stringify(findings, null, 2)}`)
})

test('duplicate post ids are rejected', () => {
  const m = base()
  m.posts.push({ ...m.posts[0] })
  assert.ok(idsFor(m).includes('duplicate-id'))
})

test('publishAt must be after authoredAt', () => {
  const m = base()
  m.posts[0].publishAt = '2026-08-01T08:00:00Z'
  assert.ok(idsFor(m).includes('publish-before-authored'))
})

test('publishAt must be an explicit UTC instant', () => {
  const m = base()
  m.posts[0].publishAt = '2026-09-03T14:00:00+03:00'
  assert.ok(idsFor(m).includes('publish-not-utc'))
})

// The whole point of storing an absolute instant: Cairo drops UTC+3 -> UTC+2 on
// 2026-10-29, around GW9. The same wall-clock slot is a different UTC hour after that.
test('the same Cairo slot validates on both sides of the DST change', () => {
  const summer = base()
  summer.posts[0].publishAt = '2026-09-03T11:00:00Z'
  assert.deepEqual(validateManifest(summer), [])

  const winter = base()
  winter.posts[0].publishAt = '2026-11-05T12:00:00Z' // 14:00 Cairo at UTC+2
  winter.posts[0].slotCairo = '2026-11-05 14:00 Africa/Cairo'
  assert.deepEqual(validateManifest(winter), [])
})

test('a UTC hour that lands off-slot after the DST change is caught', () => {
  const m = base()
  m.posts[0].publishAt = '2026-11-05T08:00:00Z' // 10:00 Cairo, not a slot
  m.posts[0].slotCairo = '2026-11-05 10:00 Africa/Cairo'
  assert.ok(idsFor(m).includes('not-a-slot'))
})

test('cairoWallClock tracks the DST boundary', () => {
  assert.equal(cairoWallClock('2026-09-03T08:00:00Z'), '11:00')
  assert.equal(cairoWallClock('2026-11-05T08:00:00Z'), '10:00')
})

test('slotCairo must agree with publishAt', () => {
  const m = base()
  m.posts[0].slotCairo = '2026-09-03 16:00 Africa/Cairo'
  assert.ok(idsFor(m).includes('slot-mismatch'))
})

test('a PNG targeted at Instagram or TikTok is rejected', () => {
  const m = base()
  m.posts[0].media.mime = 'image/png'
  m.posts[0].media.file = 'x.png'
  assert.ok(idsFor(m).includes('bad-mime'))
})

// 1080x1920 is 0.5625, below Instagram's 0.8 minimum. The container is rejected
// outright, so catch it here rather than at publish time.
test('a story-shaped asset aimed at the Instagram feed is rejected', () => {
  const m = base()
  m.posts[0].media.height = 1920
  assert.ok(idsFor(m).includes('bad-aspect'))
})

test('a story-shaped asset is fine for an Instagram story', () => {
  const m = base()
  m.posts[0].strategy = 'ig-story'
  m.posts[0].media.height = 1920
  assert.deepEqual(validateManifest(m), [])
})

test('a 4:5 asset aimed at an Instagram story is rejected', () => {
  const m = base()
  m.posts[0].strategy = 'ig-story'
  assert.ok(idsFor(m).includes('bad-aspect'))
})

test('an over-wide export is rejected so Meta never resamples for us', () => {
  const m = base()
  m.posts[0].media.width = 2160
  m.posts[0].media.height = 2700
  assert.ok(idsFor(m).includes('too-wide'))
})

test('an oversized image is rejected before Instagram rejects it', () => {
  const m = base()
  m.posts[0].media.bytes = 9 * 1024 * 1024
  assert.ok(idsFor(m).includes('too-large'))
})

test('a reel over the editorial length cap is rejected', () => {
  const m = base()
  m.posts[0].strategy = 'ig-reel'
  m.posts[0].media = { ...m.posts[0].media, mime: 'video/mp4', file: 'x.mp4', height: 1920, durationSeconds: 120 }
  assert.ok(idsFor(m).includes('reel-too-long'))
})

test('at most one link across the whole manifest', () => {
  const m = base()
  m.posts[0].platform = 'facebook'
  m.posts[0].strategy = 'fb-scheduled'
  m.posts[0].link = 'https://fantasyeg.com'
  m.posts[0].caption = 'الجولة التالتة قربت 🔥⚽'
  m.posts.push({ ...m.posts[0], id: 'gw03-d2-1100-fb-feed', link: 'https://fantasyeg.com' })
  assert.ok(idsFor(m).includes('too-many-links'))
})

test('the platform must match the strategy', () => {
  const m = base()
  m.posts[0].strategy = 'fb-scheduled'
  assert.ok(idsFor(m).includes('platform-strategy-mismatch'))
})

test('an unknown strategy is rejected', () => {
  const m = base()
  m.posts[0].strategy = 'ig-carousel'
  assert.ok(idsFor(m).includes('unknown-strategy'))
})

test('a bad sha256 is rejected', () => {
  const m = base()
  m.posts[0].media.sha256 = 'nope'
  assert.ok(idsFor(m).includes('bad-sha256'))
})

test('caption findings surface through the manifest validator', () => {
  const m = base()
  m.posts[0].caption = 'الدوري هيولّع 🔥'
  assert.ok(idsFor(m).includes('retired-vocabulary'))
})

test('a text-only Facebook post needs no media', () => {
  const m = base()
  m.posts[0] = {
    ...m.posts[0],
    platform: 'facebook',
    strategy: 'fb-text',
    media: null,
    source: null,
    caption: 'معاكم لحد الديدلاين لأي سؤال في الفانتازي 🔥⚽',
  }
  assert.deepEqual(validateManifest(m), [])
})

test('every declared slot is a real slot', () => {
  assert.ok(SLOTS_CAIRO.includes('14:00'))
  assert.ok(SLOTS_CAIRO.includes('22:30'))
  assert.ok(!SLOTS_CAIRO.includes('10:00'))
})
