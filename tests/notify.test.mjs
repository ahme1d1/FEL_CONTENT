import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TELEGRAM_LIMIT, buildPayload, notify, toPlainText } from '../publish/notify.mjs'

const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init })
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

const netError = () => {
  const e = new TypeError('fetch failed')
  e.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  return e
}

// The bodies come from watchdog-plan.mjs, which writes markdown for a GitHub issue. Telegram
// without a parse_mode shows those characters literally, and escaping for MarkdownV2 is its own
// class of bug, so the markers are stripped instead.
test('markdown written for a GitHub issue is flattened for Telegram', () => {
  const md = '**3 post(s) more than 90 minutes late**\n- `gw04-d2-1400-ig-feed` due 2026-09-05'
  assert.equal(
    toPlainText(md),
    '3 post(s) more than 90 minutes late\n- gw04-d2-1400-ig-feed due 2026-09-05',
  )
})

test('a body that is already plain is left alone', () => {
  assert.equal(toPlainText('Publish failed at 2026-09-05T09:00:00Z'), 'Publish failed at 2026-09-05T09:00:00Z')
})

// Telegram rejects the whole message over its limit, so a long backlog must not cost the alarm.
test('an over-long body is truncated rather than rejected', () => {
  const payload = buildPayload({ chatId: '42', text: 'x'.repeat(TELEGRAM_LIMIT + 500) })
  assert.ok(payload.text.length <= TELEGRAM_LIMIT)
  assert.match(payload.text, /truncated/)
})

test('a body inside the limit is sent whole', () => {
  const payload = buildPayload({ chatId: '42', text: 'short' })
  assert.equal(payload.text, 'short')
  assert.equal(payload.chat_id, '42')
})

// The secrets may legitimately not be set yet. A notifier that fails the job it is reporting on
// is worse than the silence it replaces.
test('missing credentials are a no-op, not a failure', async () => {
  const calls = []
  const sent = await notify({ text: 'hi', token: '', chatId: '', fetchImpl: okFetch(calls) })
  assert.equal(sent, false)
  assert.equal(calls.length, 0)
})

test('it posts the message to the bot API', async () => {
  const calls = []
  const sent = await notify({ text: 'hi', token: 'T', chatId: '42', fetchImpl: okFetch(calls) })
  assert.equal(sent, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.telegram.org/botT/sendMessage')
  assert.equal(JSON.parse(calls[0].init.body).chat_id, '42')
})

test('a dropped socket is retried and can still deliver', async () => {
  let n = 0
  const fetchImpl = async () => {
    n += 1
    if (n < 3) throw netError()
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  assert.equal(await notify({ text: 'hi', token: 'T', chatId: '42', fetchImpl, sleep: async () => {} }), true)
  assert.equal(n, 3)
})

// A 400 is an ANSWER — a bad chat id repeats identically however often it is asked.
test('a refusal is not retried and never throws', async () => {
  let n = 0
  const fetchImpl = async () => {
    n += 1
    return { ok: false, status: 400, json: async () => ({ description: 'chat not found' }) }
  }
  assert.equal(await notify({ text: 'hi', token: 'T', chatId: 'bad', fetchImpl, sleep: async () => {} }), false)
  assert.equal(n, 1)
})

test('a network that never comes back still does not throw', async () => {
  const fetchImpl = async () => { throw netError() }
  assert.equal(await notify({ text: 'hi', token: 'T', chatId: '42', fetchImpl, sleep: async () => {} }), false)
})
