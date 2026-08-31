/**
 * Caption linter for FEL social copy.
 *
 * Three platforms times roughly ten posts a week is thirty captions needing the
 * same mechanical checks. Those belong here. Taste stays with the human.
 *
 * Rules live in copy-rules.json, which mirrors content-design-kit.md §2 and §5
 * in FEL_WEBSITE. Change both together.
 */

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })
const IS_EMOJI = /\p{Extended_Pictographic}/u
const HASHTAG = /#[^\s#]+/gu
const LINKISH = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|app|eg|io)\b/giu
const QUESTION_MARK = /[?؟]/u

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Arabic script has no ASCII word boundary, so \b is useless here. Bound the
 * term with "not a letter" lookarounds instead, which stops ولّع matching
 * inside هيولّع while still catching it as its own word.
 */
const wholeWord = (term) => new RegExp(`(?<!\\p{L})${escapeRegex(term)}(?!\\p{L})`, 'gu')

const graphemesOf = (text) => [...GRAPHEMES.segment(text)].map((s) => s.segment)
const emojiIn = (text) => graphemesOf(text).filter((g) => IS_EMOJI.test(g))

const finding = (ruleId, message, match) => ({ ruleId, severity: 'error', message, match })

/** Strip trailing whitespace and trailing emoji, then report any emoji left behind. */
function misplacedEmoji(line) {
  const parts = graphemesOf(line)
  let end = parts.length
  while (end > 0 && (parts[end - 1].trim() === '' || IS_EMOJI.test(parts[end - 1]))) end -= 1
  return parts.slice(0, end).filter((g) => IS_EMOJI.test(g))
}

function checkCharacters(text, rules, out) {
  for (const banned of rules.bannedCharacters) {
    for (const ch of banned.chars) {
      if (text.includes(ch)) {
        out.push(finding(banned.id, banned.message, ch))
        break
      }
    }
  }
}

function checkVocabulary(text, rules, out) {
  for (const { term, use } of rules.retiredVocabulary) {
    if (wholeWord(term).test(text)) {
      out.push(finding('retired-vocabulary', `«${term}» is retired. Use ${use}.`, term))
    }
  }
  for (const { term, use } of rules.msaMarkers) {
    if (wholeWord(term).test(text)) {
      out.push(finding('msa-marker', `«${term}» is MSA. Egyptian colloquial: ${use}.`, term))
    }
  }
}

function checkClaims(text, rules, out) {
  for (const claim of rules.forbiddenClaims) {
    const hit = text.match(new RegExp(claim.pattern, 'gu'))
    if (hit) out.push(finding(claim.id, claim.message, hit[0]))
  }
}

function checkShape(text, platform, spec, out) {
  const chars = graphemesOf(text).length
  if (spec.maxChars !== null && chars > spec.maxChars) {
    out.push(finding('max-chars', `${chars} characters; ${platform} allows ${spec.maxChars}.`, null))
  }

  const lines = text.split('\n')
  if (spec.maxLines !== null && lines.length > spec.maxLines) {
    out.push(finding('max-lines', `${lines.length} lines; ${platform} allows ${spec.maxLines}.`, null))
  }

  const tags = text.match(HASHTAG) ?? []
  if (tags.length > spec.maxHashtags) {
    out.push(
      finding('max-hashtags', `${tags.length} hashtags; ${platform} allows ${spec.maxHashtags}.`, tags.join(' ')),
    )
  }

  const emoji = emojiIn(text)
  if (emoji.length < spec.minEmoji || emoji.length > spec.maxEmoji) {
    out.push(
      finding('emoji-count', `${emoji.length} emoji; ${platform} wants ${spec.minEmoji} to ${spec.maxEmoji}.`, emoji.join('')),
    )
  }

  if (spec.emojiMustEndLine) {
    const stray = lines.flatMap(misplacedEmoji)
    if (stray.length) {
      out.push(finding('emoji-position', 'Emoji end a line. Never mid-sentence, never decoration.', stray.join('')))
    }
  }

  if (!spec.allowTrailingQuestion && QUESTION_MARK.test(text)) {
    out.push(
      finding('question-caption', `Egyptian creators assert and let the comments argue. No questions on ${platform}.`, '؟'),
    )
  }

  if (!spec.allowLink) {
    const link = text.match(LINKISH)
    if (link) out.push(finding('no-link', `Links are not clickable on ${platform}. Point at the bio.`, link[0]))
  }
}

/**
 * @param {{text: string, platform: string, rules: object}} input
 * @returns {{ok: boolean, findings: Array<{ruleId: string, severity: string, message: string, match: string|null}>}}
 */
export function lintCaption({ text, platform, rules }) {
  const spec = rules.platforms[platform]
  if (!spec) {
    throw new Error(`Unknown platform "${platform}". Known: ${Object.keys(rules.platforms).join(', ')}.`)
  }
  if (typeof text !== 'string') throw new TypeError(`Caption must be a string, got ${typeof text}.`)

  const findings = []
  checkCharacters(text, rules, findings)
  checkVocabulary(text, rules, findings)
  checkClaims(text, rules, findings)
  checkShape(text, platform, spec, findings)

  return { ok: findings.length === 0, findings }
}
