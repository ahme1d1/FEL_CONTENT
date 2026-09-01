#!/usr/bin/env node
/**
 * One-time TikTok authorization. Run this once; the token file it writes keeps
 * itself alive from then on.
 *
 *   export TIKTOK_CLIENT_KEY=aw1a…
 *   export TIKTOK_CLIENT_SECRET=…
 *   node publish/tiktok-auth-cli.mjs
 *
 * There is no local callback server because there cannot be one: TikTok only
 * registers redirect URIs that are absolute https, so http://localhost is not
 * an option. The redirect lands on a page that need not exist — a 404 still
 * carries ?code= in the address bar — and you paste that address back here.
 *
 * The redirect URI must match what is registered in the TikTok app exactly.
 */

import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { SCOPES, TOKEN_PATH, buildAuthorizeUrl, exchangeCode, parseCallback, writeTokenFile } from './tiktok-auth.mjs'
import { getUserInfo, postForm } from './tiktok-http.mjs'

const DEFAULT_REDIRECT_URI = 'https://fantasyeg.com/tiktok/callback'

async function main() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI

  const missing = [!clientKey && 'TIKTOK_CLIENT_KEY', !clientSecret && 'TIKTOK_CLIENT_SECRET'].filter(Boolean)
  if (missing.length) throw new Error(`Missing required environment: ${missing.join(', ')}.`)

  const state = randomBytes(12).toString('base64url')
  const authorizeUrl = buildAuthorizeUrl({ clientKey, redirectUri, state })

  console.log('\nOpen this and approve as the FEL account (@fantasyeg.official):\n')
  console.log(`  ${authorizeUrl}\n`)
  console.log(`  scopes       ${SCOPES.join(', ')}`)
  console.log(`  redirect     ${redirectUri}`)
  console.log('\nTikTok will bounce you to that redirect. The page may 404 — that is fine.')
  console.log('Copy the whole address bar and paste it below.\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let pasted
  try {
    pasted = (await rl.question('Redirected URL: ')).trim()
  } finally {
    rl.close()
  }

  const { code } = parseCallback(pasted, state)
  console.log('\n  state ok')

  const bundle = await exchangeCode({ postForm, clientKey, clientSecret, code, redirectUri, now: new Date() })

  // Written before anything else is done with it: an unpersisted token is lost.
  writeTokenFile(TOKEN_PATH, bundle)
  console.log(`  wrote ${TOKEN_PATH} (0600, gitignored)`)

  const user = await getUserInfo(bundle.accessToken)
  console.log(`  authorized as ${user.display_name ?? '(no display name)'} — open_id ${bundle.openId}`)
  console.log(`  scopes granted: ${bundle.scope}`)
  console.log(`  access token expires ${bundle.expiresAt}`)
  console.log(`  refresh token expires ${bundle.refreshExpiresAt}\n`)

  if (!bundle.scope?.includes('video.upload')) {
    throw new Error('video.upload was not granted; drafts will fail. Check the app products and reauthorize.')
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`)
  process.exit(2)
})
