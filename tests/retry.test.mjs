import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransient, withRetry } from '../publish/retry.mjs'

const netError = (code = 'UND_ERR_SOCKET') => {
  const e = new TypeError('fetch failed')
  e.cause = Object.assign(new Error('other side closed'), { code })
  return e
}

test('a call that succeeds first time is not retried', async () => {
  let calls = 0
  const result = await withRetry(async () => { calls += 1; return 'ok' }, { sleep: async () => {} })
  assert.equal(result, 'ok')
  assert.equal(calls, 1)
})

// A 55-second upload to Singapore drops often enough that one lost socket must
// not cost the whole gameweek's video.
test('a dropped socket is retried and can still succeed', async () => {
  let calls = 0
  const result = await withRetry(
    async () => { calls += 1; if (calls < 3) throw netError(); return 'ok' },
    { sleep: async () => {} },
  )
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

test('it gives up after the attempt budget rather than hammering tiktok', async () => {
  let calls = 0
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw netError() }, { attempts: 3, sleep: async () => {} }),
    /fetch failed/,
  )
  assert.equal(calls, 3)
})

// Retrying a rejected caption or a bad token just repeats the same refusal.
test('an error tiktok actually returned is not retried', async () => {
  let calls = 0
  await assert.rejects(
    () => withRetry(
      async () => { calls += 1; throw new Error('TikTok refused: spam_risk_too_many_posts — daily limit') },
      { sleep: async () => {} },
    ),
    /spam_risk/,
  )
  assert.equal(calls, 1, 'a refusal is an answer, not a failure to deliver')
})

test('backoff grows so a struggling link is not hammered', async () => {
  const waits = []
  await assert.rejects(
    () => withRetry(async () => { throw netError() }, { attempts: 4, sleep: async (ms) => waits.push(ms) }),
    /fetch failed/,
  )
  assert.equal(waits.length, 3, 'no sleep after the final attempt')
  for (let i = 1; i < waits.length; i += 1) assert.ok(waits[i] > waits[i - 1], `${waits}`)
})

test('it recognises the network failures node actually throws', () => {
  for (const code of ['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.ok(isTransient(netError(code)), code)
  }
  assert.ok(isTransient(new TypeError('fetch failed')), 'a bare fetch failure is still a network failure')
  assert.ok(!isTransient(new Error('TikTok refused: bad_request — nope')))
  assert.ok(!isTransient(new Error('chunk 0 read 10 bytes, expected 500')))
})
