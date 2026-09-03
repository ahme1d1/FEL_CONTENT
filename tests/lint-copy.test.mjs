import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lintCaption } from '../build/lint-copy.mjs'

const RULES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../build/copy-rules.json', import.meta.url)), 'utf8'),
)

/** Convenience: returns the array of rule ids a caption trips. */
const idsFor = (text, platform = 'facebook') =>
  lintCaption({ text, platform, rules: RULES }).findings.map((f) => f.ruleId)

test('a clean Egyptian Facebook caption passes', () => {
  const text = 'الأهلي بياخد 3 نقط من الزمالك 🔥\nكهربا لوحده جاب 14 نقطة ⚽'
  const { ok, findings } = lintCaption({ text, platform: 'facebook', rules: RULES })
  assert.equal(ok, true, `expected clean, got: ${JSON.stringify(findings)}`)
})

test('retired hype verbs are rejected', () => {
  assert.ok(idsFor('الدوري هيولّع النهاردة 🔥⚽').includes('retired-vocabulary'))
  assert.ok(idsFor('الماتش ده نار 🔥⚽').includes('retired-vocabulary'))
})

test('الشلة and أصحابك are rejected in favour of صحابك', () => {
  assert.ok(idsFor('اعمل دوري مع الشلة 🔥⚽').includes('retired-vocabulary'))
  assert.ok(idsFor('اعمل دوري مع أصحابك 🔥⚽').includes('retired-vocabulary'))
})

test('صحابك itself is fine', () => {
  assert.ok(!idsFor('اعمل دوري مع صحابك 🔥⚽').includes('retired-vocabulary'))
})

test('Eastern Arabic-Indic digits are rejected', () => {
  assert.ok(idsFor('كهربا جاب ١٤ نقطة 🔥⚽').includes('eastern-digits'))
})

test('the pointer emoji is rejected', () => {
  assert.ok(idsFor('النتايج كلها هنا 👇⚽').includes('pointer-emoji'))
})

test('em dashes are rejected', () => {
  assert.ok(idsFor('كهربا — أحسن لاعب 🔥⚽').includes('em-dash'))
})

test('MSA markers are rejected', () => {
  assert.ok(idsFor('كيف تجهز فريقك 🔥⚽').includes('msa-marker'))
  assert.ok(!idsFor('إزاي تجهز فريقك 🔥⚽').includes('msa-marker'))
})

test('a false season length is rejected', () => {
  assert.ok(idsFor('38 جولة و38 فايز 🔥⚽').includes('season-length'))
})

test('the BPS acronym is rejected, but describing what it measures is not', () => {
  // The system is real since 2026-09-03; the acronym is transliterated English (kit §2 rule 7).
  assert.ok(idsFor('النقاط الإضافية بتتحسب بـ BPS 🔥⚽').includes('bps'))
  assert.ok(!idsFor('أحسن 3 لاعيبة في الماتش بياخدوا نقط إضافية 🔥⚽').includes('bps'))
})

test('a Monday stat revision is rejected — that is a Premier League convention', () => {
  assert.ok(idsFor('الإحصائيات بتتراجع رسمياً يوم الاتنين 🔥⚽').includes('monday-revision'))
})

test('saying the extra points compute themselves is allowed — it became true', () => {
  // The `automatic-bonus` rule outlived the fact behind it: bonus was typed in by an admin until
  // the 2026-09-03 scoring release computed it from match statistics. A linter that keeps
  // rejecting a claim after it comes true blocks honest copy, which is the failure this guards.
  const text = 'النقاط الإضافية بتتحسب أوتوماتيك من الماتش 🔥⚽'
  assert.deepEqual(idsFor(text), [])
})

test('«بونص» is still the wrong word for them', () => {
  assert.ok(idsFor('البونص نزل دلوقتي 🔥⚽').includes('retired-vocabulary'))
})

test('the two-hour deadline claim is rejected', () => {
  assert.ok(idsFor('الديدلاين قبل أول ماتش بساعتين 🔥⚽').includes('two-hour-deadline'))
})

test('app download mentions are rejected', () => {
  assert.ok(idsFor('حمّل التطبيق دلوقتي 🔥⚽').includes('app-download'))
})

test('instagram captions over 120 characters are rejected', () => {
  const long = 'ا'.repeat(130)
  assert.ok(idsFor(long, 'instagram').includes('max-chars'))
})

test('a 60-character instagram caption passes the length check', () => {
  assert.ok(!idsFor('كهربا جاب 14 نقطة لوحده 🔥', 'instagram').includes('max-chars'))
})

test('instagram captions may not ask questions, facebook may', () => {
  assert.ok(idsFor('مين كابتنك النهاردة؟ 🔥', 'instagram').includes('question-caption'))
  assert.ok(!idsFor('مين كابتنك النهاردة؟ 🔥⚽', 'facebook').includes('question-caption'))
})

test('a bare URL in an instagram caption is rejected', () => {
  assert.ok(idsFor('العب دلوقتي fantasyeg.com 🔥', 'instagram').includes('no-link'))
  assert.ok(idsFor('العب دلوقتي https://fantasyeg.com 🔥', 'instagram').includes('no-link'))
})

test('too many hashtags is rejected per platform', () => {
  const many = 'كهربا 🔥 #فانتازي #الدوري_المصري #الأهلي #الزمالك #بيراميدز'
  assert.ok(idsFor(many, 'instagram').includes('max-hashtags'))
  assert.ok(!idsFor(many, 'tiktok').includes('max-hashtags'))
})

test('facebook requires between 2 and 4 emoji', () => {
  assert.ok(idsFor('كهربا جاب 14 نقطة').includes('emoji-count'))
  assert.ok(idsFor('كهربا 🔥⚽🎯🏆😤 جاب 14').includes('emoji-count'))
  assert.ok(!idsFor('كهربا جاب 14 نقطة 🔥⚽').includes('emoji-count'))
})

test('a ZWJ emoji sequence counts as one emoji', () => {
  assert.ok(!idsFor('الفريق جاهز 👨‍👩‍👧‍👦⚽').includes('emoji-count'))
})

test('facebook rejects emoji that do not end a line', () => {
  assert.ok(idsFor('كهربا 🔥 جاب 14 نقطة ⚽').includes('emoji-position'))
  assert.ok(!idsFor('كهربا جاب 14 نقطة 🔥⚽').includes('emoji-position'))
})

test('an unprovisioned email address is rejected', () => {
  assert.ok(idsFor('كلمنا على hello@fantasyeg.com 🔥⚽').includes('unprovisioned-email'))
})

test('every finding carries a rule id, a message and the matched text', () => {
  const { findings } = lintCaption({ text: 'الدوري هيولّع 🔥⚽', platform: 'facebook', rules: RULES })
  assert.ok(findings.length > 0)
  for (const f of findings) {
    assert.ok(f.ruleId, 'ruleId missing')
    assert.ok(f.message, 'message missing')
    assert.ok('match' in f, 'match missing')
  }
})

test('an unknown platform throws rather than silently passing', () => {
  assert.throws(() => lintCaption({ text: 'x', platform: 'threads', rules: RULES }), /threads/)
})
