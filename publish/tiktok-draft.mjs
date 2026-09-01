#!/usr/bin/env node
/**
 * Sends a video to the TikTok drafts inbox during the authoring pass.
 *
 *   node publish/tiktok-draft.mjs --manifest manifests/gw03.json
 *   node publish/tiktok-draft.mjs --manifest manifests/gw03.json --post gw03-d3-2000-tiktok
 *   node publish/tiktok-draft.mjs --file ../FEL_VIDEO/out/ad-full.mp4
 *
 * Not part of the cloud routine, and deliberately so: the TikTok token lives on
 * this machine and never leaves it, which is also why publish/route.mjs refuses
 * a tiktok strategy outright.
 *
 * The caption does not travel. TikTok's inbox endpoint takes the file and
 * nothing else, so it is printed at the end for you to paste into the editor.
 */

import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { validateManifest } from '../build/manifest-schema.mjs'
import { appendLedger, record } from './ledger.mjs'
import { publishTiktokDraft } from './platforms/tiktok.mjs'
import { accessTokenFor, readTokenFile } from './tiktok-auth.mjs'
import { apiHttp, getUserInfo, postForm, putChunk } from './tiktok-http.mjs'

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function parseArgs(argv) {
  const args = { manifest: null, post: null, file: null, mediaDir: null, ledger: 'publish/ledger.jsonl', dryRun: false, whoami: false }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--manifest') args.manifest = value()
    else if (flag === '--post') args.post = value()
    else if (flag === '--file') args.file = value()
    else if (flag === '--media-dir') args.mediaDir = value()
    else if (flag === '--ledger') args.ledger = value()
    else if (flag === '--whoami') args.whoami = true
    else throw new Error(`Unknown argument "${argv[i]}".`)
  }
  if (args.whoami) return args
  if (!args.manifest && !args.file) {
    throw new Error('usage: tiktok-draft.mjs (--manifest <path> [--post <id>] | --file <path>) [--media-dir <dir>] [--dry-run]')
  }
  return args
}

const mimeFor = (file) => MIME_BY_EXT[extname(file).toLowerCase()] ?? 'application/octet-stream'

/** The directory the manifest's media was rendered into, beside its public URL. */
const mediaDirFor = (manifest) => new URL(manifest.mediaBase).pathname.split('/').filter(Boolean).pop() ?? '.'

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Reads one chunk by offset so a 4 GB file never has to fit in memory. */
function chunkReader(fd) {
  return async ({ first, size }) => {
    const buf = Buffer.allocUnsafe(size)
    let filled = 0
    while (filled < size) {
      const n = readSync(fd, buf, filled, size - filled, first + filled)
      if (n === 0) break
      filled += n
    }
    return filled === size ? buf : buf.subarray(0, filled)
  }
}

/** @returns {Array<{id: string, file: string, caption: string|null, sha256: string|null}>} */
function selectJobs(args) {
  if (!args.manifest) {
    return [{ id: `file:${basename(args.file)}`, file: args.file, caption: null, sha256: null }]
  }

  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const invalid = validateManifest(manifest)
  if (invalid.length) {
    for (const f of invalid) console.error(`  [${f.ruleId}] post ${f.post}: ${f.message}`)
    throw new Error(`Manifest ${args.manifest} is invalid; refusing to upload.`)
  }

  const dir = args.mediaDir ?? mediaDirFor(manifest)
  const posts = manifest.posts
    .filter((p) => p.strategy?.startsWith('tiktok'))
    .filter((p) => !args.post || p.id === args.post)

  if (!posts.length) throw new Error(`No tiktok posts in ${args.manifest}${args.post ? ` matching "${args.post}"` : ''}.`)

  return posts.map((p) => ({
    id: p.id,
    file: args.file ?? join(dir, p.media.file),
    caption: p.caption ?? null,
    sha256: args.file ? null : p.media.sha256,
  }))
}

async function uploadOne({ job, args, http }) {
  const bytes = statSync(job.file).size
  const mime = mimeFor(job.file)
  console.log(`  ${job.id}\n    ${job.file}  ${(bytes / 1024 / 1024).toFixed(1)} MB  ${mime}`)

  if (job.sha256) {
    const actual = sha256File(job.file)
    if (actual !== job.sha256) {
      throw new Error(`${job.file} hashes to ${actual.slice(0, 12)}…, manifest says ${job.sha256.slice(0, 12)}….`)
    }
    console.log('    sha256 matches the manifest')
  } else if (args.file && args.manifest) {
    console.log('    sha256 NOT checked — --file overrides the manifest media')
  }

  if (args.dryRun) {
    console.log('    DRY RUN — nothing uploaded')
    return { remoteId: 'DRYRUN', status: 'DRY_RUN' }
  }

  const fd = openSync(job.file, 'r')
  try {
    return await publishTiktokDraft({ http, put: putChunk, readChunk: chunkReader(fd), videoSize: bytes, mime })
  } finally {
    closeSync(fd)
  }
}

/** Which account the drafts will land in. Worth checking before, not after. */
async function whoami() {
  const token = readTokenFile()
  if (!token) throw new Error('No TikTok token. Authorize with: node publish/tiktok-auth-cli.mjs')
  const user = await getUserInfo(token.accessToken)
  console.log(`  account        ${user.display_name ?? '(none)'}`)
  console.log(`  open_id        ${token.openId}`)
  console.log(`  scopes         ${token.scope}`)
  console.log(`  token expires  ${token.expiresAt}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.whoami) return whoami()

  const jobs = selectJobs(args)

  console.log(`${args.dryRun ? 'DRY RUN' : 'TIKTOK DRAFTS'} — ${jobs.length} file(s)`)

  let http = null
  if (!args.dryRun) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET
    const missing = [!clientKey && 'TIKTOK_CLIENT_KEY', !clientSecret && 'TIKTOK_CLIENT_SECRET'].filter(Boolean)
    if (missing.length) throw new Error(`Missing required environment: ${missing.join(', ')}.`)
    http = apiHttp(await accessTokenFor({ postForm, clientKey, clientSecret }))
  }

  let failures = 0
  const captions = []

  for (const job of jobs) {
    try {
      const { remoteId, status } = await uploadOne({ job, args, http })
      console.log(`    ok — ${status} (publish_id ${remoteId})`)
      if (args.manifest && !args.dryRun) {
        appendLedger(args.ledger, record(job.id, 'drafted', { remoteId, status }))
      }
      if (job.caption) captions.push([job.id, job.caption])
    } catch (err) {
      console.error(`    failed — ${err.message}`)
      if (args.manifest && !args.dryRun) appendLedger(args.ledger, record(job.id, 'failed', { error: err.message }))
      failures += 1
    }
  }

  if (captions.length) {
    console.log('\nThe inbox endpoint carries no caption. Paste these in the TikTok editor:\n')
    for (const [id, caption] of captions) console.log(`  ${id}\n  ${caption}\n`)
  }
  if (!args.dryRun && failures < jobs.length) {
    console.log('Open TikTok on your phone — the drafts arrive as an inbox notification.')
  }

  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
