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

// ── cardName: rule 9 as it is WRITTEN ───────────────────────────────────────────────────────────
//
// Rule 9 opens conditionally — "if the name is long, take the last name" — but its worked table
// shortens every name, and `shortName` was built to match the table. Owner call, 2026-09-04: the
// 284px measurement the rule cites is the name box UNDER A SHIRT, and the wide cards do not have
// one. A top-players row and the player-of-the-round hero carry the full name; the shirt cards
// keep shortening, because that is where the box the rule measured actually is.

import { cardName } from '../build/author/names.mjs'

test('a name inside the budget is written in full', () => {
  assert.equal(cardName('أحمد سيد زيزو', { maxChars: 18 }), 'أحمد سيد زيزو')
  assert.equal(cardName('إمام عاشور', { maxChars: 18 }), 'إمام عاشور')
  assert.equal(cardName('احمد سامى', { maxChars: 18 }), 'احمد سامى')
})

// The stress case the design kit names by hand: it renders roughly twice the box width.
test('a name over the budget falls back to the last name', () => {
  assert.equal(cardName('محمود عبد المنعم كهربا', { maxChars: 18 }), 'كهربا')
})

test('the fallback keeps a compound surname whole', () => {
  assert.equal(cardName('محمد أشرف عبد الرحمن الشناوي', { maxChars: 12 }), 'الشناوي')
  assert.equal(cardName('وسام محمد أبو علي', { maxChars: 12 }), 'أبو علي')
})

// A budget that even the last name cannot meet still returns the last name: it is the shortest
// form that identifies the man, and a truncated Arabic name identifies nobody.
test('a budget below the last name still returns the last name, never a truncation', () => {
  assert.equal(cardName('محمود عبد المنعم كهربا', { maxChars: 3 }), 'كهربا')
})

test('cardName refuses a missing name exactly as shortName does', () => {
  assert.throws(() => cardName('', { maxChars: 18 }), /name/i)
  assert.throws(() => cardName(null, { maxChars: 18 }), /name/i)
})

test('whitespace is normalised before the budget is measured', () => {
  assert.equal(cardName('  إمام   عاشور  ', { maxChars: 11 }), 'إمام عاشور')
})
