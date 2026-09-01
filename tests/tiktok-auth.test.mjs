import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTHORIZE_URL,
  SCOPES,
  accessTokenFor,
  buildAuthorizeUrl,
  bundleFrom,
  exchangeCode,
  parseCallback,
  refreshTokens,
} from '../publish/tiktok-auth.mjs'

const NOW = new Date('2026-09-01T12:00:00Z')
const app = { clientKey: 'aw1atest', clientSecret: 'shhh', redirectUri: 'https://fantasyeg.com/tiktok/callback' }

/** Records every call and replies from a scripted queue, like tests/meta.test.mjs. */
function recorder(replies = []) {
  const calls = []
  const queue = [...replies]
  const postForm = async ({ url, form }) => {
    calls.push({ url, form })
    if (!queue.length) throw new Error(`no scripted reply for ${url}`)
    const reply = queue.shift()
    if (reply instanceof Error) throw reply
    return reply
  }
  return { postForm, calls }
}

const tokenReply = (over = {}) => ({
  open_id: 'OPEN_1',
  scope: 'user.info.basic,video.upload',
  access_token: 'ACCESS_1',
  expires_in: 86400,
  refresh_token: 'REFRESH_1',
  refresh_expires_in: 31536000,
  token_type: 'Bearer',
  ...over,
})

const bundle = (over = {}) => ({
  openId: 'OPEN_1',
  scope: 'user.info.basic,video.upload',
  accessToken: 'ACCESS_1',
  expiresAt: '2026-09-02T12:00:00.000Z',
  refreshToken: 'REFRESH_1',
  refreshExpiresAt: '2027-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  ...over,
})

// ── the authorize URL ──────────────────────────────────────────────────────

test('the authorize url carries every parameter tiktok requires', () => {
  const url = new URL(buildAuthorizeUrl({ ...app, state: 'xY9' }))

  assert.equal(`${url.origin}${url.pathname}`, AUTHORIZE_URL)
  assert.equal(url.searchParams.get('client_key'), 'aw1atest')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), app.redirectUri)
  assert.equal(url.searchParams.get('state'), 'xY9')
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.upload')
})

// Drafts need video.upload; the handle readback needs user.info.basic. Direct
// Post is off, so video.publish must not be requested — it would fail audit.
test('it asks for the two scopes the app actually has, and no more', () => {
  assert.deepEqual(SCOPES, ['user.info.basic', 'video.upload'])
  assert.ok(!buildAuthorizeUrl({ ...app, state: 's' }).includes('video.publish'))
})

test('a redirect uri that is not absolute https is refused before the browser opens', () => {
  assert.throws(() => buildAuthorizeUrl({ ...app, redirectUri: 'http://localhost:8080/cb', state: 's' }), /https/i)
})

// ── the pasted callback ────────────────────────────────────────────────────

test('the code is read out of the url the browser was redirected to', () => {
  const { code } = parseCallback('https://fantasyeg.com/tiktok/callback?code=ABC123&scopes=video.upload&state=xY9', 'xY9')
  assert.equal(code, 'ABC123')
})

// A mismatched state is the one signal that the code came from somewhere else.
test('a state that does not match is rejected rather than exchanged', () => {
  assert.throws(
    () => parseCallback('https://fantasyeg.com/tiktok/callback?code=ABC123&state=WRONG', 'xY9'),
    /state/i,
  )
})

test('the error tiktok sends back is surfaced instead of a missing-code error', () => {
  assert.throws(
    () => parseCallback('https://fantasyeg.com/tiktok/callback?error=access_denied&error_description=User+declined&state=xY9', 'xY9'),
    /User declined/,
  )
})

test('a url with no code at all says so plainly', () => {
  assert.throws(() => parseCallback('https://fantasyeg.com/tiktok/callback?state=xY9', 'xY9'), /code/i)
})

// ── exchanging and refreshing ──────────────────────────────────────────────

test('the code exchange sends the grant tiktok documents, with the same redirect uri', async () => {
  const { postForm, calls } = recorder([tokenReply()])
  const result = await exchangeCode({ postForm, ...app, code: 'ABC123', now: NOW })

  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/oauth/token/')
  assert.equal(calls[0].form.grant_type, 'authorization_code')
  assert.equal(calls[0].form.client_key, 'aw1atest')
  assert.equal(calls[0].form.client_secret, 'shhh')
  assert.equal(calls[0].form.code, 'ABC123')
  assert.equal(calls[0].form.redirect_uri, app.redirectUri)
  assert.equal(result.accessToken, 'ACCESS_1')
  assert.equal(result.openId, 'OPEN_1')
})

