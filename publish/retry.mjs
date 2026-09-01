/**
 * Retrying the network, and only the network.
 *
 * A chunk upload to TikTok runs about a minute - 23 MB to a Singapore host at
 * roughly 400 KB/s - and a link that flaky drops sockets. Losing a gameweek's
 * video to one dropped socket is not acceptable; re-sending the same byte range
 * costs nothing, because the request carries an explicit Content-Range and is
 * therefore idempotent.
 *
 * What must NOT be retried is an answer. If TikTok refused the post, repeating
 * the request repeats the refusal and burns the rate limit doing it.
 */

const ATTEMPTS = 4
const BASE_DELAY_MS = 2000

/** Node throws TypeError('fetch failed') and hides the real reason in .cause. */
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

/** @returns {boolean} true when the request never got an answer. */
export function isTransient(err) {
  if (!err) return false
  if (NETWORK_CODES.has(err.cause?.code) || NETWORK_CODES.has(err.code)) return true
  return err instanceof TypeError && /fetch failed/i.test(err.message)
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {() => Promise<T>} fn an idempotent request
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, { attempts = ATTEMPTS, sleep = defaultSleep, onRetry } = {}) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransient(err)) throw err
      last = err
      if (attempt === attempts) break
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1)
      onRetry?.({ attempt, attempts, delay, error: err })
      await sleep(delay)
    }
  }
  throw last
}
