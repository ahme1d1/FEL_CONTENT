/**
 * Captions for the posts whose copy is mechanical, and a refusal for the ones whose copy is not.
 *
 * The split is deliberate. A matchday or a deadline post says the same true thing every week, and
 * writing it by hand thirty times a season is how a typo reaches a brand account. A post that
 * names a real manager or a real player is taste, and `lint-copy.mjs` already says where taste
 * lives: "Taste stays with the human." Those come back `null` with a brief.
 *
 * Nothing here trusts itself. Every caption it produces is linted before it is returned, so a
 * template that drifts out of policy fails at authoring time rather than on a live account.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lintCaption } from '../lint-copy.mjs'

export const TEMPLATES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./caption-templates.json', import.meta.url)), 'utf8'),
)

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../copy-rules.json', import.meta.url)), 'utf8'),
)

/** True when this kind of post is written by a human, not chosen from a template. */
export const needsHumanCaption = (kind) => kind in TEMPLATES.needsHuman

/** What the human is being asked for. Travels in the manifest so the ask survives the handoff. */
export const captionBrief = (kind) => TEMPLATES.needsHuman[kind] ?? null

/**
 * Posts whose job is comments, and which therefore close on a question.
 *
 * The split is the owner's, 2026-09-02, and it is what `content-design-kit.md` §6 already
 * described: a matchday card, a captain poll and a podium exist to be replied to — «عندك مين
 * فيهم؟», «انت فين؟» — while a deadline, a price move or a league table exists to be acted on,
 * and a question there only softens the instruction. The linter's platform-level ban on trailing
 * questions is lifted for these kinds and no others.
 *
 * `results` is deliberately NOT here. §6's «فريقك عمل كام؟» was retired: asking a manager their
 * score after a bad round is the one question that does not earn a reply. Point forward instead.
 */
const ENGAGEMENT_KINDS = new Set([
  'matchday',
  'matchdayFinal',
  'question',
  'podium',
  'playerOfRound',
  'teamOfWeek',
  'topPlayers',
])

/** Whether this kind of post may close on a question. */
export const asksQuestion = (kind) => ENGAGEMENT_KINDS.has(kind)

/**
 * Fill `{name}` placeholders with the round's real values.
 *
 * The house style is specific — «3 ماتشات النهاردة», not «يوم كامل كورة قدامك» — and a caption
 * that would read identically in any gameweek is the failure this exists to prevent. A
 * placeholder with no value is left as-is so it fails the linter loudly rather than publishing a
 * literal brace to a brand account.
 */
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))

/**
 * Pick a caption.
 *
 * Variety is deterministic, never random: three matchday cards in one round carrying identical
 * text "reads as a bot" (posting-runbook.md §7), and `Math.random()` would make the same manifest
 * author differently twice, which breaks the diff review the whole pipeline rests on.
 *
 * @param {{kind: string, platform: string, gameweek: number, dayIndex: number, vars?: object,
 *   rules?: object}} input
 * @returns {string|null} null when this kind is the human's to write
 */
export function captionFor({ kind, platform, gameweek, dayIndex, vars = {}, rules = RULES }) {
  if (needsHumanCaption(kind)) return null

  const byPlatform = TEMPLATES.kinds[kind]
  if (!byPlatform) throw new Error(`No caption template for "${kind}".`)

  const variants = byPlatform[platform]
  if (!variants?.length) throw new Error(`No ${platform} caption for "${kind}".`)

  const text = fill(variants[(gameweek + dayIndex) % variants.length], vars)

  const { findings } = lintCaption({ text, platform, rules, allowQuestion: asksQuestion(kind) })
  if (findings.length) {
    const reasons = findings.map((f) => `[${f.ruleId}] ${f.message}`).join('\n  ')
    throw new Error(`The ${platform} caption for "${kind}" does not pass the linter:\n  ${reasons}`)
  }

  return text
}

/** Post ids still waiting on a human. */
export const missingCaptions = (posts) => posts.filter((p) => p.caption === null).map((p) => p.id)

/**
 * Merge captions a human wrote, by post id, and lint them on the platform they will publish to.
 *
 * Supplied copy goes through exactly the same rules as generated copy. Nothing reaches an account
 * unlinted just because a person typed it — the owner's own first draft of the pinned post broke
 * eight rules, most of them ones he had retired himself.
 *
 * @returns {{posts: object[], findings: Array<{id: string, ruleId: string, message: string}>}}
 */
export function applyHumanCaptions({ posts, captions, rules = RULES }) {
  const findings = []

  const next = posts.map((post) => {
    const text = captions[post.id]
    if (text === undefined) return post

    // Judged by the same rule the generated caption was: an override on a matchday card may ask
    // a question, and an override on a deadline card still may not.
    const lint = lintCaption({ text, platform: post.platform, rules, allowQuestion: asksQuestion(post.kind) })
    for (const f of lint.findings) findings.push({ id: post.id, ...f })

    const { captionBrief: _asked, ...rest } = post
    return { ...rest, caption: text }
  })

  const unknown = Object.keys(captions).filter((id) => !posts.some((p) => p.id === id))
  for (const id of unknown) {
    findings.push({ id, ruleId: 'unknown-post', message: 'No post in this manifest has that id.' })
  }

  return { posts: next, findings }
}
