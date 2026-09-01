#!/usr/bin/env node
/**
 * The routine's payload.
 *
 * Deliberately dumb: read the manifest, work out what is due, post it, record
 * it. All judgment lives here rather than in the routine's prompt, because an
 * LLM session publishing to a public brand account should decide as little as
 * possible.
 *
 * Zero npm dependencies. Node 24 ships fetch, FormData and node:crypto, and all
 * three platforms are plain HTTPS.
 *
 *   node publish/publish.mjs --manifest manifests/gw03.json < token.txt
 *   node publish/publish.mjs --manifest fixtures/gw03.json --dry-run --now 2026-09-03T08:00:00Z
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { validateManifest } from '../build/manifest-schema.mjs'
import { selectDue } from './due.mjs'
import { appendLedger, readLedger, record } from './ledger.mjs'
import { routeFor } from './route.mjs'
import { publishFacebookStory, publishInstagram } from './platforms/meta.mjs'

const GRAPH = 'https://graph.facebook.com/v21.0'

function parseArgs(argv) {
  const args = { dryRun: false, ledger: 'publish/ledger.jsonl', now: null, manifest: null, skipMediaCheck: false }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--skip-media-check') args.skipMediaCheck = true
    else if (flag === '--manifest') args.manifest = value()
    else if (flag === '--ledger') args.ledger = value()
    else if (flag === '--now') args.now = value()
    else throw new Error(`Unknown argument "${argv[i]}".`)
  }
  if (!args.manifest) throw new Error('--manifest <path> is required.')
  return args
}

/** Reads the Page token from stdin so it never lands in a command line or a log. */
function readToken() {
  try {
    return readFileSync(0, 'utf8').trim()
  } catch {
    return ''
  }
}

const graphHttp = (token) => async ({ method, path, form }) => {
  const body = new URLSearchParams({ ...form, access_token: token })
  const url = method === 'GET' ? `${GRAPH}${path}?${body}` : `${GRAPH}${path}`
  const res = await fetch(url, method === 'GET' ? {} : { method: 'POST', body })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`${method} ${path} failed: ${detail}`)
  }
  return json
}

/** Prints what it would send and hands back believable ids, so the real code path runs. */
function dryRunHttp(log) {
  let n = 0
  return async ({ method, path, form }) => {
    const shown = { ...form }
    if (shown.caption) shown.caption = `${shown.caption.slice(0, 40)}…`
    log.push(`    ${method} ${path}  ${JSON.stringify(shown)}`)
    if (path.endsWith('/media_publish')) return { id: `DRYRUN_MEDIA_${++n}` }
    if (path.endsWith('/photo_stories')) return { post_id: `DRYRUN_STORY_${++n}` }
    if (path.endsWith('/photos') || path.endsWith('/media')) return { id: `DRYRUN_CONTAINER_${++n}` }
    return { status_code: 'FINISHED' }
  }
}

/**
 * Fail at startup rather than sending a request to /undefined/media. In a dry
 * run the names stand in for themselves so the printed plan stays readable.
 */
function resolveTargets(dryRun) {
  const igUserId = process.env.IG_USER_ID
  const pageId = process.env.FB_PAGE_ID
  if (dryRun) return { igUserId: igUserId ?? '<IG_USER_ID>', pageId: pageId ?? '<FB_PAGE_ID>' }

  const missing = [!igUserId && 'IG_USER_ID', !pageId && 'FB_PAGE_ID'].filter(Boolean)
  if (missing.length) throw new Error(`Missing required environment: ${missing.join(', ')}.`)
  return { igUserId, pageId }
}

/**
 * The manifest was reviewed as a diff; this confirms the bytes actually served
 * are the ones that were reviewed.
 */
async function verifyMedia(mediaUrl, expectedSha) {
  const res = await fetch(mediaUrl)
  if (!res.ok) throw new Error(`Media ${mediaUrl} returned HTTP ${res.status}.`)
  const actual = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')
  if (actual !== expectedSha) {
    throw new Error(`Media ${mediaUrl} hashes to ${actual.slice(0, 12)}…, manifest says ${expectedSha.slice(0, 12)}….`)
  }
}

async function publishOne({ post, manifest, http, igUserId, pageId }) {
  const mediaUrl = `${manifest.mediaBase}/${post.media.file}`
  if (routeFor(post.strategy) === 'fb-story') return publishFacebookStory({ http, pageId, mediaUrl })
  return publishInstagram({ http, igUserId, post, mediaUrl })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))

  const invalid = validateManifest(manifest)
  if (invalid.length) {
    console.error(`Manifest ${args.manifest} is invalid; refusing to publish:`)
    for (const f of invalid) console.error(`  [${f.ruleId}] post ${f.post}: ${f.message}`)
    process.exit(2)
  }

  const { igUserId, pageId } = resolveTargets(args.dryRun)
  const now = args.now ? new Date(args.now) : new Date()
  const ledger = readLedger(args.ledger)
  const { due, skipped, crashed } = selectDue({ manifest, ledger, now })

  console.log(`${args.dryRun ? 'DRY RUN' : 'PUBLISH'} at ${now.toISOString()} — gameweek ${manifest.gameweek}`)
  console.log(`  due ${due.length} · skipped ${skipped.length} · needs reconciliation ${crashed.length}`)

  const token = args.dryRun ? '' : readToken()
  if (!args.dryRun && !token) throw new Error('No Page access token on stdin.')

  const log = []
  const http = args.dryRun ? dryRunHttp(log) : graphHttp(token)
  const write = (r) => (args.dryRun ? log.push(`    LEDGER ${JSON.stringify(r)}`) : appendLedger(args.ledger, r))

  let failures = 0

  for (const post of skipped) {
    console.log(`  SKIP ${post.id} — past its lateness budget; a late post is worse than silence`)
    write(record(post.id, 'skipped', { reason: 'past-lateness-budget', publishAt: post.publishAt }))
    failures += 1
  }

  for (const post of crashed) {
    console.error(`  STUCK ${post.id} — claimed but never closed out. Reconcile by hand; do not re-post.`)
    failures += 1
  }

  for (const post of due) {
    console.log(`  POST ${post.id} (${post.strategy})`)
    write(record(post.id, 'claimed', { strategy: post.strategy, mediaSha256: post.media?.sha256 ?? null }))
    try {
      if (!args.dryRun && !args.skipMediaCheck && post.media) {
        await verifyMedia(`${manifest.mediaBase}/${post.media.file}`, post.media.sha256)
      }
      const { remoteId } = await publishOne({ post, manifest, http, igUserId, pageId })
      console.log(`    ok — ${remoteId}`)
      write(record(post.id, post.strategy.startsWith('tiktok') ? 'drafted' : 'published', { remoteId }))
    } catch (err) {
      console.error(`    failed — ${err.message}`)
      write(record(post.id, 'failed', { error: err.message }))
      failures += 1
    }
  }

  if (log.length) console.log(log.join('\n'))
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
