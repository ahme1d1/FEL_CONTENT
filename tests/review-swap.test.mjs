import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FPS,
  cardTimings,
  encodeArgs,
  frameCards,
  frameName,
  pairingDrift,
  stillJobs,
  stillName,
} from '../build/review-swap.mjs'
import { CAST, ROUND_LABEL, SOURCE } from '../build/review-cast.mjs'

/** A cast row, shaped as review-cast.mjs writes one. */
const card = (n, start, end, over = {}) => ({
  n,
  start,
  end,
  source: { card: 'Someone', pos: 'MID', points: 3 },
  player: {
    id: 100 + n,
    name: 'محمد شحاتة',
    club: 'ZAM',
    clubName: 'الزمالك',
    position: 'وسط',
    points: '3',
    detail: '',
    ...over,
  },
})

// ── timings ────────────────────────────────────────────────────────────────

test('cut points snap to whole frames', () => {
  const t = cardTimings([card(1, 0, 3.73), card(2, 3.73, 9.63)], { duration: 9.63 })
  assert.deepEqual(t.map((r) => r.startFrame), [0, 112])
  assert.equal(t[0].frames, 112)
})

// Rounding each duration on its own would drift; deriving them from snapped boundaries cannot.
test('snapping never accumulates — the frames sum to the source length', () => {
  const t = cardTimings(CAST, { duration: SOURCE.duration })
  const total = t.reduce((n, r) => n + r.frames, 0)
  assert.equal(total, Math.round(SOURCE.duration * FPS))
  assert.equal(t[0].startFrame, 0)
  assert.equal(t.at(-1).endFrame, total)
})

// The source's last cut sits a few frames short of the file. Stopping there truncates the audio.
test('the closing card is stretched to the end of the audio', () => {
  const t = cardTimings([card(1, 0, 4), card(2, 4, 9.8)], { duration: 10 })
  assert.equal(t.at(-1).endFrame, 300)
  assert.ok(t.at(-1).seconds > 5.8)
})

test('a gap or an overlap between cards is refused', () => {
  assert.throws(() => cardTimings([card(1, 0, 4), card(2, 5, 9)], { duration: 9 }), /ended at 4/)
  assert.throws(() => cardTimings([card(1, 0, 4), card(2, 3, 9)], { duration: 9 }), /ended at 4/)
})

test('a cast that runs past the source is refused', () => {
  assert.throws(() => cardTimings([card(1, 0, 40)], { duration: 10 }), /only 10s/)
})

test('a card shorter than one frame is refused', () => {
  assert.throws(() => cardTimings([card(1, 0, 0.001)], { duration: 0.001 }), /one frame/)
})

// ── still jobs ─────────────────────────────────────────────────────────────

test('a still job carries the props the card renders from', () => {
  const [job] = stillJobs([card(1, 0, 4, { id: 12 })])
  assert.equal(job.file, 'card-01.png')
  assert.equal(job.props.photo, 'players/12.jpg')
  assert.equal(job.props.position, 'وسط')
  assert.equal(job.props.clubName, 'الزمالك')
})

// The card shows the score but never what he did — the voiceover is already saying that.
test('a still job carries the score but no stat line', () => {
  const [job] = stillJobs([card(1, 0, 4)])
  assert.deepEqual(
    Object.keys(job.props).sort(),
    ['club', 'clubName', 'name', 'photo', 'points', 'position'],
  )
})

// He never came on, so he scored 0, and 0 is what the card says.
test('a player who did not feature still carries a figure', () => {
  const notPlayed = CAST.find((c) => c.player.id === 190)
  assert.equal(notPlayed.player.points, '0')
  assert.ok(CAST.every((c) => typeof c.player.points === 'string' && c.player.points !== ''))
})

test('a pick with no player id is refused', () => {
  assert.throws(() => stillJobs([card(1, 0, 4, { id: null })]), /missing a player id/)
})

test('still names sort in playing order', () => {
  assert.deepEqual([stillName(1), stillName(9), stillName(28)], ['card-01.png', 'card-09.png', 'card-28.png'])
  const sorted = [28, 9, 1].map(stillName).sort()
  assert.deepEqual(sorted, ['card-01.png', 'card-09.png', 'card-28.png'])
})

