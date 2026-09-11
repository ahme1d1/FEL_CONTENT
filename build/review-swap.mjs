/**
 * Turning the round-review cast into still jobs and an encode.
 *
 * Pure functions only, so the timing arithmetic and the ffmpeg arguments are testable without a
 * network, a browser or ffmpeg — the same split as swap-plan / swap-card and render-plan /
 * render-manifest.
 *
 * The shape here is different from swap-card's on purpose. That tool overlays small tiles onto
 * footage it keeps. This one keeps NO picture from the source: the 28 cards tile the whole
 * runtime end to end, and the owner's rule is that no Premier League mark may sit behind our
 * players — their shield, their PL-coloured backdrop and the sleeve badge on every kit all have
 * to go, which leaves nothing of their frame to preserve. So the video is built from our stills
 * with the concat demuxer and the source is opened only for its audio. That is both cleaner than
 * a 28-deep overlay chain and the only version that actually removes the branding.
 */

/** The source's own frame rate, and what we publish at. TikTok rejected a 16fps cut outright. */
export const FPS = 30

/**
 * Snap the cast's cut points to whole frames and hand back one row per card.
 *
 * Boundaries are snapped, then durations are derived FROM the snapped boundaries, so rounding
 * cannot accumulate across 28 cards — card 28 ends exactly where the audio does.
 *
 * @param {object[]} cast rows from review-cast.mjs, in order
 * @param {{fps?: number, duration: number}} opts source duration in seconds
 * @returns {{n: number, startFrame: number, endFrame: number, frames: number, seconds: number}[]}
 */
export function cardTimings(cast, { fps = FPS, duration }) {
  if (!Array.isArray(cast) || cast.length === 0) throw new Error('A cast is required.')
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`A source duration in seconds is required, got ${JSON.stringify(duration)}.`)
  }

  const lastEnd = cast[cast.length - 1].end
  if (lastEnd > duration + 0.5) {
    throw new Error(`The cast runs to ${lastEnd}s but the source is only ${duration}s.`)
  }

  return cast.map((card, i) => {
    const prev = i === 0 ? 0 : cast[i - 1].end
    if (Math.abs(card.start - prev) > 1e-6) {
      throw new Error(`Card ${card.n} starts at ${card.start}s but card ${i} ended at ${prev}s.`)
    }
    // The last card runs to the end of the audio, not to its own cut point: the source's final
    // boundary sits a few frames short of the file, and a video that stops early truncates it.
    const end = i === cast.length - 1 ? duration : card.end
    const startFrame = Math.round(card.start * fps)
    const endFrame = Math.round(end * fps)
    const frames = endFrame - startFrame
    if (frames < 1) throw new Error(`Card ${card.n} is shorter than one frame.`)
    return { n: card.n, startFrame, endFrame, frames, seconds: frames / fps }
  })
}

/** Where a card's still is written. Zero-padded so a directory listing sorts as it plays. */
export const stillName = (n) => `card-${String(n).padStart(2, '0')}.png`

/**
 * One Remotion still per card.
 *
 * Only what the card draws: position, name, club, portrait and the score. What he DID — goals,
 * assists, clean sheet — is deliberately not passed: the voiceover is already saying it, and a
 * second telling on screen argues with it.
 *
 * `photo` is public-relative because that is what `staticFile()` takes; the fetch that puts the
 * file there lives in the CLI.
 *
 * @param {object[]} cast
 */
export function stillJobs(cast) {
  return cast.map((card) => {
    const p = card.player
    if (!p?.id || !p.name || !p.club) {
      throw new Error(`Card ${card.n} is missing a player id, name or club.`)
    }
    return {
      n: card.n,
      file: stillName(card.n),
      props: {
        name: p.name,
        club: p.club,
        clubName: p.clubName,
        position: p.position,
        photo: `players/${p.id}.jpg`,
        points: p.points,
      },
    }
  })
}

/**
 * One entry per output frame, naming the card that should be on screen for it.
 *
 * The obvious route is the concat demuxer with a `duration` after each image, and that is what
 * this did first. It does not survive conversion to constant frame rate: the same 28 cards and
 * durations came out 2.6s long without a bound and 3.5s short with one, because the demuxer's
 * per-image durations and `-fps_mode cfr` disagree about the trailing entry. Frames are what the
 * output is actually made of, so frames are what this counts. The CLI hard-links each index to
 * its card, which costs nothing on disk, and ffmpeg reads a plain numbered sequence.
 *
 * @param {{n: number, frames: number}[]} timings
 * @returns {number[]} card number for frame 0, 1, 2, …
 */
export function frameCards(timings) {
  const out = []
  for (const t of timings) {
    for (let i = 0; i < t.frames; i += 1) out.push(t.n)
  }
  return out
}

/** Frame files are numbered from 1 so the pattern reads the way ffmpeg's %05d counts. */
export const frameName = (i) => `f${String(i + 1).padStart(5, '0')}.png`

/**
 * ffmpeg arguments for the final cut.
 *
 * Video comes from the concat list, audio is COPIED from the source — never re-encoded, and
 * never mixed with anything. The owner asked for no music, and their voiceover is the whole
 * reason the cast is matched to FPL's real GW3 returns.
 *
 * `-r` is explicit because the swap tooling's one recorded failure was TikTok refusing a 16fps
 * upload with `frame_rate_check_failed`.
 */
export function encodeArgs({ framesPattern, sourcePath, out, fps = FPS, crf = 18 }) {
  if (!framesPattern || !sourcePath || !out) {
    throw new Error('encodeArgs needs framesPattern, sourcePath and out.')
  }
  return [
    '-v', 'error', '-y',
    '-framerate', String(fps), '-i', framesPattern,
    '-i', sourcePath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:a', 'copy',
    '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
    '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-movflags', '+faststart',
    out,
  ]
}

/**
 * Does each card still sit against a player who returned what the voice is describing?
 *
 * The cast is matched to FPL GW3 because the source's audio is kept. Numbers on both sides move
 * — FEL prices and points settle, FPL's live endpoint can be corrected after the fact — so a
 * rebuild re-reads both and calls this rather than trusting the file. Cards with no `points`
 * (he did not feature) are exempt: there is no figure to compare.
 *
 * @param {object[]} cast
 * @param {{tolerance?: number}} opts how many points apart is still the same story
 * @returns {{card: number, source: string, player: string, their: number, ours: number, gap: number}[]}
 */
export function pairingDrift(cast, { tolerance = 2 } = {}) {
  const out = []
  for (const card of cast) {
    if (card.player.points === null || card.player.points === undefined) continue
    const ours = Number(card.player.points)
    const their = Number(card.source.points)
    const gap = Math.abs(their - ours)
    if (gap > tolerance) {
      out.push({ card: card.n, source: card.source.card, player: card.player.name, their, ours, gap })
    }
  }
  return out
}
