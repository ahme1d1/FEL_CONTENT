import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lintCaption } from '../build/lint-copy.mjs'
import { TEMPLATES, asksQuestion, captionBrief, captionFor, needsHumanCaption } from '../build/author/captions.mjs'

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../build/copy-rules.json', import.meta.url)), 'utf8'),
)

// Representative values, standing in for a real round. Linting the raw template would test a
// string that never publishes — «{matches} النهاردة» is not what anyone reads.
// Must stay in step with captionVars() in plan.mjs — a template using a var this map lacks is
// what the placeholder test below is for, so the two together catch a name drifting apart.
const VARS = {
  matches: '3 ماتشات',
  these: 'الماتشات دي',
  winner: 'مراد',
  played: 'ماتشين',
  remaining: '4 ماتشات',
  rounds: 'جولتين',
  deadline: 'الاتنين 4 العصر',
  gw: 'الجولة الرابعة',
}
const fill = (t) => t.replace(/\{(\w+)\}/g, (whole, key) => (key in VARS ? VARS[key] : whole))

// The whole point of a template file: the rules are checked once, here, instead of thirty times
// a season by eye. A red line in this test is a caption that must not be written.
test('every shipped template passes the linter as it will actually publish', () => {
  for (const [kind, byPlatform] of Object.entries(TEMPLATES.kinds)) {
    for (const [platform, variants] of Object.entries(byPlatform)) {
      for (const raw of variants) {
        const text = fill(raw)
        const { findings } = lintCaption({ text, platform, rules: RULES, allowQuestion: asksQuestion(kind) })
        assert.deepEqual(
          findings.map((f) => `${f.ruleId}: ${f.match ?? ''}`),
          [],
          `${kind}/${platform}: ${text}`,
        )
      }
    }
  }
})

// A template nobody filled would publish a literal «{gw}» to a brand account. The linter cannot
// catch that — a brace is not banned vocabulary — so it is caught here instead.
test('no placeholder survives filling, and none is unknown', () => {
  for (const [kind, byPlatform] of Object.entries(TEMPLATES.kinds)) {
    for (const [platform, variants] of Object.entries(byPlatform)) {
      for (const raw of variants) {
        const left = fill(raw).match(/\{\w+\}/g)
        assert.equal(left, null, `${kind}/${platform} has an unknown placeholder: ${left?.join(', ')}`)
      }
    }
  }
})

// The split the owner drew: engagement posts ask, informational posts point forward.
test('only engagement kinds close on a question', () => {
  for (const [kind, byPlatform] of Object.entries(TEMPLATES.kinds)) {
    if (asksQuestion(kind)) continue
    for (const [platform, variants] of Object.entries(byPlatform)) {
      for (const raw of variants) {
        assert.ok(!/[?؟]/.test(fill(raw)), `${kind}/${platform} is informational but asks: ${raw}`)
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

// Until 2026-09-02 these four came back null with a brief, on the reasoning that a post naming a
// real person is taste. The naming was never needed: §2 rule 2 forbids a caption restating what
// the card carries, and the card already carries every name, club and score. So the caption adds
// the stake instead — and a caption that names nobody is one a template can write.
test('every settle-day post is templated, so a settled round needs no human', () => {
  for (const kind of ['podium', 'topPlayers', 'playerOfRound', 'teamOfWeek']) {
    assert.equal(needsHumanCaption(kind), false, kind)
    assert.equal(captionBrief(kind), null, kind)
    for (const platform of ['facebook', 'instagram', 'tiktok']) {
      assert.match(captionFor({ kind, platform, gameweek: 4, dayIndex: 1 }), /\S/, `${kind}/${platform}`)
    }
  }
})

// The whole point of the reversal. A caption carrying a manager's name would also be restating the
// card, so this guards the voice rule and the automation at once.
//
// `winner` is deliberately absent from this list. Its caption is «مبروك يا مراد 🏆» — the page's
// own words — and congratulating an unnamed person is not a congratulation. It reads its name
// from {winner}, never from a hardcoded string, which is what the placeholder test above covers.
test('a settle-day caption names nobody the card already names', () => {
  const names = ['Ahmed', 'محمد', 'My FEL Team', 'El mazzarita']
  for (const kind of ['podium', 'topPlayers', 'playerOfRound', 'teamOfWeek']) {
    for (let gameweek = 1; gameweek <= 19; gameweek += 1) {
      const text = captionFor({ kind, platform: 'facebook', gameweek, dayIndex: 6 })
      for (const n of names) assert.ok(!text.includes(n), `${kind} gw${gameweek} leaked "${n}"`)
    }
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