test('relative lifetimes become absolute instants, so a stale file cannot look fresh', () => {
  const b = bundleFrom(tokenReply(), NOW)
  assert.equal(b.expiresAt, '2026-09-02T12:00:00.000Z')
  assert.equal(b.refreshExpiresAt, '2027-09-01T12:00:00.000Z')
  assert.equal(b.updatedAt, '2026-09-01T12:00:00.000Z')
})

test('a refresh sends no redirect uri and no code, only the refresh grant', async () => {
  const { postForm, calls } = recorder([tokenReply({ access_token: 'ACCESS_2', refresh_token: 'REFRESH_2' })])
  const result = await refreshTokens({ postForm, ...app, refreshToken: 'REFRESH_1', now: NOW })

  assert.equal(calls[0].form.grant_type, 'refresh_token')
  assert.equal(calls[0].form.refresh_token, 'REFRESH_1')
  assert.ok(!('redirect_uri' in calls[0].form))
  assert.ok(!('code' in calls[0].form))
  assert.equal(result.refreshToken, 'REFRESH_2')
})

// ── rotation: the thing that kills the connection if it goes wrong ─────────

test('a valid token is handed out without touching the network', async () => {
  const { postForm, calls } = recorder([])
  const writes = []
  const token = await accessTokenFor({
    ...app,
    postForm,
    now: NOW,
    read: () => bundle(),
    write: (b) => writes.push(b),
  })

  assert.equal(token, 'ACCESS_1')
  assert.equal(calls.length, 0, 'a token good for another day must not be refreshed')
  assert.equal(writes.length, 0, 'and must not rewrite the file')
})

test('a token inside the expiry skew is refreshed before it is used', async () => {
  const { postForm, calls } = recorder([tokenReply({ access_token: 'ACCESS_2', refresh_token: 'REFRESH_2' })])
  const writes = []
  const token = await accessTokenFor({
    ...app,
    postForm,
    now: new Date('2026-09-02T11:55:00Z'),
    read: () => bundle(),
    write: (b) => writes.push(b),
  })

  assert.equal(calls.length, 1)
  assert.equal(token, 'ACCESS_2')
})

// TikTok returns a NEW refresh token on most refreshes and retires the old one.
// Losing it is unrecoverable: the connection dies and must be reauthorized.
test('the rotated refresh token is what gets persisted, not the one we sent', async () => {
  const { postForm } = recorder([tokenReply({ access_token: 'ACCESS_2', refresh_token: 'REFRESH_2' })])
  const writes = []
  await accessTokenFor({
    ...app,
    postForm,
    now: new Date('2026-09-02T11:55:00Z'),
    read: () => bundle(),
    write: (b) => writes.push(b),
  })

  assert.equal(writes.length, 1)
  assert.equal(writes[0].refreshToken, 'REFRESH_2')
  assert.equal(writes[0].accessToken, 'ACCESS_2')
})

// If we cannot write the new pair down, using it would burn the old one and
// leave nothing on disk. Refusing to publish is the recoverable failure.
test('a token that cannot be persisted is never handed out', async () => {
  const { postForm } = recorder([tokenReply({ access_token: 'ACCESS_2', refresh_token: 'REFRESH_2' })])
  await assert.rejects(
    () =>
      accessTokenFor({
        ...app,
        postForm,
        now: new Date('2026-09-02T11:55:00Z'),
        read: () => bundle(),
        write: () => {
          throw new Error('disk full')
        },
      }),
    /disk full/,
  )
})

test('an expired refresh token asks for reauthorization rather than retrying forever', async () => {
  const { postForm, calls } = recorder([])
  await assert.rejects(
    () =>
      accessTokenFor({
        ...app,
        postForm,
        now: new Date('2027-09-02T12:00:00Z'),
        read: () => bundle(),
        write: () => {},
      }),
    /tiktok-auth-cli/,
  )
  assert.equal(calls.length, 0, 'a dead refresh token is not worth a request')
})

test('no token file at all points at the one-time authorize command', async () => {
  const { postForm } = recorder([])
  await assert.rejects(
    () => accessTokenFor({ ...app, postForm, now: NOW, read: () => null, write: () => {} }),
    /tiktok-auth-cli/,
  )
})
