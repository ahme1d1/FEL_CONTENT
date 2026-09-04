#!/usr/bin/env node
/**
 * The alarm. Reads every manifest and the ledger, and says whether anything owed has not gone out.
 *
 * Publishes nothing, needs no credential, writes no ledger record. It is safe to run at any time
 * and from anywhere, which is the point: it has to be able to run when the publisher cannot.
 *
 *   node publish/watchdog.mjs
 *   node publish/watchdog.mjs --now 2026-09-04T13:00:00Z --grace 30
 *   node publish/watchdog.mjs --manifest manifests/gw03.json --format markdown
 *
 * Exit 0 when nothing is owed, 1 when something is. The workflow turns that 1 into an issue.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readLedger } from './ledger.mjs'
import { assess, BACKLOG_GRACE_MINUTES } from './watchdog-plan.mjs'

function parseArgs(argv) {
  const args = {
    dir: 'manifests',
    ledger: 'publish/ledger.jsonl',
    now: null,
    grace: BACKLOG_GRACE_MINUTES,
    manifests: [],
    format: 'text',
    out: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--manifest') args.manifests.push(value())
    else if (flag === '--dir') args.dir = value()
    else if (flag === '--ledger') args.ledger = value()
    else if (flag === '--now') args.now = value()
    else if (flag === '--grace') args.grace = Number(value())
    else if (flag === '--format') args.format = value()
    else if (flag === '--out') args.out = value()
    else throw new Error(`Unknown argument "${argv[i]}".`)
  }
  if (!Number.isFinite(args.grace) || args.grace < 0) {
    throw new Error('--grace must be a non-negative number of minutes.')
  }
  if (args.format !== 'text' && args.format !== 'markdown') {
    throw new Error('--format must be text or markdown.')
  }
  return args
}

/**
 * Deliberately NOT validateManifest'd. A manifest too malformed to parse is its own emergency,
 * but a schema quibble — a missing sha, an aspect-ratio warning — must not stop the watchdog
 * looking at the other nine. The alarm has to be the most robust thing in the repo.
 */
function loadManifests(args) {
  const paths = args.manifests.length
    ? args.manifests
    : readdirSync(args.dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(args.dir, f))

  const loaded = []
  const unreadable = []
  for (const path of paths) {
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(manifest?.posts)) loaded.push(manifest)
      else unreadable.push(`${path}: no posts array`)
    } catch (err) {
      unreadable.push(`${path}: ${err.message}`)
    }
  }
  return { loaded, unreadable, paths }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const now = args.now ? new Date(args.now) : new Date()
  if (Number.isNaN(now.getTime())) throw new Error(`--now is not a date: ${args.now}`)

  const { loaded, unreadable, paths } = loadManifests(args)
  const ledger = readLedger(args.ledger)
  const result = assess({ manifests: loaded, ledger, now, maxBacklogMinutes: args.grace })

  // A manifest that cannot be read is an alarm in its own right: it is a week nobody is checking.
  const failed = unreadable.length > 0 || (paths.length > 0 && loaded.length === 0)

  if (args.format === 'markdown') {
    const extra = unreadable.length ? `\n\n**Unreadable manifests:**\n${unreadable.map((u) => `- ${u}`).join('\n')}` : ''
    const body = `${result.summary}${extra}`
    if (args.out) writeFileSync(args.out, body)
    else console.log(body)
  } else {
    console.log(`WATCHDOG at ${now.toISOString()} — ${loaded.length} manifest(s), grace ${args.grace} min`)
    for (const u of unreadable) console.error(`  UNREADABLE ${u}`)
    for (const alarm of result.alarms) {
      console.error(`  ${alarm.kind.toUpperCase()} — ${alarm.headline}`)
      for (const p of alarm.posts) {
        console.error(`    ${p.id} (gw${p.gameweek}, ${p.strategy}) due ${p.publishAt}, ${p.lateMinutes} min late`)
      }
    }
    for (const p of result.heldForCaption) console.log(`  HOLD ${p.id} — no caption yet`)
    if (result.ok && !failed) console.log('  nothing owed.')
  }

  process.exit(result.ok && !failed ? 0 : 1)
}

try {
  main()
} catch (err) {
  console.error(`watchdog: ${err.message}`)
  process.exit(2)
}
