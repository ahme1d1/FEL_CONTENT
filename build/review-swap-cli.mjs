#!/usr/bin/env node
/**
 * Build the round-review reel: our players, their cut timings, their audio.
 *
 *   node build/review-swap-cli.mjs --out gw04/review.mp4
 *   node build/review-swap-cli.mjs --vertical --out gw04/review-tall.mp4
 *   node build/review-swap-cli.mjs --file source.mp4 --cards-only   # just the 28 stills
 *   node build/review-swap-cli.mjs --verify                         # re-check the casting
 *
 * The source is a 28-card GW3 review from "Fantasy PL Players". Unlike swap-card.mjs, this keeps
 * NO picture from it: the owner's rule is that no Premier League mark may sit behind our players,
 * and that footage carries three — their shield, their PL-coloured backdrop, and a sleeve badge
 * on every kit. The cards tile the whole runtime, so redrawing every frame is what removes all
 * three, and it is also the only way our 192x200 headshots avoid a 4x upscale into the hole
 * their cut-out leaves. What is kept is the audio and the 28 cut points.
 *
 * Everything about a player is READ LIVE and asserted against the cast before anything renders.
 * The pairing is the whole trick — their voiceover is still describing FPL GW3 returns, so a card
 * must not drift onto a player who did something else.
 *
 * yt-dlp handles Facebook reels fine (its TikTok extractor is the broken one, which is why
 * swap-card.mjs goes through tikwm instead).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CAST, GAMEWEEK, ROUND_LABEL, SOURCE } from './review-cast.mjs'
import { cardTimings, encodeArgs, frameCards, frameName, pairingDrift, stillJobs, stillName } from './review-swap.mjs'

const API = process.env.FEL_API_BASE ?? 'https://api.fantasyeg.com/api/v1'
const FPL = process.env.FPL_API_BASE ?? 'https://fantasy.premierleague.com/api'
const VIDEO_DIR = process.env.FEL_VIDEO_DIR ?? resolve(process.cwd(), '../FEL_VIDEO')

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...opts }).toString()

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers } })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) throw new Error(`GET ${url} failed: ${body?.error ?? res.status}`)
  return body?.data ?? body
}

function parseArgs(argv) {
  const args = { verify: false, cardsOnly: false, keepWork: false, vertical: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--file') args.file = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--verify') args.verify = true
    else if (a === '--cards-only') args.cardsOnly = true
    // `fb-video` and `ig-reel` only accept ASPECT.vertical, so this is the cut that ships.
    // The cards are re-laid out for 9:16, never cropped — a 2:1 crop loses the portrait or the name.
    else if (a === '--vertical') args.vertical = true
    else if (a === '--keep-work') args.keepWork = true
    else throw new Error(`Unknown flag ${a}.`)
  }
  return args
}

/** Pull the source with yt-dlp. `hd` is the 2172x1080 rendition the cards are drawn against. */
function download(work) {
  const out = join(work, 'source.mp4')
  run('yt-dlp', ['-f', 'hd', '--no-warnings', '--socket-timeout', '30', '-o', out, SOURCE.url])
  return out
}