// ── frames ────────────────────────────────────────────────────────────────

test('every output frame is assigned exactly one card', () => {
  const t = cardTimings([card(1, 0, 4), card(2, 4, 10)], { duration: 10 })
  const frames = frameCards(t)
  assert.equal(frames.length, 300)
  assert.equal(frames[0], 1)
  assert.equal(frames[119], 1)
  assert.equal(frames[120], 2)
  assert.equal(frames.at(-1), 2)
})

// The concat demuxer's per-image durations came out 2.6s long, then 3.5s short once bounded.
// Counting frames is the only version that lands on the source's own cuts.
test('the shipped cast produces exactly one frame per frame of the source', () => {
  const t = cardTimings(CAST, { duration: SOURCE.duration })
  assert.equal(frameCards(t).length, Math.round(SOURCE.duration * FPS))
})

test('frame files are numbered from one, zero-padded for %05d', () => {
  assert.equal(frameName(0), 'f00001.png')
  assert.equal(frameName(3009), 'f03010.png')
})

// ── encode ─────────────────────────────────────────────────────────────────

test('the encode copies audio and never re-encodes it', () => {
  const a = encodeArgs({ framesPattern: 'f%05d.png', sourcePath: 's.mp4', out: 'o.mp4' })
  assert.ok(a.includes('-c:a'))
  assert.equal(a[a.indexOf('-c:a') + 1], 'copy')
  assert.deepEqual(a.slice(a.indexOf('-map'), a.indexOf('-map') + 4), ['-map', '0:v:0', '-map', '1:a:0'])
})

// The one recorded upload failure was a 16fps cut refused with frame_rate_check_failed.
test('the frame rate is stated explicitly on the way in and the way out', () => {
  const a = encodeArgs({ framesPattern: 'f%05d.png', sourcePath: 's.mp4', out: 'o.mp4' })
  assert.equal(a[a.indexOf('-framerate') + 1], '30')
  assert.equal(a[a.indexOf('-r') + 1], '30')
  assert.ok(a.includes('+faststart'))
  assert.equal(a[a.indexOf('-pix_fmt') + 1], 'yuv420p')
})

test('encodeArgs refuses a call with nothing to read or write', () => {
  assert.throws(() => encodeArgs({ framesPattern: 'f%05d.png', out: 'o.mp4' }), /needs framesPattern/)
})

// ── the shipped cast ───────────────────────────────────────────────────────

test('the cast covers the source end to end, in order, with no repeated player', () => {
  assert.equal(CAST.length, 28)
  assert.deepEqual(CAST.map((c) => c.n), Array.from({ length: 28 }, (_, i) => i + 1))
  assert.equal(new Set(CAST.map((c) => c.player.id)).size, 28)
  assert.equal(CAST[0].start, 0)
  cardTimings(CAST, { duration: SOURCE.duration }) // throws on any gap or overlap
})

// The voiceover is kept, so a card must not sit against a return the voice is not describing.
test('every card is within two points of the return its voice is describing', () => {
  assert.deepEqual(pairingDrift(CAST), [])
})

test('the cast is majority الأهلي / الزمالك / بيراميدز, as the owner asked', () => {
  const big = CAST.filter((c) => ['AHL', 'ZAM', 'PYR'].includes(c.player.club))
  assert.ok(big.length >= 20, `only ${big.length} of 28 are big-three`)
})

// content-design-kit §2 rule 8, and the retired-vocabulary list.
test('no card carries eastern digits or retired words', () => {
  const text = JSON.stringify(CAST) + ROUND_LABEL
  assert.ok(!/[٠-٩]/.test(text), 'eastern digits')
  assert.ok(!/بونص|أسيست|كلين شيت/.test(text), 'retired vocabulary')
})

// Emoji live in captions, never in a rendered graphic.
test('no card carries an emoji', () => {
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(CAST)))
})

// Two different Palmers play in the Premier League. Verifying by name took the wrong one and
// reported drift that was not there, so every card pins the element id it was cast against.
test('every card pins a unique FPL element id', () => {
  const ids = CAST.map((c) => c.source.fplId)
  assert.ok(ids.every((id) => Number.isInteger(id) && id > 0), 'every card needs an fplId')
  assert.equal(new Set(ids).size, CAST.length)
})

