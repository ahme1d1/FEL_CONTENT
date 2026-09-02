import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../build/manifest-schema.mjs'
import { contentWindow } from '../build/author/window.mjs'
import { buildManifest, mergePosts, planPosts, primaryRole } from '../build/author/plan.mjs'
import { applyHumanCaptions, missingCaptions } from '../build/author/captions.mjs'

const CLUBS = { AHL: 'الأهلي', ZAM: 'الزمالك', PYR: 'بيراميدز', ENP: 'إنبي' }
const fx = (home, away, kickoffAt, over = {}) => ({
  home,
  away,
  homeClub: { id: home, short: CLUBS[home] },
  awayClub: { id: away, short: CLUBS[away] },
  kickoffAt,
  status: 'SCHEDULED',
  homeScore: null,
  awayScore: null,
  ...over,
})

const GW4 = [
  fx('AHL', 'ZAM', '2026-09-07T14:00:00.000Z'),
  fx('PYR', 'ENP', '2026-09-07T17:00:00.000Z'),
  fx('AHL', 'ENP', '2026-09-08T17:00:00.000Z'),
  fx('ZAM', 'PYR', '2026-09-08T18:00:00.000Z'),
]
const GW3_TAIL = [fx('AHL', 'ZAM', '2026-09-02T17:00:00.000Z')]

const player = (over = {}) => ({ playerId: 1, name: 'إمام عاشور', club: 'AHL', pos: 'MID', points: 10, ...over })
const squad = () =>
  Object.entries({ GK: 2, DEF: 6, MID: 6, FWD: 4 }).flatMap(([pos, n]) =>
    Array.from({ length: n }, (_, i) => player({ playerId: `${pos}${i}`, pos, points: 10 - i })),
  )

const DATA = {
  captainCandidates: Array.from({ length: 8 }, (_, i) => player({ playerId: i, name: `لاعب رقم ${i}` })),
  standings: Array.from({ length: 20 }, (_, i) => ({ club: 'AHL', clubShort: 'الأهلي', p: 4, pts: 12 - i })),
  gwStandings: [1, 2, 3].map((n) => ({ name: `مدير ${n}`, teamName: `فريق ${n}`, gwPts: 90 - n })),
  topPlayers: squad().map((p) => ({ ...p, clubShort: 'الأهلي' })),
  priceChanges: null,
}

const WINDOW = contentWindow({ gameweek: 4, fixtures: GW4, previousFixtures: GW3_TAIL })
const AUTHORED = '2026-09-01T09:00:00Z'
const plan = (over = {}) => planPosts({ window: WINDOW, data: DATA, authoredAt: AUTHORED, ...over })

test('a day wears one calendar role even when it holds two', () => {
  assert.equal(primaryRole({ roles: ['deadline', 'match'] }), 'deadlineDay')
  assert.equal(primaryRole({ roles: ['match'] }), 'matchDay')
  assert.equal(primaryRole({ roles: ['settle'] }), 'settleDay')
  assert.equal(primaryRole({ roles: ['buildUp'] }), 'buildUp')
  assert.equal(primaryRole({ roles: ['middle'] }), 'middle')
})

test('the whole plan is a manifest the validator accepts once media is stamped', () => {
  const { posts } = plan()
  const manifest = buildManifest({ gameweek: 4, authoredAt: AUTHORED, posts })
  const findings = validateManifest(manifest).filter((f) => f.ruleId !== 'missing-media')
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2))
})

// missing-media is the ONE finding a pre-render manifest may legitimately carry, because
// checkMedia returns early on a null media. Anything else means the author produced something
// render-manifest.mjs cannot fix.
test('the only finding before rendering is the missing media', () => {
  const { posts } = plan()
  const manifest = buildManifest({ gameweek: 4, authoredAt: AUTHORED, posts })
  const ids = new Set(validateManifest(manifest).map((f) => f.ruleId))
  assert.deepEqual([...ids], ['missing-media'])
})

test('one link in the whole gameweek, on the build-up post, on Facebook only', () => {
  const { posts } = plan()
  const linked = posts.filter((p) => p.link)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].platform, 'facebook')
  assert.match(linked[0].id, /-d1-2000-fb-feed$/)
})

test('a post id names its gameweek, day, slot and destination', () => {
  const { posts } = plan()
  assert.ok(posts.some((p) => p.id === 'gw04-d3-1200-ig-feed'))
  assert.ok(posts.every((p) => /^gw04-d\d+-\d{4}-(fb-feed|ig-feed|tiktok)$/.test(p.id)))
})

test('every post id is unique, which the validator would otherwise reject', () => {
  const { posts } = plan()
  assert.equal(new Set(posts.map((p) => p.id)).size, posts.length)
})

test('the same source fans out to several platforms, so the renderer draws it once', () => {
  const { posts } = plan()
  const nine = posts.filter((p) => p.id.includes('-d3-1200-'))
  assert.equal(nine.length, 3)
  assert.equal(new Set(nine.map((p) => JSON.stringify(p.source))).size, 1)
  assert.deepEqual(nine.map((p) => p.strategy).sort(), ['fb-scheduled', 'ig-feed', 'tiktok-draft'])
})

// The runbook's own loop: schedule everything that needs no scores, then come back for the rest.
test('a results card for a day that has not been played is skipped, with the reason', () => {
  const { posts, skipped } = plan()
  assert.equal(posts.some((p) => p.id.includes('-2230-')), false)
  assert.ok(skipped.some((s) => /not finished/.test(s.reason)))
})

