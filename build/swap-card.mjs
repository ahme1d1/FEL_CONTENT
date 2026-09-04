#!/usr/bin/env node
/**
 * Swap the FPL overlays in a viral TikTok for ours.
 *
 *   node build/swap-card.mjs --video <url> --player 462 --captain \
 *     --card 75,331,207,268 --panel 264,845,260,218
 *
 *   node build/swap-card.mjs --video <url> --probe      # download and find the boxes
 *
 * This is the format the owner asked for: same clip, same audio, same timing, only the game UI
 * changes. The joke and the reach live in the borrowed footage, which we cannot manufacture; the
 * only part that has to be ours is what sits on top. See `fel-meme-is-overlay-swap`.
 *
 * Everything about the player is READ LIVE from the API — club, shirt, photo, and the real
 * per-gameweek goals, assists and points. Do not mirror the source video's numbers; a captained
 * score is that gameweek's points doubled, and if that is 24 rather than 46, it is 24.
 *
 * `--player` may be repeated. Each one opens a pick that the flags after it describe, so a video
 * carrying six cards is six `--player … --card …` groups in one pass. The grammar and the filter
 * graph live in swap-plan.mjs, which is where their tests are.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { shortName } from './author/names.mjs'
import { overlayFilters, overlayJobs, parseArgs } from './swap-plan.mjs'

const API = process.env.FEL_API_BASE ?? 'https://api.fantasyeg.com/api/v1'
const VIDEO_DIR = process.env.FEL_VIDEO_DIR ?? resolve(process.cwd(), '../FEL_VIDEO')

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...opts }).toString()

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) {
    throw new Error(`GET ${url} failed: ${body?.error ?? res.status}`)
  }
  return body?.data ?? body
}

/**
 * Download the source.
 *
 * NOT via yt-dlp: its TikTok extractor is broken (it fails on "universal data for rehydration",
 * and browser cookies return 403). tikwm's public endpoint hands back a direct CDN URL.
 */
async function download(url, into) {
  const meta = await getJson(`https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`)
  const play = meta?.hdplay || meta?.play
  if (!play) throw new Error(`No playable URL came back for ${url}.`)

  const res = await fetch(play, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`Downloading the video failed: HTTP ${res.status}`)
  writeFileSync(into, Buffer.from(await res.arrayBuffer()))
  return { file: into, title: meta?.title ?? null, author: meta?.author?.unique_id ?? null }
}

/** Every fact on the overlays, read live. */
async function loadPlayer(id, gameweek, captain) {
  const player = await getJson(`${API}/players/${id}`)
  const { history = [] } = await getJson(`${API}/players/${id}/history`)

  const week = gameweek ? history.find((h) => h.gw === gameweek) : history.at(-1)
  if (!week) {
    throw new Error(
      `Player ${id} has no gameweek ${gameweek ?? '(latest)'} in his history. ` +
        `Available: ${history.map((h) => h.gw).join(', ') || 'none'}.`,
    )
  }

  // A captained score is the gameweek's points doubled. Truthful, not matched to the source video.
  const points = captain ? week.points * 2 : week.points

  return {
    id,
    fullName: player.name,
    cardName: shortName(player.name),
    club: player.club,
    gw: week.gw,
    points,
    goals: week.goals ?? 0,
    assists: week.assists ?? 0,
    captain,
  }
}

