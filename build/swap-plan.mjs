/**
 * Turning a swap-card invocation into overlay work.
 *
 * Pure functions only, so the argument grammar and the filter graph are testable without a
 * network, a browser or ffmpeg. The half that downloads, reads the API, drives Remotion and
 * runs ffmpeg lives in swap-card.mjs — the same split as render-plan / render-manifest.
 *
 * The grammar is STICKY: `--player` opens a pick, and every flag after it describes that pick
 * until the next `--player`. That is what lets one pass replace six cards with six different
 * players, which is the shape those "my gameweek" videos actually have. A single-player call
 * written the old way parses to a single pick and behaves exactly as it did.
 */

/** The boxes are padded outward so no edge of the overlay being replaced survives. */
export const COVER_PAD = 3

export const usage = () =>
  'usage: swap-card.mjs (--video <url> | --file <path>) [overlays...] [--out f.mp4]\n' +
  '\n' +
  '  player overlays  --player <id> [--gameweek N] [--captain] [--no-star]\n' +
  '                   --card x,y,w,h        the big player card\n' +
  '                   --panel x,y,w,h       the dark match stat panel\n' +
  '                   repeat --player to replace a second card in the same pass\n' +
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

const emptyPick = (player) => ({
  player,
  gameweek: null,
  captain: false,
  /** FPL's "in your XI" marker. On by default because most of this footage carries one. */
  star: true,
  card: null,
  panel: null,
})

/**
 * @param {string[]} argv
 * @returns {{video?: string, file?: string, probe: boolean, dryRun: boolean, noPanel: boolean,
 *            out?: string, picks: object[], brand: object}}
 */
export function parseArgs(argv) {
  const args = { probe: false, dryRun: false, noPanel: false, picks: [], brand: {} }

  // A pick's own flags may be written before its --player, which is the order the old
  // single-player usage line used. They wait here until a pick opens.
  let open = null
  let pending = {}
  const pick = () => {
    if (!open) {
      open = { ...emptyPick(null), ...pending }
      pending = {}
      args.picks.push(open)
    }
    return open
  }
  const onPick = (key, value) => {
    if (open) open[key] = value
    else pending[key] = value
  }
  const setBox = (key, value, flag) => {
    const target = pick()
    if (target[key]) throw new Error(`${flag} was already given for player ${target.player}.`)
    target[key] = box(value, flag)
  }

  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]

    if (flag === '--probe') args.probe = true
    else if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--no-panel') args.noPanel = true
    else if (flag === '--video') args.video = value()
    else if (flag === '--file') args.file = value()
    else if (flag === '--out') args.out = value()
    else if (flag === '--player') {
      open = { ...emptyPick(Number(value())), ...pending }
      pending = {}
      args.picks.push(open)
    } else if (flag === '--captain') onPick('captain', true)
    else if (flag === '--no-star') onPick('star', false)
    else if (flag === '--gameweek') onPick('gameweek', Number(value()))
    else if (flag === '--card') setBox('card', value(), '--card')
    else if (flag === '--panel') setBox('panel', value(), '--panel')
    else if (flag === '--points') args.brand.points = box(value(), '--points')
    else if (flag === '--total') args.brand.total = value()
    else if (flag === '--eyebrow') args.brand.eyebrow = value()
    else if (flag === '--logo') args.brand.logo = box(value(), '--logo')
    else if (flag === '--text') args.brand.text = box(value(), '--text')
    else if (flag === '--line') args.brand.line = value()
    else if (flag === '--bar') args.brand.bar = value()
    else throw new Error(`Unexpected argument "${argv[i]}".`)
  }

  if (!args.video && !args.file) throw new Error(usage())
  if (args.probe) return args

  if (args.picks.some((p) => !Number.isFinite(p.player))) {
    throw new Error('--card / --panel describe a player, so --player <id> is required first.')
  }
  if (args.picks.some((p) => !p.card && !p.panel)) {
    throw new Error('A --player with no --card or --panel has nothing to replace.')
  }
  const { brand } = args
  if (!args.picks.length && !brand.points && !brand.logo && !brand.text) {
    throw new Error('Nothing to replace. Give at least one of --card, --points, --logo or --text.')
  }
  if (brand.text && !brand.line) throw new Error('--text needs --line "<the new words>".')
  if (brand.points && brand.total === undefined) throw new Error('--points needs --total <n>, the number to show.')

  return args
}

/**
 * Every overlay to composite, in paint order.
 *
 * @param {{picks: object[], brand: object, noPanel?: boolean}} plan picks carry a `resolved`
 *   player and, where a panel was asked for, a `photo` path.
 * @returns {Array<{box: object, composition: string, props: object, pad?: number}>}
 */
export function overlayJobs({ picks = [], brand = {}, noPanel = false }) {
  const jobs = []

  for (const pick of picks) {
    if (pick.card) {
      jobs.push({
        box: pick.card,
        composition: 'CardOnly',
        props: {
          name: pick.resolved.cardName,
          club: pick.resolved.club,
          value: String(pick.resolved.points),
          badge: pick.captain ? 'C' : null,
          star: pick.star ?? true,
        },
      })
    }
    if (pick.panel && !noPanel) {
      jobs.push({
        box: pick.panel,
        composition: 'PanelOnly',
        props: {
          name: pick.resolved.fullName,
          photo: pick.photo ?? null,
          points: String(pick.resolved.points),
          goals: pick.resolved.goals,
          assists: pick.resolved.assists,
          captain: Boolean(pick.captain),
        },
      })
    }
  }

  if (brand.points) {
    jobs.push({
      box: brand.points,
      composition: 'PointsPanel',
      props: {
        eyebrow: brand.eyebrow ?? `الجولة ${picks[0]?.resolved?.gw ?? ''}`.trim(),
        points: String(brand.total),
      },
    })
  }
  if (brand.logo) jobs.push({ box: brand.logo, composition: 'LogoTile', props: {} })
  if (brand.text) {
    // Painted LAST so it sits over anything else that shares the bar. The bar is a solid fill
    // we reproduce exactly, so padding it outward would only eat into the picture below.
    jobs.push({
      box: brand.text,
      composition: 'TextLine',
      props: { text: brand.line, ...(brand.bar ? { background: brand.bar } : {}) },
      pad: 0,
    })
  }

  return jobs
}

/**
 * The ffmpeg filter chain: each overlay scaled to its padded box, then laid onto the last.
 *
 * Input 0 is the source video and input i+1 is job i's still, which is the order swap-card.mjs
 * passes them to ffmpeg.
 *
 * @param {Array<{box: object, pad?: number}>} jobs
 * @returns {{filters: string[], last: string}}
 */
export function overlayFilters(jobs) {
  const filters = []
  let last = '[0:v]'

  jobs.forEach((job, i) => {
    const { x, y, w, h } = job.box
    const pad = job.pad ?? COVER_PAD
    filters.push(`[${i + 1}:v]scale=${w + pad * 2}:${h + pad * 2}[o${i}]`)
    filters.push(`${last}[o${i}]overlay=${x - pad}:${y - pad}[v${i}]`)
    last = `[v${i}]`
  })

  return { filters, last }
}
