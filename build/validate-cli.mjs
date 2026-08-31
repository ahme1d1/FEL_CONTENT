#!/usr/bin/env node
/** Validates every manifest passed on the command line, or all of manifests/. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { validateManifest } from './manifest-schema.mjs'

const args = process.argv.slice(2)
const files = args.length
  ? args
  : readdirSync('manifests').filter((f) => f.endsWith('.json')).map((f) => join('manifests', f))

if (!files.length) {
  console.log('No manifests to validate.')
  process.exit(0)
}

let bad = 0
for (const file of files) {
  const findings = validateManifest(JSON.parse(readFileSync(file, 'utf8')))
  if (!findings.length) {
    console.log(`ok   ${file}`)
    continue
  }
  bad += 1
  console.error(`FAIL ${file}`)
  for (const f of findings) console.error(`       [${f.ruleId}] post ${f.post}: ${f.message}`)
}
process.exit(bad ? 1 : 0)
