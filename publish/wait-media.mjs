#!/usr/bin/env node
/**
 * Blocks until every image in a manifest is actually being served.
 *
 *   node publish/wait-media.mjs --manifest manifests/gw04.json --timeout 600
 *
 * This exists because of the order Facebook forces. `schedule-facebook.mjs` hands Meta a URL, not
 * bytes — `platforms/fb-schedule.mjs` sends `url: mediaUrl` — so Meta fetches the card from
 * media.fantasyeg.com itself. A commit is not a deploy: GitHub Pages takes the better part of a
 * minute to publish, and scheduling in that window asks Meta to fetch a 404.
 *
 * It verifies the sha256 rather than just a 200, which also catches the subtler failure: Pages
 * serving the *previous* build. Media is content-addressed, so a stale deploy answers with the old
 * bytes under a URL that has never existed, or with the wrong bytes under one that has.
 *
 * Exits 0 when everything verifies, 1 on timeout — never publishes anything itself.
 */

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { verifyMedia } from './media.mjs'

const DEFAULT_TIMEOUT_SECONDS = 600
const POLL_SECONDS = 10

function parseArgs(argv) {
  const args = { manifest: null, timeout: DEFAULT_TIMEOUT_SECONDS }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--manifest') args.manifest = value()
    else if (flag === '--timeout') args.timeout = Number(value())
    else throw new Error(`Unknown argument "${argv[i]}".`)
  }
  if (!args.manifest) throw new Error('--manifest <path> is required.')
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout must be seconds.')
  return args
}

/** One entry per distinct file: the same card fans out to Facebook, Instagram and TikTok. */
function mediaUrls(manifest) {
  const seen = new Map()
  for (const post of manifest.posts) {
    if (!post.media?.file) continue
    seen.set(post.media.file, `${manifest.mediaBase}/${post.media.file}`)
  }
  return [...seen.entries()].map(([file, url]) => ({ file, url }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const shaByFile = new Map(
    manifest.posts.filter((p) => p.media?.file).map((p) => [p.media.file, p.media.sha256]),
  )

  const targets = mediaUrls(manifest)
  if (!targets.length) {
    console.log(`${args.manifest}: no media to wait for.`)
    return
  }

  const deadline = Date.now() + args.timeout * 1000
  const pending = new Map(targets.map((t) => [t.file, t.url]))
  console.log(`Waiting for ${pending.size} file(s) from ${manifest.mediaBase}`)

  let lastError = 'never attempted'
  while (pending.size) {
    for (const [file, url] of [...pending]) {
      try {
        await verifyMedia(url, shaByFile.get(file))
        pending.delete(file)
        console.log(`  serving ${file}`)
      } catch (err) {
        lastError = err.message
      }
    }
    if (!pending.size) break

    if (Date.now() >= deadline) {
      console.error(`\n${pending.size} file(s) never appeared within ${args.timeout}s:`)
      for (const file of pending.keys()) console.error(`  ${file}`)
      console.error(`last error: ${lastError}`)
      process.exit(1)
    }
    await sleep(POLL_SECONDS * 1000)
  }

  console.log('All media verified against the manifest.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
