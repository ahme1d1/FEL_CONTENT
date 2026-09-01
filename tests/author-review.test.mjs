import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { reviewUserContent } from '../build/author/review.mjs'

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../build/copy-rules.json', import.meta.url)), 'utf8'),
)

const podium = (names, id = 'gw02-d6-1030-fb-feed') => ({
  id,
  source: {
    card: 'E_PODIUM',
    texts: { 0: 'الجولة التانية', 3: names[0], 7: names[1], 11: names[2] },
  },
})
const review = (posts) => reviewUserContent({ posts, rules: RULES })

// GW2's real top three. FEL was retired from every user-facing surface on 2026-08-25.
test('a team name carrying the retired wordmark is flagged', () => {
  const found = review([podium(['El mazzarita', 'Mor FC', 'My FEL Team'])])
  assert.equal(found.length, 1)
  assert.equal(found[0].text, 'My FEL Team')
  assert.match(found[0].reason, /FEL/)
})

test('a name that merely contains those letters is not a wordmark', () => {
  assert.deepEqual(review([podium(['Feline FC', 'Delfel', 'Mor FC'])]), [])
})

test('retired vocabulary in a team name is flagged too', () => {
  const found = review([podium(['فريق الشلة', 'Mor FC', 'ok'])])
  assert.match(found[0].reason, /الشلة/)
})

test('a banned character in a team name is flagged', () => {
  const found = review([podium(['فريق ١٥', 'Mor FC', 'ok'])])
  assert.match(found[0].reason, /eastern-digits/)
})

test('an ordinary team name says nothing', () => {
  assert.deepEqual(review([podium(['El mazzarita', 'Mor FC', 'فريق النسور'])]), [])
})

// The same card goes to Facebook and Instagram; one problem is one warning.
test('a card that fans out to two platforms warns once', () => {
  const found = review([podium(['My FEL Team', 'a', 'b'], 'fb'), podium(['My FEL Team', 'a', 'b'], 'ig')])
  assert.equal(found.length, 1)
})

test('cards with no user-supplied text are not inspected', () => {
  assert.deepEqual(review([{ id: 'x', source: { card: 'A_MATCHDAY_4_rows', texts: { 2: 'الأهلي' } } }]), [])
})

test('a post with no source at all does not crash the review', () => {
  assert.deepEqual(review([{ id: 'x', source: null }]), [])
})
