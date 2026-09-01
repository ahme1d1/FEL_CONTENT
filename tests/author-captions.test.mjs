import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lintCaption } from '../build/lint-copy.mjs'
import { TEMPLATES, captionBrief, captionFor, needsHumanCaption } from '../build/author/captions.mjs'

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../build/copy-rules.json', import.meta.url)), 'utf8'),
)

// The whole point of a template file: the rules are checked once, here, instead of thirty times
// a season by eye. A red line in this test is a caption that must not be written.
test('every shipped template passes the linter on its own platform', () => {
  for (const [kind, byPlatform] of Object.entries(TEMPLATES.kinds)) {
    for (const [platform, variants] of Object.entries(byPlatform)) {
      for (const text of variants) {
        const { findings } = lintCaption({ text, platform, rules: RULES })
        assert.deepEqual(
          findings.map((f) => `${f.ruleId}: ${f.match ?? ''}`),
          [],
          `${kind}/${platform}: ${text}`,
        )
      }
    }
  }
})

test('every kind carries a variant for all three platforms', () => {
  for (const [kind, byPlatform] of Object.entries(TEMPLATES.kinds)) {
    for (const platform of ['facebook', 'instagram', 'tiktok']) {
      assert.ok(byPlatform[platform]?.length, `${kind} has no ${platform} caption`)
    }
  }
})

test('a caption is chosen, and it is one of the variants', () => {
  const text = captionFor({ kind: 'matchday', platform: 'instagram', gameweek: 4, dayIndex: 1 })
  assert.ok(TEMPLATES.kinds.matchday.instagram.includes(text))
})

// Three matchday cards in one round posting the same line reads as a bot.
test('the same kind on consecutive days does not repeat itself', () => {
  const day = (dayIndex) => captionFor({ kind: 'matchday', platform: 'facebook', gameweek: 4, dayIndex })
  assert.notEqual(day(1), day(2))
})

test('the same input always picks the same caption, so re-authoring is a no-op diff', () => {
  const pick = () => captionFor({ kind: 'results', platform: 'tiktok', gameweek: 7, dayIndex: 3 })
  assert.equal(pick(), pick())
})

test('the posts that name a real person come back for a human to write', () => {
  for (const kind of ['podium', 'topPlayers', 'playerOfRound', 'teamOfWeek']) {
    assert.equal(needsHumanCaption(kind), true, kind)
    assert.equal(captionFor({ kind, platform: 'facebook', gameweek: 4, dayIndex: 1 }), null)
    assert.match(captionBrief(kind), /\S/)
  }
})

test('an unknown kind is a mistake, not a silent empty caption', () => {
  assert.throws(() => captionFor({ kind: 'nope', platform: 'facebook', gameweek: 1, dayIndex: 1 }), /No caption template/)
})

test('a template that stopped passing the linter fails loudly at authoring time', () => {
  const rules = JSON.parse(JSON.stringify(RULES))
  // Something every deadline variant carries, so the test does not depend on which one rotates in.
  rules.forbiddenClaims.push({ id: 'test-only', pattern: '⏰', message: 'banned for this test' })
  assert.throws(
    () => captionFor({ kind: 'deadline', platform: 'tiktok', gameweek: 2, dayIndex: 1, rules }),
    /does not pass the linter/,
  )
})