test('once the scores are in, the same run authors the results card', () => {
  const played = GW4.map((f) =>
    f.kickoffAt.startsWith('2026-09-07') ? { ...f, status: 'FINISHED', homeScore: 2, awayScore: 1 } : f,
  )
  const window = contentWindow({ gameweek: 4, fixtures: played, previousFixtures: GW3_TAIL })
  const { posts } = planPosts({ window, data: DATA, authoredAt: AUTHORED })
  assert.ok(posts.some((p) => p.id === 'gw04-d3-2230-fb-feed'))
})

test('a slot that has already gone is skipped rather than made invalid', () => {
  const { posts, skipped } = plan({ authoredAt: '2026-09-08T06:00:00Z' })
  assert.ok(posts.every((p) => p.publishAt > '2026-09-08T06:00:00Z'))
  assert.ok(skipped.some((s) => /has already passed/.test(s.reason)))
})

test('a card whose data has not arrived is skipped by name, not crashed on', () => {
  const { skipped } = plan({ data: { ...DATA, topPlayers: null } })
  assert.ok(skipped.some((s) => /gameweek points/.test(s.reason)), JSON.stringify(skipped))
})

test('the deadline post carries a tighter lateness budget than the six-hour default', () => {
  // Selected by card, not by slot tag: since the day starts at noon the deadline post shares
  // 14:00 with the league table, and an id-suffix match would silently grab the wrong one.
  const deadline = plan().posts.find((p) => p.source?.card === 'H_DEADLINE' && p.platform === 'facebook')
  assert.equal(deadline.maxLatenessMinutes, 60)
})

// Reversed 2026-09-02: the settle-day posts are templated, so a settled round authors unattended.
test('the settle-day posts arrive captioned, so nothing blocks a settled round', () => {
  const { posts } = plan()
  const podium = posts.find((p) => p.source?.card === 'E_PODIUM')
  assert.match(podium.caption, /\S/)
  assert.equal('captionBrief' in podium, false)
  assert.deepEqual(missingCaptions(posts), [])
})

test('posts are ordered by when they publish', () => {
  const times = plan().posts.map((p) => p.publishAt)
  assert.deepEqual(times, [...times].sort())
})

/* ─────────────────────────── human captions ─────────────────────────── */

// No post needs a human any more, but --captions is still how one overrides a generated caption
// for a week that deserves better words. It is linted exactly the same either way.
test('a supplied caption overrides the generated one and is linted like any other', () => {
  const { posts } = plan()
  const id = posts.find((p) => p.platform === 'instagram').id
  const merged = applyHumanCaptions({ posts, captions: { [id]: 'مبروك يا كابتن 🏆' } })

  const post = merged.posts.find((p) => p.id === id)
  assert.equal(post.caption, 'مبروك يا كابتن 🏆')
  assert.equal('captionBrief' in post, false)
  assert.deepEqual(merged.findings, [])
})

test('a supplied caption that breaks the rules is reported, not accepted', () => {
  const { posts } = plan()
  const id = posts.find((p) => p.platform === 'instagram').id
  const { findings } = applyHumanCaptions({ posts, captions: { [id]: 'شوف الترتيب 👇' } })
  assert.ok(findings.some((f) => f.ruleId === 'pointer-emoji'))
})

test('a caption for a post that does not exist is a typo worth reporting', () => {
  const { posts } = plan()
  const { findings } = applyHumanCaptions({ posts, captions: { 'gw04-d9-1200-fb-feed': 'x 🏆' } })
  assert.ok(findings.some((f) => f.ruleId === 'unknown-post'))
})

/* ─────────────────────────── merging a re-run ─────────────────────────── */

const stamped = (post) => ({ ...post, media: { file: 'x.jpg', sha256: 'a'.repeat(64) }, caption: 'مكتوبة 🏆' })

test('re-authoring keeps what is already rendered and captioned', () => {
  const { posts } = plan()
  const existing = [stamped(posts[0])]
  const merged = mergePosts({ existing, fresh: posts })

  assert.equal(merged.posts.find((p) => p.id === posts[0].id).media.file, 'x.jpg')
  assert.equal(merged.posts.find((p) => p.id === posts[0].id).caption, 'مكتوبة 🏆')
  assert.equal(merged.posts.length, posts.length)
  assert.equal(merged.added.length, posts.length - 1)
})

test('a post whose slot has since passed is kept, because it may already have published', () => {
  const { posts } = plan()
  const merged = mergePosts({ existing: [stamped(posts[0])], fresh: posts.slice(1) })
  assert.ok(merged.posts.some((p) => p.id === posts[0].id))
})

// The 2026-08-26 failure: a deadline moved an hour and two already-queued posts stayed wrong.
test('a post whose data changed under it is reported rather than silently kept', () => {
  const { posts } = plan()
  const stale = { ...posts[0], source: { ...posts[0].source, texts: { 0: 'قديم' } } }
  const merged = mergePosts({ existing: [stale], fresh: posts })

  assert.deepEqual(merged.drifted, [posts[0].id])
  assert.equal(merged.posts.find((p) => p.id === posts[0].id).source.texts[0], 'قديم')
})

test('--refresh replaces a drifted post so it renders again', () => {
  const { posts } = plan()
  const stale = { ...posts[0], source: { ...posts[0].source, texts: { 0: 'قديم' } } }
  const merged = mergePosts({ existing: [stale], fresh: posts, refresh: true })
  assert.deepEqual(merged.posts.find((p) => p.id === posts[0].id).source, posts[0].source)
})

test('key order alone is not a change, so a re-run is not a churn of false drift', () => {
  const { posts } = plan()
  const reordered = {
    ...posts[0],
    source: Object.fromEntries(Object.entries(posts[0].source).reverse()),
  }
  assert.deepEqual(mergePosts({ existing: [reordered], fresh: posts }).drifted, [])
})
