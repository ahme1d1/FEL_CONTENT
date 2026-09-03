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
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { shortName } from './author/names.mjs'

const API = process.env.FEL_API_BASE ?? 'https://api.fantasyeg.com/api/v1'
const VIDEO_DIR = process.env.FEL_VIDEO_DIR ?? resolve(process.cwd(), '../FEL_VIDEO')

/** The boxes are padded outward so no edge of the overlay being replaced survives. */
const COVER_PAD = 3

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...opts }).toString()

function parseArgs(argv) {
  const args = { captain: false, probe: false, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--captain') args.captain = true
    else if (flag === '--probe') args.probe = true
    else if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--no-panel') args.noPanel = true
    else if (flag === '--video') args.video = value()
    else if (flag === '--file') args.file = value()
    else if (flag === '--player') args.player = Number(value())
    else if (flag === '--gameweek') args.gameweek = Number(value())
    else if (flag === '--card') args.card = box(value(), '--card')
    else if (flag === '--panel') args.panel = box(value(), '--panel')
    else if (flag === '--points') args.points = box(value(), '--points')
    else if (flag === '--logo') args.logo = box(value(), '--logo')
    else if (flag === '--total') args.total = value()
    else if (flag === '--text') args.text = box(value(), '--text')
    else if (flag === '--line') args.line = value()
    else if (flag === '--bar') args.bar = value()
    else if (flag === '--eyebrow') args.eyebrow = value()
    else if (flag === '--out') args.out = value()
    else throw new Error(`Unexpected argument "${argv[i]}".`)
  }
  if (!args.video && !args.file) throw new Error(usage())
  const wantsPlayer = Boolean(args.card || args.panel)
  if (!args.probe && wantsPlayer && !args.player) {
    throw new Error('--card / --panel describe a player, so --player <id> is required.')
  }
  if (!args.probe && !args.card && !args.points && !args.logo && !args.text) {
    throw new Error('Nothing to replace. Give at least one of --card, --points, --logo or --text.')
  }
  if (!args.probe && args.text && !args.line) {
    throw new Error('--text needs --line "<the new words>".')
  }
  if (!args.probe && args.points && !args.total) {
    throw new Error('--points needs --total <n>, the number to show.')
  }
  return args
}

const usage = () =>
  'usage: swap-card.mjs (--video <url> | --file <path>) [overlays...] [--out f.mp4]\n' +
  '\n' +
  '  player overlays  --player <id> [--gameweek N] [--captain]\n' +
  '                   --card x,y,w,h        the big player card\n' +
  '                   --panel x,y,w,h       the dark match stat panel\n' +
  '\n' +
  '  brand overlays   --points x,y,w,h --total 30 [--eyebrow "الجولة 3"]\n' +
  '                   --logo x,y,w,h        our mark over the competition badge\n' +
  '                   --text x,y,w,h --line "…"   repaint a caption baked into the footage\n' +
  '                                          (--bar #000000 if the bar is not black)\n' +
  '\n' +
  '  swap-card.mjs --video <url> --probe    find the card box and the dimensions'

function box(raw, flag) {
  const parts = String(raw).split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`${flag} must be x,y,w,h — got "${raw}".`)
  }
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
}

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
 * so are the shadows in most footage.
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

    // Only needed when a player overlay was asked for; a points/logo swap names nobody.
    let player = null
    let photo = null
    if (args.player) {
      player = await loadPlayer(args.player, args.gameweek, args.captain)
      photo = args.panel ? await fetchPhoto(player.id) : null
      console.log(
        `${player.fullName} (${player.club}) GW${player.gw}: ` +
          `${player.goals}g ${player.assists}a -> ${player.points}${args.captain ? ' captained' : ''}`,
      )
    }
    if (args.points) console.log(`points panel: ${args.eyebrow ?? ''} ${args.total}`.trim())
    if (args.logo) console.log('logo tile: our mark')
    if (args.text) console.log(`caption: «${args.line}»`)
    if (args.dryRun) return

    // Each overlay is a still rendered at N x its box, then scaled into place. The box is padded
    // outward so no edge of the thing being replaced survives.
    const jobs = []
    if (args.card) {
      jobs.push({
        box: args.card,
        composition: 'CardOnly',
        props: {
          name: player.cardName,
          club: player.club,
          value: String(player.points),
          badge: args.captain ? 'C' : null,
          star: true,
        },
      })
    }
    if (args.panel && !args.noPanel) {
      jobs.push({
        box: args.panel,
        composition: 'PanelOnly',
        props: {
          name: player.fullName,
          photo,
          points: String(player.points),
          goals: player.goals,
          assists: player.assists,
          captain: args.captain,
        },
      })
    }
    if (args.points) {
      jobs.push({
        box: args.points,
        composition: 'PointsPanel',
        props: {
          eyebrow: args.eyebrow ?? `الجولة ${player?.gw ?? ''}`.trim(),
          points: String(args.total),
        },
      })
    }
    if (args.logo) jobs.push({ box: args.logo, composition: 'LogoTile', props: {} })
    if (args.text) {
      // Painted LAST so it sits over anything else that shares the bar.
      jobs.push({
        box: args.text,
        composition: 'TextLine',
        props: { text: args.line, ...(args.bar ? { background: args.bar } : {}) },
        // The bar is a solid fill we reproduce exactly, so padding it outward would only eat
        // into the picture below. This one job covers precisely its box.
        pad: 0,
      })
    }

    const inputs = ['-i', source]
    const filters = []
    let last = '[0:v]'
    jobs.forEach((job, i) => {
      const png = join(work, `ov-${i}.png`)
      renderStill(job.composition, job.props, png)
      inputs.push('-i', png)
      const b = job.box
      const pad = job.pad ?? COVER_PAD
      filters.push(`[${i + 1}:v]scale=${b.w + pad * 2}:${b.h + pad * 2}[o${i}]`)
      filters.push(`${last}[o${i}]overlay=${b.x - pad}:${b.y - pad}[v${i}]`)
      last = `[v${i}]`
    })

    const out = resolve(args.out ?? (player ? `swap-${player.id}-gw${player.gw}.mp4` : 'swap.mp4'))
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
