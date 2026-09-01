/**
 * The words a card carries that are not data: the gameweek's name, a kickoff time, a deadline
 * read aloud.
 *
 * They live in `copy.json` rather than in string literals here so they read as copy and change as
 * a reviewed diff, the way `copy-rules.json` already works for captions.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const COPY = JSON.parse(
  readFileSync(fileURLToPath(new URL('./copy.json', import.meta.url)), 'utf8'),
)

const CAIRO_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
})

const CAIRO_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  weekday: 'short',
})

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const cairoHourMinute = (iso) => {
  const [hour, minute] = CAIRO_HM.format(new Date(iso)).split(':').map(Number)
  return { hour, minute }
}

/**
 * "الجولة التالتة" up to ten, then "الجولة 11".
 *
 * The card designs and every approved sample spell the early ones out; past ten the Egyptian
 * ordinals get unwieldy on a card, and the app's own copy already says «الجولة {n}».
 */
export function gameweekLabel(gw) {
  const ordinal = COPY.gameweekOrdinals[String(gw)] ?? String(gw)
  return COPY.gameweekLabel.replace('{ordinal}', ordinal)
}

/** A kickoff as the matchday card writes it: 12-hour, no period. 17:00 Cairo is "5:00". */
export function kickoffTime(iso) {
  const { hour, minute } = cairoHourMinute(iso)
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')}`
}

/** The part of the day a Cairo hour falls in, in Egyptian: الصبح · الضهر · العصر · بالليل. */
export function clockPeriod(hour) {
  const band = COPY.clockPeriods.find((p) => hour >= p.from && hour <= p.to)
  if (!band) throw new Error(`No clock period covers hour ${hour}.`)
  return band.word
}

/**
 * A deadline read the way it is said out loud: "الاتنين 4 العصر".
 *
 * Minutes are spoken only when there are any, because every deadline this season falls on the
 * hour and "4:00 العصر" reads like a train timetable.
 */
export function deadlinePhrase(iso) {
  const { hour, minute } = cairoHourMinute(iso)
  const day = COPY.cairoDays[WEEKDAY_INDEX[CAIRO_WEEKDAY.format(new Date(iso))]]
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  const clock = minute === 0 ? `${twelve}` : `${twelve}:${String(minute).padStart(2, '0')}`
  return `${day} ${clock} ${clockPeriod(hour)}`
}