async function fetchPhotos() {
  const dir = join(VIDEO_DIR, 'public/players')
  mkdirSync(dir, { recursive: true })
  const missing = []
  for (const card of CAST) {
    const file = join(dir, `${card.player.id}.jpg`)
    if (existsSync(file)) continue
    const res = await fetch(`${API}/assets/players/${card.player.id}.jpg`)
    if (!res.ok) { missing.push(card.player.id); continue }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  if (missing.length) throw new Error(`No photo for player ${missing.join(', ')}. A card cannot render without one.`)
}

/**
 * Re-read both leagues and confirm every card still sits against the return its voice describes.
 *
 * Both sides move: FEL settles and re-settles, and FPL's live endpoint can be corrected after the
 * fact. Trusting review-cast.mjs would let a silent change put a hauler under a roast.
 */
async function verify() {
  const ours = new Map((await getJson(`${API}/gameweeks/${GAMEWEEK}/player-points`)).map((r) => [r.playerId, r.points]))
  const boot = await getJson(`${FPL}/bootstrap-static/`, { 'user-agent': 'Mozilla/5.0' })
  const live = await getJson(`${FPL}/event/3/live/`, { 'user-agent': 'Mozilla/5.0' })
  const theirs = new Map(live.elements.map((e) => [e.id, e.stats.total_points]))
  // By id, never by name: two different Palmers play in the Premier League and a name lookup
  // silently took the wrong one, which read as the cast having drifted when it had not.
  const known = new Set(boot.elements.map((e) => e.id))

  const problems = []
  for (const card of CAST) {
    // The endpoint only lists players with a record for the round. No row means he never came
    // on, which is 0 points, not missing data — and 0 is what his card shows.
    const now = ours.get(card.player.id) ?? 0
    const was = Number(card.player.points)
    if (now !== was) problems.push(`card ${card.n}: ${card.player.name} is ${now} now, cast says ${was}`)

    if (!known.has(card.source.fplId)) {
      problems.push(`card ${card.n}: FPL has no element ${card.source.fplId} (${card.source.card})`)
    }
    const t = theirs.get(card.source.fplId)
    if (t !== undefined && t !== card.source.points) {
      problems.push(`card ${card.n}: ${card.source.card} is ${t} in FPL now, cast says ${card.source.points}`)
    }
  }
  const drift = pairingDrift(CAST)
  for (const d of drift) {
    problems.push(`card ${d.card}: ${d.player} (${d.ours}) is ${d.gap} off ${d.source} (${d.their})`)
  }
  return problems
}

/** One browser boot for all 28: render the set as a frame-per-card sequence, then name them. */
function renderCards(cards, outDir, vertical) {
  const propsPath = join(mkdtempSync(join(tmpdir(), 'fel-review-')), 'p.json')
  writeFileSync(propsPath, JSON.stringify({ cards, layout: vertical ? 'tall' : 'wide' }))
  mkdirSync(outDir, { recursive: true })
  run('npx', ['remotion', 'render', 'src/index.ts', vertical ? 'ReviewCardsTall' : 'ReviewCards', outDir,
    '--sequence', '--image-format=png', `--props=${propsPath}`, '--log=error'], { cwd: VIDEO_DIR })

  // Remotion writes element-<frame>.png. Rename to the playing order so the concat list reads.
  const written = readdirSync(outDir).filter((f) => f.startsWith('element-') && f.endsWith('.png'))
  if (written.length !== cards.length) {
    throw new Error(`Expected ${cards.length} stills, got ${written.length}.`)
  }
  for (const f of written) {
    const frame = Number(f.slice('element-'.length, -'.png'.length))
    renameSync(join(outDir, f), join(outDir, stillName(frame + 1)))
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.verify) {
    const problems = await verify()
    if (problems.length) { problems.forEach((p) => console.error(`  ${p}`)); process.exit(1) }
    console.log(`All ${CAST.length} cards still match the return their voice describes.`)
    return
  }

  const work = mkdtempSync(join(tmpdir(), 'fel-review-work-'))
  try {
    console.log(`${CAST.length} cards · ${ROUND_LABEL} · ${args.vertical ? '1080x1920 vertical' : `${SOURCE.master.width}x${SOURCE.master.height} wide`}`)

    const source = args.file ? resolve(args.file) : download(work)

    // The picture is entirely ours, so the source is opened for its audio and its length alone.
    // Facebook serves the high-resolution renditions as VIDEO-ONLY streams with the audio split
    // out, and handing one of those to the encode fails late with "Stream map '' matches no
    // streams". Catch it here, where the message can say what to do about it.
    const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', source])
    if (!streams.split('\n').includes('audio')) {
      throw new Error(`${source} has no audio track — that file is the whole point of the source. ` +
        'Facebook splits audio off its top renditions; download with `-f hd`, which is progressive.')
    }
    const duration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source]).trim())
    const timings = cardTimings(CAST, { duration, fps: SOURCE.fps })

    await fetchPhotos()
    const jobs = stillJobs(CAST)
    const cardsDir = args.cardsOnly ? resolve('review-cards') : join(work, 'cards')
    renderCards(jobs.map((j) => j.props), cardsDir, args.vertical)
    console.log(`  ${jobs.length} cards rendered into ${cardsDir}`)
    if (args.cardsOnly) return

    // A hard link per output frame. They cost an inode and no bytes, and they give ffmpeg a
    // plain numbered sequence, which is the only way the cuts landed on the source's own.
    const framesDir = join(work, 'frames')
    mkdirSync(framesDir, { recursive: true })
    const frames = frameCards(timings)
    frames.forEach((n, i) => linkSync(join(cardsDir, stillName(n)), join(framesDir, frameName(i))))
    console.log(`  ${frames.length} frames linked (${(frames.length / SOURCE.fps).toFixed(2)}s)`)

    const out = resolve(args.out ?? `review-gw${String(GAMEWEEK).padStart(2, '0')}.mp4`)
    run('ffmpeg', encodeArgs({
      framesPattern: join(framesDir, 'f%05d.png'), sourcePath: source, out, fps: SOURCE.fps,
    }))

    const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate', '-show_entries', 'format=duration',
      '-of', 'default=nw=1', out]).trim().split('\n').join('  ')
    console.log(`\n  ${out}\n  ${probe}`)
    console.log(`\nTo send it to the TikTok drafts inbox:\n  node publish/tiktok-draft.mjs --file ${out}`)
  } finally {
    if (!args.keepWork) rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => { console.error(err.message); process.exit(2) })
