#!/usr/bin/env node
/**
 * The authoring pass, as a command.
 *
 *   node build/author-cli.mjs --gameweek 4
 *   node build/author-cli.mjs --gameweek 4 --snapshot /tmp/gw04.json --dry-run
 *   node build/author-cli.mjs --gameweek 4 --data /tmp/gw04.json --captions gw04-captions.json
 *
 * It writes `manifests/gwNN.json` with `media: null` on every post, which is exactly what
 * `render-manifest.mjs` expects and exactly what `validateManifest` rejects until it has run —
 * so an un-rendered manifest can never publish, by construction.
 *
 * Running it twice is the normal loop, not a mistake. Everything that needs no match results is
 * authored first; the results cards land a day at a time as the scores come in. A re-run merges:
 * a post that already exists keeps its stamped media and its written caption.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateManifest } from './manifest-schema.mjs'
import { applyHumanCaptions, missingCaptions } from './author/captions.mjs'
import { buildManifest, mergePosts, planPosts } from './author/plan.mjs'
import { DEFAULT_API_BASE, apiReader, fetchGameweekData } from './author/sources.mjs'
import { reviewUserContent } from './author/review.mjs'
import { contentWindow } from './author/window.mjs'

function parseArgs(argv) {
  const args = {
    gameweek: null,
    out: null,
    data: null,
    snapshot: null,
    captions: null,
    now: null,
    apiBase: DEFAULT_API_BASE,
    refresh: false,
    dryRun: false,
    allowMissingCaptions: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--refresh') args.refresh = true
    else if (flag === '--allow-missing-captions') args.allowMissingCaptions = true
    else if (flag === '--gameweek') args.gameweek = Number(value())
    else if (flag === '--out') args.out = value()
    else if (flag === '--data') args.data = value()
    else if (flag === '--snapshot') args.snapshot = value()
    else if (flag === '--captions') args.captions = value()
    else if (flag === '--now') args.now = value()
    else if (flag === '--api-base') args.apiBase = value()
    else throw new Error(`Unknown argument "${argv[i]}".`)
  }
  if (!Number.isInteger(args.gameweek) || args.gameweek < 1) {
    throw new Error('--gameweek <n> is required.')
  }
  args.out ??= `manifests/gw${String(args.gameweek).padStart(2, '0')}.json`
  return args
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const data = args.data
    ? readJson(args.data)
    : await fetchGameweekData({
        gameweek: args.gameweek,
        read: apiReader({ base: args.apiBase }),
      })
  if (args.snapshot) {
    writeJson(args.snapshot, data)
    console.log(`snapshot -> ${args.snapshot}`)
  }
  for (const note of data.notes ?? []) console.log(`  note: ${note}`)

  const window = contentWindow({
    gameweek: args.gameweek,
    fixtures: data.fixtures,
    previousFixtures: data.previousFixtures,
  })

  const existing = existsSync(args.out) ? readJson(args.out) : null
  // The original stands: it is already earlier than every post that survived, and moving it
  // forward would invalidate every one of them.
  const authoredAt = existing?.authoredAt ?? args.now ?? new Date().toISOString()
  const planningAt = args.now ?? new Date().toISOString()

  const { posts: fresh, skipped } = planPosts({ window, data, authoredAt: planningAt })
  const merged = mergePosts({ existing: existing?.posts ?? [], fresh, refresh: args.refresh })

  let posts = merged.posts
  if (args.captions) {
    const applied = applyHumanCaptions({ posts, captions: readJson(args.captions) })
    if (applied.findings.length) {
      console.error(`\n${args.captions} does not pass the linter:`)
      for (const f of applied.findings) console.error(`  ${f.id}  [${f.ruleId}] ${f.message}`)
      process.exit(1)
    }
    posts = applied.posts
  }

  const manifest = buildManifest({ gameweek: args.gameweek, authoredAt, posts })

  console.log(`\ngameweek ${args.gameweek} — ${posts.length} post(s), deadline ${window.deadline}`)
  for (const post of posts) {
    const card = post.source?.card ?? post.source?.composition ?? 'none'
    const state = post.media ? 'rendered' : 'to render'
    console.log(`  ${post.slotCairo}  ${post.id.padEnd(24)} ${card.padEnd(24)} ${state}`)
  }

  for (const id of merged.added) console.log(`  + ${id}`)
  for (const { id, reason } of skipped) console.log(`  - ${id}: ${reason}`)
  for (const id of merged.drifted) {
    console.warn(`  ! ${id} was authored from data that has since changed; --refresh to replace it`)
  }

  // Text a manager typed, going onto a card verbatim. Nothing here can be fixed automatically —
  // it is a real person's team name — so it is surfaced while there is still time to decide.
  const rules = JSON.parse(readFileSync(fileURLToPath(new URL('./copy-rules.json', import.meta.url)), 'utf8'))
  for (const w of reviewUserContent({ posts, rules })) {
    console.warn(`  ! ${w.id} t${w.slot} "${w.text}" — ${w.reason}`)
  }

  // Everything except a null `media`, which is what render-manifest.mjs is for.
  const findings = validateManifest(manifest).filter((f) => f.ruleId !== 'missing-media')
  if (findings.length) {
    console.error('\nThe authored manifest does not validate:')
    for (const f of findings) console.error(`  [${f.ruleId}] post ${f.post}: ${f.message}`)
    process.exit(2)
  }

  const unwritten = missingCaptions(posts)
  if (unwritten.length) {
    console.error(`\n${unwritten.length} caption(s) are the human's to write:`)
    for (const id of unwritten) {
      console.error(`  ${id}\n      ${posts.find((p) => p.id === id).captionBrief}`)
    }
    console.error('\nWrite them into a JSON file keyed by post id and pass --captions,')
    console.error('or pass --allow-missing-captions to write the manifest anyway.')
    if (!args.allowMissingCaptions) {
      if (!args.dryRun) console.error(`\n${args.out} was NOT written.`)
      process.exit(1)
    }
  }

  if (args.dryRun) {
    console.log('\nDRY RUN — nothing written.')
    return
  }

  writeJson(args.out, manifest)
  console.log(`\nwrote ${args.out}`)
  console.log(`next: npm run render -- ${args.out}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
