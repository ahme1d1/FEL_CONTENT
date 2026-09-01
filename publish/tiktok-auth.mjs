/**
 * TikTok user access tokens.
 *
 * Composio has no managed auth for TikTok, so this is the whole credential
 * layer: authorize once from this machine, then keep the pair alive.
 *
 * The rule the rest of the file exists to enforce: TikTok rotates the refresh
 * token on most refreshes and retires the one you sent. Lose the new one and
 * the connection is dead — no retry, no repair, only a fresh authorization. So
 * the new pair is written to disk atomically and BEFORE the access token is
 * handed to a caller. A failed write means no publish, which is recoverable.
 *
 * Zero npm dependencies. HTTP is injected so every test runs offline.
 */

import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

export const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
export const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
export const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/'

/** Gitignored, and never anywhere else. */
export const TOKEN_PATH = 'publish/.tiktok-token.json'

/**
 * Drafts need `video.upload`; reading the handle back after authorizing needs
 * `user.info.basic`. Direct Post is off, so `video.publish` is deliberately not
 * requested — asking for it would put the app into an audit it cannot pass yet.
 */
export const SCOPES = ['user.info.basic', 'video.upload']

/** Refresh this far ahead of expiry rather than racing the clock mid-upload. */
const SKEW_MS = 10 * 60 * 1000

const AUTHORIZE_AGAIN = 'Authorize once with: node publish/tiktok-auth-cli.mjs'

/**
 * TikTok registers redirect URIs strictly: absolute https, no query, no
 * fragment. Catching it here beats discovering it in a browser redirect.
 */
function assertRedirectUri(redirectUri) {
  if (!/^https:\/\//.test(redirectUri ?? '')) {
    throw new Error(`redirectUri "${redirectUri}" must be absolute https — TikTok rejects http, including localhost.`)
  }
  if (/[?#]/.test(redirectUri)) {
    throw new Error(`redirectUri "${redirectUri}" must be static; TikTok denies query parameters and fragments.`)
  }
}

/** @returns {string} the URL to open in a browser and approve. */
export function buildAuthorizeUrl({ clientKey, redirectUri, state, scopes = SCOPES }) {
  assertRedirectUri(redirectUri)
  if (!clientKey) throw new Error('clientKey is required; set TIKTOK_CLIENT_KEY.')
  if (!state) throw new Error('state is required; it is the only guard against a forged code.')

  const query = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: scopes.join(','),
    redirect_uri: redirectUri,
    state,
  })
  return `${AUTHORIZE_URL}?${query}`
}

/**
 * Reads the authorization code out of the URL the browser landed on. The page
 * itself need not exist — a 404 still carries the query string.
 * @returns {{code: string}}
 */
export function parseCallback(url, expectedState) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (cause) {
    throw new Error(`"${String(url).slice(0, 60)}" is not a URL.`, { cause })
  }

  const q = parsed.searchParams
  if (q.get('error')) {
    throw new Error(`TikTok refused the authorization: ${q.get('error')} — ${q.get('error_description') ?? 'no detail'}`)
  }
  if (q.get('state') !== expectedState) {
    throw new Error(`state "${q.get('state')}" does not match "${expectedState}"; this code came from somewhere else.`)
  }

  const code = q.get('code')
  if (!code) throw new Error('That URL carries no code parameter. Paste the whole address bar, including the query string.')
  return { code }
}

/**
 * Turns TikTok's relative lifetimes into absolute instants, so a token file
 * that has been sitting on disk for a week cannot read as fresh.
 */
export function bundleFrom(reply, now) {
  if (!reply?.access_token || !reply?.refresh_token) {
    throw new Error(`TikTok returned no token pair: ${JSON.stringify(reply)?.slice(0, 200)}`)
  }
  const at = (seconds) => new Date(now.getTime() + Number(seconds) * 1000).toISOString()
  return {
    openId: reply.open_id ?? null,
    scope: reply.scope ?? '',
    accessToken: reply.access_token,
    expiresAt: at(reply.expires_in),
    refreshToken: reply.refresh_token,
    refreshExpiresAt: at(reply.refresh_expires_in),
    updatedAt: now.toISOString(),
  }
}

export async function exchangeCode({ postForm, clientKey, clientSecret, code, redirectUri, now }) {
  assertRedirectUri(redirectUri)
  const reply = await postForm({
    url: TOKEN_URL,
    form: {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
  })
  return bundleFrom(reply, now)
}

export async function refreshTokens({ postForm, clientKey, clientSecret, refreshToken, now }) {
  const reply = await postForm({
    url: TOKEN_URL,
    form: {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  })
  return bundleFrom(reply, now)
}

/** @returns {object|null} the stored pair, or null when there is nothing to read. */
export function readTokenFile(path = TOKEN_PATH) {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${path} is not JSON. Delete it and reauthorize.`, { cause })
  }
  for (const key of ['accessToken', 'expiresAt', 'refreshToken', 'refreshExpiresAt']) {
    if (!parsed?.[key]) throw new Error(`${path} is missing "${key}". Delete it and reauthorize.`)
  }
  return parsed
}

/**
 * Write, flush, rename, flush the directory. A half-written token file is a
 * dead connection, and rename is the only step POSIX promises is atomic.
 */
export function writeTokenFile(path, bundle) {
  const tmp = `${path}.tmp`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(bundle, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  renameSync(tmp, path)
  chmodSync(path, 0o600)

  const dir = openSync(dirname(path) || '.', 'r')
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
  return bundle
}

/**
 * The only way the rest of the pipeline gets a TikTok access token.
 * @returns {Promise<string>} a token good for at least the skew window
 */
export async function accessTokenFor({
  postForm,
  clientKey,
  clientSecret,
  now = new Date(),
  path = TOKEN_PATH,
  read = () => readTokenFile(path),
  write = (bundle) => writeTokenFile(path, bundle),
}) {
  const current = read()
  if (!current) throw new Error(`No TikTok token at ${path}. ${AUTHORIZE_AGAIN}`)

  if (new Date(current.expiresAt).getTime() - now.getTime() > SKEW_MS) return current.accessToken

  if (new Date(current.refreshExpiresAt).getTime() <= now.getTime()) {
    throw new Error(`The TikTok refresh token expired on ${current.refreshExpiresAt}. ${AUTHORIZE_AGAIN}`)
  }

  const next = await refreshTokens({ postForm, clientKey, clientSecret, refreshToken: current.refreshToken, now })

  // Deliberately before the return: an unpersisted rotation loses the account.
  write(next)

  return next.accessToken
}
