/**
 * Cairo wall clock in, absolute UTC instant out.
 *
 * The publisher does no timezone arithmetic on purpose, so the conversion happens exactly once,
 * here, and lands in the manifest as a reviewed diff. Cairo drops from UTC+3 to UTC+2 overnight
 * on 29 October 2026, around GW9; doing this by hand is how every post after it silently moves
 * by an hour.
 *
 * Nothing here computes an offset. It proposes the two instants Cairo has ever been capable of
 * and keeps the one the validator's own `cairoWallClock` agrees with, so this module and the
 * rule it must satisfy can never drift apart.
 */

import { SLOTS_CAIRO, cairoWallClock } from '../manifest-schema.mjs'

const YMD = /^\d{4}-\d{2}-\d{2}$/

const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Cairo has only ever run at UTC+2 or UTC+3. Largest first, so that when a wall clock happens
 * twice — the hour repeated when summer time ends — we take its first occurrence.
 */
const OFFSETS_HOURS = [3, 2]

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** The Cairo calendar date of a UTC instant, which is not always the UTC one. */
export function cairoDateOf(iso) {
  const p = Object.fromEntries(CAIRO_DATE.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** ISO 8601 with no milliseconds, matching how times are written in the manifest by hand. */
const toIso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

const assertYmd = (date) => {
  if (!YMD.test(date)) throw new Error(`"${date}" is not a YYYY-MM-DD Cairo date.`)
}

/**
 * Whole-day arithmetic on a Cairo date. Anchored at midday UTC so a clock change can never
 * push the result onto the neighbouring day.
 *
 * @param {string} date "YYYY-MM-DD"
 * @param {number} days may be negative
 * @returns {string} "YYYY-MM-DD"
 */
export function addCairoDays(date, days) {
  assertYmd(date)
  return toIso(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).slice(0, 10)
}

/**
 * @param {string} cairoDate "YYYY-MM-DD" as read in Cairo
 * @param {string} wallClock one of SLOTS_CAIRO
 * @returns {{publishAt: string, slotCairo: string}} the exact pair the validator cross-checks
 */
export function slotInstant(cairoDate, wallClock) {
  assertYmd(cairoDate)
  if (!SLOTS_CAIRO.includes(wallClock)) {
    throw new Error(`${wallClock} is not a calendar slot (${SLOTS_CAIRO.join(', ')}).`)
  }

  const asIfUtc = Date.parse(`${cairoDate}T${wallClock}:00Z`)
  for (const offset of OFFSETS_HOURS) {
    const publishAt = toIso(asIfUtc - offset * HOUR_MS)
    if (cairoWallClock(publishAt) === wallClock && cairoDateOf(publishAt) === cairoDate) {
      return { publishAt, slotCairo: `${cairoDate} ${wallClock} Africa/Cairo` }
    }
  }

  // Only reachable if a wall clock is skipped by a spring-forward, which Egypt schedules at
  // midnight and our earliest slot is 09:00 — but a silent wrong answer here is a mistimed post.
  throw new Error(`${wallClock} Cairo does not exist on ${cairoDate}.`)
}

/**
 * Graph refuses a `scheduled_publish_time` less than ten minutes out, and rendering plus the push
 * to Pages takes five to eight. Fifteen is the floor at which an anchored post can still survive
 * the handoff; below it the post fails at Meta instead of going out, which is a worse failure than
 * not authoring it at all because it happens after the ledger has recorded an attempt.
 */
const MIN_LEAD_MINUTES = 15

/**
 * An instant `leadMinutes` from now, for a post the calendar cannot time in advance.
 *
 * The mirror of `slotInstant`, and deliberately the same return shape so the planner can use
 * either without knowing which it got. The difference is where the instant comes from: a slot is
 * a time somebody chose, an anchor is a time the world chose. `slotCairo` is still filled in —
 * it is what the dry run prints and what a human reads in the diff — but here it is a READING of
 * the instant, not the thing the instant was derived from.
 *
 * Used by the results post, whose card cannot be built until every fixture that day reads
 * FINISHED. Pinning that to a wall clock meant guessing when football ends, and the guess lost
 * every day of GW3.
 *
 * @param {string} authoredAt ISO instant the pass started
 * @param {number} leadMinutes how long after it to publish; at least MIN_LEAD_MINUTES
 * @returns {{publishAt: string, slotCairo: string}} the same pair the validator cross-checks
 */
export function anchoredInstant(authoredAt, leadMinutes) {
  const at = Date.parse(authoredAt)
  if (!Number.isFinite(at)) throw new Error(`"${authoredAt}" is not a date.`)
  if (!Number.isFinite(leadMinutes) || leadMinutes < MIN_LEAD_MINUTES) {
    throw new Error(`leadMinutes must be a number of at least ${MIN_LEAD_MINUTES}; got ${leadMinutes}.`)
  }

  const publishAt = toIso(at + leadMinutes * 60_000)
  return {
    publishAt,
    slotCairo: `${cairoDateOf(publishAt)} ${cairoWallClock(publishAt)} Africa/Cairo`,
  }
}
