import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortName } from '../build/author/names.mjs'

// The exact table in content-design-kit.md §2 rule 9. The name box under a shirt is 284px.
test('a player is written by his last name, as the design kit tabulates', () => {
  const table = {
    'محمود عبد المنعم كهربا': 'كهربا',
    'أحمد سيد زيزو': 'زيزو',
    'محمد الشناوي': 'الشناوي',
    'علي معلول': 'معلول',
    'أحمد فتوح': 'فتوح',
    'إمام عاشور': 'عاشور',
    'مروان عطية': 'عطية',
  }
  for (const [full, expected] of Object.entries(table)) assert.equal(shortName(full), expected)
})

// The exception, and the one that matters: وسام أبو علي is أبو علي. Never علي.
test('a compound surname keeps its prefix', () => {
  assert.equal(shortName('وسام أبو علي'), 'أبو علي')
  assert.equal(shortName('محمد عبد الرحمن'), 'عبد الرحمن')
  assert.equal(shortName('محمود عبد المنعم'), 'عبد المنعم')
  assert.equal(shortName('علي ابن سعيد'), 'ابن سعيد')
})

test('a prefix earlier in the name is not a surname, so it is dropped with the rest', () => {
  assert.equal(shortName('محمود عبد المنعم كهربا'), 'كهربا')
})

test('a one-word name is already as short as it goes', () => {
  assert.equal(shortName('زيزو'), 'زيزو')
})

test('extra whitespace does not become an empty last word', () => {
  assert.equal(shortName('  إمام   عاشور  '), 'عاشور')
})

test('a missing name is refused rather than rendering an empty slot', () => {
  assert.throws(() => shortName(''), /name/i)
  assert.throws(() => shortName(null), /name/i)
})
