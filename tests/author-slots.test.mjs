import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SLOTS_CAIRO, cairoWallClock } from '../build/manifest-schema.mjs'
import { addCairoDays, cairoDateOf, slotInstant } from '../build/author/slots.mjs'

test('a Cairo slot becomes the UTC instant the validator expects', () => {
  assert.deepEqual(slotInstant('2026-09-03', '11:00'), {
    publishAt: '2026-09-03T08:00:00Z',
    slotCairo: '2026-09-03 11:00 Africa/Cairo',
  })
})

// Cairo drops from UTC+3 to UTC+2 overnight on 29 October 2026, around GW9. Doing the arithmetic
// by hand is how every post after it silently moves by an hour.
test('the October 2026 clock change is handled by construction, not by hand', () => {
  assert.equal(slotInstant('2026-10-29', '09:00').publishAt, '2026-10-29T06:00:00Z')
  assert.equal(slotInstant('2026-11-05', '09:00').publishAt, '2026-11-05T07:00:00Z')
})

test('every calendar slot round-trips through cairoWallClock on both sides of the change', () => {
  for (const date of ['2026-09-03', '2026-10-29', '2026-10-30', '2027-02-20']) {
    for (const wall of SLOTS_CAIRO) {
      const { publishAt } = slotInstant(date, wall)
      assert.equal(cairoWallClock(publishAt), wall, `${date} ${wall}`)
      assert.equal(cairoDateOf(publishAt), date, `${date} ${wall}`)
    }
  }
})

test('the emitted publishAt is the Z-terminated form the validator insists on', () => {
  assert.match(slotInstant('2026-09-03', '22:30').publishAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
})

// slotCairo is checked by substring against the wall clock, so the two can never disagree.
test('slotCairo carries the wall clock publishAt resolves to', () => {
  const { publishAt, slotCairo } = slotInstant('2026-11-05', '16:00')
  assert.ok(slotCairo.includes(cairoWallClock(publishAt)))
})

test('a time that is not a calendar slot is refused at the source', () => {
  assert.throws(() => slotInstant('2026-09-03', '12:15'), /not a calendar slot/)
})

test('a malformed date is refused rather than producing an Invalid Date', () => {
  assert.throws(() => slotInstant('3 Sep 2026', '11:00'), /YYYY-MM-DD/)
})

test('cairoDateOf reads the Cairo day, not the UTC one', () => {
  // 22:30 Cairo on 3 Sep is still 3 Sep in Cairo but 19:30 UTC the same day; an hour later it
  // would roll over in neither. The trap is the other direction: 00:30 Cairo is the previous UTC day.
  assert.equal(cairoDateOf('2026-09-03T21:30:00Z'), '2026-09-04')
})

test('addCairoDays walks whole days without drifting across the clock change', () => {
  assert.equal(addCairoDays('2026-10-28', 3), '2026-10-31')
  assert.equal(addCairoDays('2026-09-03', -1), '2026-09-02')
  assert.equal(addCairoDays('2026-12-31', 1), '2027-01-01')
})
