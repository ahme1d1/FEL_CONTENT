import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeFor } from '../publish/route.mjs'

test('instagram strategies route to instagram', () => {
  for (const s of ['ig-feed', 'ig-story', 'ig-reel']) assert.equal(routeFor(s), 'instagram')
})

test('a facebook story routes to its own two-step', () => {
  assert.equal(routeFor('fb-story'), 'fb-story')
})

// The routine holds no TikTok credential by design: the token lives on the
// author's machine and never leaves it. Falling through to Instagram made a
// tiktok-direct post fail with "not an Instagram strategy", which explains
// nothing to whoever reads the log.
test('a tiktok strategy names the command that can actually publish it', () => {
  for (const s of ['tiktok-draft', 'tiktok-direct']) {
    assert.throws(() => routeFor(s), /tiktok-draft\.mjs/)
  }
})

// These are scheduled by Meta at authoring time and never reach a routine, but
// if one ever did, sending it to Instagram would be worse than refusing it.
test('a strategy the routine does not fire is refused rather than guessed at', () => {
  for (const s of ['fb-scheduled', 'fb-text', 'ig-carousel']) {
    assert.throws(() => routeFor(s), new RegExp(s))
  }
})
