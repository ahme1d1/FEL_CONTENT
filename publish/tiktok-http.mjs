/**
 * Real HTTP for TikTok, kept apart from every module that has logic in it so
 * the tests never need a network stub for something they should not be reaching.
 *
 * Three shapes, because TikTok uses three: form-encoded for OAuth, JSON with a
 * bearer for the API, and a raw PUT for file chunks.
 */

import { API_BASE } from './platforms/tiktok.mjs'
import { withRetry } from './retry.mjs'

const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/'

/** Say it out loud - a silent retry hides a link that is failing every time. */
const retryNotice = (what) => ({ attempt, attempts, delay, error }) =>
  console.error(`    ${what} — ${error.cause?.code ?? error.message}; retry ${attempt}/${attempts - 1} in ${delay / 1000}s`)

/** OAuth. Errors here are flat strings, not the API's nested error object. */
export async function postForm({ url, form }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
  const json = await res.json().catch(() => ({}))

  if (typeof json?.error === 'string' && json.error && json.error !== 'ok') {
    throw new Error(`TikTok refused: ${json.error} — ${json.error_description ?? 'no detail'}`)
  }
  if (!res.ok) throw new Error(`POST ${url} failed: HTTP ${res.status}`)
  return json
}

/** The API. Binds the token once, exactly as graphHttp does for Meta. */
export function apiHttp(accessToken) {
  return ({ path, body }) =>
    withRetry(
      async () => {
        const res = await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        // A TikTok error object carries more than the status does, so let it through
        // and let unwrap() raise it. Only an empty non-2xx is reported here.
        if (!res.ok && !json?.error) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
        return json
      },
      { onRetry: retryNotice(`POST ${path}`) },
    )
}

/**
 * One file chunk. Retried on a dropped socket: the request names its own byte
 * range, so re-sending it is idempotent. A 23 MB chunk takes about a minute to
 * reach TikTok's Singapore host, which is long enough to lose a connection.
 */
export function putChunk({ url, headers, body }) {
  return withRetry(
    async () => {
      const res = await fetch(url, { method: 'PUT', headers, body })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`chunk PUT failed: HTTP ${res.status} ${detail}`.slice(0, 300))
      }
    },
    { onRetry: retryNotice(`chunk ${headers['Content-Range']}`) },
  )
}

/**
 * What `user.info.basic` is for: confirming which account was authorized before
 * anything is uploaded to it. `username` needs user.info.profile, which we do
 * not request, so display_name is the most specific name available.
 */
export async function getUserInfo(accessToken) {
  const url = `${USER_INFO_URL}?fields=open_id,display_name,avatar_url`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const json = await res.json().catch(() => ({}))
  const code = json?.error?.code
  if (code && code !== 'ok') throw new Error(`user info failed: ${code} — ${json.error.message ?? ''}`)
  return json?.data?.user ?? {}
}
