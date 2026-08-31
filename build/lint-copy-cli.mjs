#!/usr/bin/env node
/** Lints one caption from the command line: node build/lint-copy-cli.mjs instagram "…" */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lintCaption } from './lint-copy.mjs'

const [platform, ...rest] = process.argv.slice(2)
const text = rest.join(' ')
if (!platform || !text) {
  console.error('usage: lint-copy-cli.mjs <facebook|instagram|tiktok> "caption"')
  process.exit(2)
}

const rules = JSON.parse(readFileSync(fileURLToPath(new URL('./copy-rules.json', import.meta.url)), 'utf8'))
const { ok, findings } = lintCaption({ text, platform, rules })

if (ok) {
  console.log(`ok — clean for ${platform}`)
  process.exit(0)
}
for (const f of findings) console.error(`[${f.ruleId}] ${f.message}${f.match ? `  (${f.match})` : ''}`)
process.exit(1)