async function fetchPhoto(id) {
  const dir = join(VIDEO_DIR, 'public/players')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.jpg`)
  const res = await fetch(`${API}/assets/players/${id}.jpg`)
  if (!res.ok) return null
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return `players/${id}.jpg`
}

/**
 * Compositions that assemble over time, and the frame to grab them at.
 *
 * `LogoTile` draws its mark in over ~38 frames, so a still taken at 0 catches half a logo.
 * Everything else is static and renders correctly at frame 0.
 */
const STILL_FRAME = { LogoTile: 50 }

function renderStill(composition, props, out) {
  const propsPath = join(mkdtempSync(join(tmpdir(), 'fel-props-')), 'p.json')
  writeFileSync(propsPath, JSON.stringify(props))
  const frame = STILL_FRAME[composition]
  run('npx', ['remotion', 'still', 'src/index.ts', composition, out, '--image-format=png',
    `--props=${propsPath}`, ...(frame ? [`--frame=${frame}`] : []), '--log=error'], { cwd: VIDEO_DIR })
}

/**
 * Find the green card in a frame.
 *
 * The card's green is saturated and nothing else in a kitchen or a living room usually is, so a
 * per-channel test finds it reliably. The stat panel is NOT auto-detected: it is near-black, and
 * so are the shadows in most footage. Neither is a green SCREEN, which this reports as one card
 * the width of the frame — read that as "measure it by hand", not as a box.
 */
function probeCard(video, work) {
  const raw = join(work, 'frame.raw')
  const dims = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', video]).trim()
  const [W, H] = dims.split('x').map(Number)

  run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', 'select=eq(n\\,60)', '-frames:v', '1',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw])

  const buf = readFileSync(raw)
  const at = (x, y) => {
    const i = (y * W + x) * 3
    return [buf[i], buf[i + 1], buf[i + 2]]
  }
  const isGreen = ([r, g, b]) => g > 90 && g - r > 45 && g - b > 35

  const cols = new Map()
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (isGreen(at(x, y))) cols.set(x, (cols.get(x) ?? 0) + 1)
    }
  }
  const hot = [...cols.entries()].filter(([, n]) => n > 12).map(([x]) => x)
  if (!hot.length) return { W, H, box: null }

  const x0 = Math.min(...hot)
  const x1 = Math.max(...hot)
  const ys = []
  for (let y = 0; y < H; y += 2) {
    let n = 0
    for (let x = x0; x <= x1; x += 2) if (isGreen(at(x, y))) n += 1
    if (n > (x1 - x0) / 6) ys.push(y)
  }
  if (!ys.length) return { W, H, box: null }

  return { W, H, box: { x: x0, y: Math.min(...ys), w: x1 - x0, h: Math.max(...ys) - Math.min(...ys) } }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(join(VIDEO_DIR, 'src/index.ts'))) {
    throw new Error(`Cannot find FEL_VIDEO at ${VIDEO_DIR}. Set FEL_VIDEO_DIR.`)
  }

  const work = mkdtempSync(join(tmpdir(), 'fel-swap-'))
  try {
    let source = args.file
    if (!source) {
      source = join(work, 'source.mp4')
      const meta = await download(args.video, source)
      console.log(`downloaded  @${meta.author ?? '?'}  ${(meta.title ?? '').slice(0, 70)}`)
    }

    if (args.probe) {
      const { W, H, box } = probeCard(source, work)
      console.log(`video ${W}x${H}`)
      if (box) {
        console.log(`  --card ${box.x},${box.y},${box.w},${box.h}`)
        console.log('  (the dark stat panel is not auto-detected — read it off a frame)')
      } else {
        console.log('  no green card found; measure it by hand')
      }
      return
    }

    // Resolved in order, so the log reads like the picks were written.
    for (const pick of args.picks) {
      pick.resolved = await loadPlayer(pick.player, pick.gameweek, pick.captain)
      pick.photo = pick.panel && !args.noPanel ? await fetchPhoto(pick.player) : null
      const p = pick.resolved
      console.log(
        `${p.fullName} (${p.club}) GW${p.gw}: ${p.goals}g ${p.assists}a -> ` +
          `${p.points}${pick.captain ? ' captained' : ''}`,
      )
    }
    if (args.brand.points) console.log(`points panel: ${args.brand.eyebrow ?? ''} ${args.brand.total}`.trim())
    if (args.brand.logo) console.log('logo tile: our mark')
    if (args.brand.text) console.log(`caption: «${args.brand.line}»`)

    const jobs = overlayJobs(args)
    if (args.dryRun) {
      jobs.forEach((j) => console.log(`  ${j.composition.padEnd(12)} ${Object.values(j.box).join(',')}`))
      return
    }

    // Each overlay is a still rendered at N x its box, then scaled into place.
    const inputs = ['-i', source]
    jobs.forEach((job, i) => {
      const png = join(work, `ov-${i}.png`)
      renderStill(job.composition, job.props, png)
      inputs.push('-i', png)
    })
    const { filters, last } = overlayFilters(jobs)

    const first = args.picks[0]?.resolved
    const out = resolve(args.out ?? (first ? `swap-${first.id}-gw${first.gw}.mp4` : 'swap.mp4'))
    run('ffmpeg', ['-v', 'error', '-y', ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', last, '-map', '0:a?', '-c:a', 'copy',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', out])

    const dur = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim()
    console.log(`\n  ${out}  ${Number(dur).toFixed(1)}s`)
    console.log(`\nTo send it to the TikTok drafts inbox:`)
    console.log(`  node publish/tiktok-draft.mjs --file ${out}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
