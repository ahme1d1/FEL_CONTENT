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
import { DROPPED, planUnschedule, UNSCHEDULED } from './unschedule-plan.mjs'
import {
  epochSeconds,
  scheduleFacebookPhoto,
  scheduleFacebookText,
  scheduleFacebookVideo,
} from './platforms/fb-schedule.mjs'

const GRAPH = 'https://graph.facebook.com/v21.0'

function parseArgs(argv) {
  const args = { dryRun: false, ledger: 'publish/ledger.jsonl', now: null, manifest: null, skipMediaCheck: false, unschedule: [], drop: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--unschedule') args.unschedule = value().split(',').map((x) => x.trim()).filter(Boolean)
    else if (flag === '--drop') args.drop = value().split(',').map((x) => x.trim()).filter(Boolean)
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
    // Not every Graph call carries a message — a delete carries only `method`.
    const shown = form?.message ? { ...form, message: `${form.message.slice(0, 40)}…` } : { ...form }
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
  // Pull named posts back out of Meta's queue BEFORE planning, so the same run re-schedules them
  // with whatever the card says now. Deleting and re-sending is the only way to replace a scheduled
  // photo post: Meta bound the image at creation, and there is no edit for it.
  // A dry run writes nothing, so entries it *would* write are carried forward in memory. Without
  // this the plan below re-reads the file, still sees `scheduled`, and prints HELD for a post the
  // same run just reported dropping — which is the opposite of what a real run does.
  // ONE read, shared by both passes. `readToken` drains stdin, so a second call returns nothing:
  // an unschedule run deleted two posts at Facebook and then died before re-sending them, because
  // the scheduling pass below asked for the token again and got an empty string. Stranding a post
  // that way — gone from the queue, never re-sent — is the exact failure this file exists to avoid.
  const token = args.dryRun ? '' : readToken()
  if (!args.dryRun && !token) throw new Error('No Page access token on stdin.')

  const pendingLedger = []
  // Two ways to pull a post. `--unschedule` releases it so this same run re-sends the new render;
  // `--drop` retires it, and the terminal state is the only thing between "deleted" and "deleted
  // and then immediately re-sent by the next pass".
  const pulls = [
    ...args.unschedule.map((id) => ({ id, state: UNSCHEDULED, verb: 'released' })),
    ...args.drop.map((id) => ({ id, state: DROPPED, verb: 'retired' })),
  ]
  if (pulls.length) {
    const dropLog = []
    const http = args.dryRun ? dryRunHttp(dropLog) : graphHttp(token)
    const pulled = planUnschedule({ manifest, ledger: readLedger(args.ledger), ids: pulls.map((x) => x.id) })
    const stateFor = new Map(pulls.map((x) => [x.id, x]))

    for (const id of pulled.unknown) {
      throw new Error(`"${id}" is not a post in ${args.manifest}; refusing to guess which one you meant.`)
    }
    for (const id of pulled.notScheduled) {
      console.log(`  KEPT ${id} — Facebook is not holding it; nothing to pull back`)
    }
    for (const { id, remoteId } of pulled.toDelete) {
      console.log(`  DROP ${id} (${remoteId})`)
      // Graph takes a delete as POST ?method=delete, which the existing transport already speaks.
      await http({ method: 'POST', path: `/${remoteId}`, form: { method: 'delete' } })
      const { state, verb } = stateFor.get(id)
      const entry = record(id, state, { remoteId })
      if (args.dryRun) {
        console.log(`    LEDGER ${JSON.stringify(entry)}`)
        pendingLedger.push(entry)
      } else appendLedger(args.ledger, entry)
      for (const line of dropLog.splice(0)) console.log(line)
      console.log(`    ok — Facebook ${verb} it`)
    }
  }

  const ledger = [...readLedger(args.ledger), ...pendingLedger]
  const plan = selectSchedulable({ manifest, ledger, now })

  console.log(`${args.dryRun ? 'DRY RUN' : 'SCHEDULE'} at ${now.toISOString()} — gameweek ${manifest.gameweek}`)
  console.log(
    `  to schedule ${plan.toSchedule.length} · already ${plan.alreadyScheduled.length} · ` +
      `no caption ${plan.needsCaption.length} · out of window ${plan.tooSoon.length + plan.tooFar.length} · ` +
      `needs reconciliation ${plan.crashed.length}`,
  )

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
