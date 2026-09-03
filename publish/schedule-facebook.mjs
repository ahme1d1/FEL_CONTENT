#!/usr/bin/env node
/**
 * The Facebook half of the authoring pass.
 *
 *   node publish/schedule-facebook.mjs --manifest manifests/gw04.json --dry-run
 *   printf '%s' "$FB_PAGE_TOKEN" | node publish/schedule-facebook.mjs --manifest manifests/gw04.json
 *
 * `due.mjs` skips `fb-scheduled` and `fb-text` because Meta schedules them natively "during the
 * authoring pass". Until now nothing performed that pass but a curl typed by hand. This does, with
 * the same ledger discipline the routine uses, so the two can never post the same thing twice.
 *
 * Run by hand, like `tiktok-draft.mjs`, and not from CI: it hands Meta a queue that then survives
 * on its own, so there is nothing for a cron to keep doing.
 */

import { readFileSync } from 'node:fs'
import { cairoWallClock, validateManifest } from '../build/manifest-schema.mjs'
import { appendLedger, readLedger, record } from './ledger.mjs'
import { verifyMedia } from './media.mjs'
import { selectSchedulable } from './schedule-plan.mjs'
import {
  epochSeconds,
  scheduleFacebookPhoto,
  scheduleFacebookText,
  scheduleFacebookVideo,
} from './platforms/fb-schedule.mjs'

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

/** Prints what it would send and hands back a believable id, so the real code path runs. */
function dryRunHttp(log) {
  let n = 0
  return async ({ method, path, form }) => {
    const shown = { ...form, message: `${form.message.slice(0, 40)}…` }
    log.push(`    ${method} ${path}  ${JSON.stringify(shown)}`)
    return { id: `DRYRUN_${++n}`, post_id: `DRYRUN_POST_${n}` }
  }
}

function resolvePageId(dryRun) {
  const pageId = process.env.FB_PAGE_ID
  if (dryRun) return pageId ?? '<FB_PAGE_ID>'
  if (!pageId) throw new Error('Missing required environment: FB_PAGE_ID.')
  return pageId
}

const scheduleOne = ({ post, manifest, http, pageId }) =>
  post.strategy === 'fb-text'
    ? scheduleFacebookText({ http, pageId, post })
    : (post.strategy === 'fb-video' ? scheduleFacebookVideo : scheduleFacebookPhoto)({
        http,
        pageId,
        post,
        mediaUrl: `${manifest.mediaBase}/${post.media.file}`,
      })

/** The three readings of one instant, so a wrong one is obvious before it is sent. */
const when = (post) =>
  `${post.slotCairo ?? `${cairoWallClock(post.publishAt)} Cairo`} · ${post.publishAt} · ${epochSeconds(post.publishAt)}`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))

  const invalid = validateManifest(manifest)
  if (invalid.length) {
    console.error(`Manifest ${args.manifest} is invalid; refusing to schedule:`)
    for (const f of invalid) console.error(`  [${f.ruleId}] post ${f.post}: ${f.message}`)
    process.exit(2)
  }

  const pageId = resolvePageId(args.dryRun)
  const now = args.now ? new Date(args.now) : new Date()
  const ledger = readLedger(args.ledger)
  const plan = selectSchedulable({ manifest, ledger, now })

  console.log(`${args.dryRun ? 'DRY RUN' : 'SCHEDULE'} at ${now.toISOString()} — gameweek ${manifest.gameweek}`)
  console.log(
    `  to schedule ${plan.toSchedule.length} · already ${plan.alreadyScheduled.length} · ` +
      `no caption ${plan.needsCaption.length} · out of window ${plan.tooSoon.length + plan.tooFar.length} · ` +
      `needs reconciliation ${plan.crashed.length}`,
  )

  const token = args.dryRun ? '' : readToken()
  if (!args.dryRun && !token) throw new Error('No Page access token on stdin.')

  const log = []
  const http = args.dryRun ? dryRunHttp(log) : graphHttp(token)
  const write = (r) => (args.dryRun ? log.push(`    LEDGER ${JSON.stringify(r)}`) : appendLedger(args.ledger, r))

  let failures = 0

  for (const post of plan.alreadyScheduled) {
    console.log(`  HELD ${post.id} — Facebook already has it`)
  }
  for (const post of [...plan.needsCaption, ...plan.tooSoon, ...plan.tooFar]) {
    console.log(`  SKIP ${post.id} — ${post.reason}`)
  }
  for (const post of plan.crashed) {
    console.error(`  STUCK ${post.id} — claimed but never closed out. Reconcile in the Planner; do not re-send.`)
    failures += 1
  }

  for (const post of plan.toSchedule) {
    console.log(`  SEND ${post.id} (${post.strategy})  ${when(post)}`)
    write(record(post.id, 'claimed', { strategy: post.strategy, mediaSha256: post.media?.sha256 ?? null }))
    try {
      if (!args.dryRun && !args.skipMediaCheck && post.media) {
        await verifyMedia(`${manifest.mediaBase}/${post.media.file}`, post.media.sha256)
      }
      const { remoteId } = await scheduleOne({ post, manifest, http, pageId })
      console.log(`    ok — ${remoteId}`)
      write(record(post.id, 'scheduled', { remoteId, scheduledFor: post.publishAt }))
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
