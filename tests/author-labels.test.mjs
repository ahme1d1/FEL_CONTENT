import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clockPeriod, deadlinePhrase, gameweekLabel, kickoffTime } from '../build/author/labels.mjs'

test('a gameweek is named the way the card designs name it', () => {
  assert.equal(gameweekLabel(1), 'الجولة الأولى')
  assert.equal(gameweekLabel(3), 'الجولة التالتة')
  assert.equal(gameweekLabel(10), 'الجولة العاشرة')
})

test('past ten the label falls back to a digit, as the app already writes it', () => {
  assert.equal(gameweekLabel(11), 'الجولة 11')
  assert.equal(gameweekLabel(19), 'الجولة 19')
})

test('a kickoff is written 12-hour with no period, matching the card', () => {
  assert.equal(kickoffTime('2026-09-07T14:00:00.000Z'), '5:00') // 17:00 Cairo
  assert.equal(kickoffTime('2026-09-07T17:00:00.000Z'), '8:00') // 20:00 Cairo
  assert.equal(kickoffTime('2026-09-07T16:30:00.000Z'), '7:30')
})

test('the clock period is Egyptian, not a 24-hour reading', () => {
  assert.equal(clockPeriod(16), 'العصر')
  assert.equal(clockPeriod(20), 'بالليل')
  assert.equal(clockPeriod(9), 'الصبح')
  assert.equal(clockPeriod(13), 'الضهر')
})

// Every deadline this season is 16:00 Cairo, one hour before a 17:00 first kickoff.
test('a deadline reads as it is said out loud', () => {
  assert.equal(deadlinePhrase('2026-09-07T13:00:00Z'), 'الاتنين 4 العصر') // Mon 7 Sep, 16:00 Cairo
  assert.equal(deadlinePhrase('2026-08-26T13:00:00Z'), 'الأربع 4 العصر') // Wed 26 Aug
})

test('a deadline off the hour keeps its minutes', () => {
  assert.equal(deadlinePhrase('2026-09-07T13:30:00Z'), 'الاتنين 4:30 العصر')
})

test('the clock phrase follows Cairo across the October change, not UTC', () => {
  assert.equal(deadlinePhrase('2026-11-23T14:00:00Z'), 'الاتنين 4 العصر') // UTC+2 by then
})
