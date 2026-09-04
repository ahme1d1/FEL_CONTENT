#!/usr/bin/env node
/**
 * Manifest in, publish-ready media out.
 *
 *   node build/render-manifest.mjs manifests/gw03.json
 *   node build/render-manifest.mjs manifests/gw03.json --out gw03 --dry-run
 *
 * Three things happen here that matter:
 *
 * 1. Cards are rendered by FEL_WEBSITE's own render-cards.mjs rather than a copy,
 *    so the card tool and this pipeline can never drift apart.
 * 2. The 2x export is downscaled to 1080 wide HERE. Instagram's documented maximum
 *    is 1440 and it silently resamples anything larger, which is what softens Cairo
 *    at weight 900. Better our filter than theirs.
 * 3. Output is JPEG. Instagram accepts no other image format and TikTok rejects PNG,
 *    so a PNG in the manifest is a post that cannot publish.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateManifest } from './manifest-schema.mjs'
import { mediaName, planRenders, stampManifest } from './render-plan.mjs'

const WEBSITE = process.env.FEL_WEBSITE_DIR ?? resolve(process.cwd(), '../FEL_WEBSITE')
const RENDER_CARDS = join(WEBSITE, 'docs/marketing/build/render-cards.mjs')

/** Instagram downscales above this; we do it ourselves with a filter we control. */
const TARGET_WIDTH = 1080
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function parseArgs(argv) {
  const args = { manifest: null, out: null, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--out') args.out = value()
    else if (!args.manifest) args.manifest = argv[i]
    else throw new Error(`Unexpected argument "${argv[i]}".`)
  }
  if (!args.manifest) throw new Error('usage: render-manifest.mjs <manifest.json> [--out dir] [--dry-run]')
  return args
}

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()

function encodeJpeg(pngPath, jpgPath) {
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', pngPath,
    '-vf', `scale=${TARGET_WIDTH}:-2:flags=lanczos`,
    '-pix_fmt', 'yuvj420p',
    '-q:v', '2',
    jpgPath,
  ])
}

function dimensionsOf(file) {
  const out = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x', file,
  ]).trim()
  const [width, height] = out.split('x').map(Number)
  return { width, height }
}

const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const outDir = args.out ?? `gw${String(manifest.gameweek).padStart(2, '0')}`

  const plan = planRenders(manifest)
  console.log(`${plan.length} render job(s) for gameweek ${manifest.gameweek} -> ${outDir}/`)
  for (const g of plan) console.log(`  ${g.job.card}  ->  ${g.postIds.join(', ')}`)

  if (args.dryRun) return
  if (!plan.length) return

  if (!existsSync(RENDER_CARDS)) {
    throw new Error(`Cannot find ${RENDER_CARDS}. Set FEL_WEBSITE_DIR to the FEL_WEBSITE checkout.`)
  }

  const work = mkdtempSync(join(tmpdir(), 'fel-render-'))
  mkdirSync(outDir, { recursive: true })

  try {
    const jobsPath = join(work, 'jobs.json')

    // A photo hero reaches the card tool as `heroFile`, a path it reads and inlines — so a job that
    // names a `photoUrl` has to have those bytes on disk beside the jobs file before the tool runs.
    // A photo that will not download costs us the photo and nothing else: the job falls back to the
    // no-photo card, which carries the same texts, rather than failing the whole render.
    const jobs = []
    for (const group of plan) {
      const { photoUrl, ...job } = group.job
      if (photoUrl) {
        const file = `hero-${group.job.file}.jpg`
        try {
          const res = await fetch(photoUrl)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          writeFileSync(join(work, file), Buffer.from(await res.arrayBuffer()))
          job.heroFile = file
        } catch (err) {
          console.warn(`  ! ${photoUrl} did not download (${err.message}); rendering without the photo`)
          job.card = 'G_NO_PHOTO_FALLBACK'
        }
      }
      jobs.push(job)
      group.job = job
    }

    writeFileSync(jobsPath, JSON.stringify(jobs, null, 2))
    run('node', [RENDER_CARDS, jobsPath, work])

    const results = plan.map((group) => {
      const png = join(work, group.job.file)
      const jpg = join(work, `${group.job.file}.jpg`)
      encodeJpeg(png, jpg)

      const sha256 = sha256File(jpg)
      const bytes = statSync(jpg).size
      const { width, height } = dimensionsOf(jpg)

      if (bytes > MAX_IMAGE_BYTES) {
        throw new Error(`${group.job.card} encoded to ${bytes} bytes, over Instagram's 8 MB limit.`)
      }

      const file = mediaName(group, sha256)
      renameSync(jpg, join(outDir, file))
      console.log(`  wrote ${outDir}/${file}  ${width}x${height}  ${(bytes / 1024).toFixed(0)} KB`)

      return { postIds: group.postIds, file, sha256, bytes, width, height, mime: 'image/jpeg' }
    })

    const stamped = stampManifest(manifest, results)
    writeFileSync(args.manifest, `${JSON.stringify(stamped, null, 2)}\n`)
    console.log(`stamped ${results.length} result(s) into ${args.manifest}`)

    const findings = validateManifest(stamped)
    if (findings.length) {
      console.error('\nThe stamped manifest does not validate:')
      for (const f of findings) console.error(`  [${f.ruleId}] post ${f.post}: ${f.message}`)
      process.exit(1)
    }
    console.log('manifest validates')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// `main` is async since the photo hero has to be fetched, so a sync try/catch would let a render
// failure escape as an unhandled rejection and exit 0 — a green run that produced nothing.
main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
