/**
 * Confirming the bytes that will publish are the bytes that were reviewed.
 *
 * Its own module because two entry points need it — the routine that publishes and the pass that
 * schedules — and `publish.mjs` runs `main()` on import, so nothing can be lifted out of it.
 */

import { createHash } from 'node:crypto'

/**
 * The manifest was reviewed as a diff; this confirms the bytes actually served are the ones that
 * were reviewed.
 *
 * @param {string} mediaUrl
 * @param {string} expectedSha lowercase hex sha256 from the manifest
 */
export async function verifyMedia(mediaUrl, expectedSha) {
  const res = await fetch(mediaUrl)
  if (!res.ok) throw new Error(`Media ${mediaUrl} returned HTTP ${res.status}.`)
  const actual = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')
  if (actual !== expectedSha) {
    throw new Error(`Media ${mediaUrl} hashes to ${actual.slice(0, 12)}…, manifest says ${expectedSha.slice(0, 12)}….`)
  }
}
