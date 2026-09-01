#!/usr/bin/env node
/**
 * Prints the gameweeks a routine should author, one per line.
 *
 *   node build/current-gw-cli.mjs              # e.g. "3\n4"
 *   node build/current-gw-cli.mjs --running    # just the running one
 *
 * Exists so the authoring workflow can ask rather than be told. `GET /gameweeks/current` needs a
 * JWT; `GET /fixtures` does not, and carries everything the answer needs. See current-gw.mjs.
 *
 * Prints nothing and exits 0 when the season has finished: no round is running, so there is
 * nothing to author, and that is an answer rather than a failure.
 */

import { DEFAULT_API_BASE, apiReader } from './author/sources.mjs'
import { gameweeksToAuthor, runningGameweek } from './author/current-gw.mjs'

function parseArgs(argv) {
  const args = { apiBase: DEFAULT_API_BASE, runningOnly: false }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--running') args.runningOnly = true
    else if (flag === '--api-base') args.apiBase = value()
    else throw new Error(`Unknown argument "${argv[i]}".`)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const read = apiReader({ base: args.apiBase })

  // No `gw` param returns the whole season. The cap is 400 fixtures and a 20-club single
  // round-robin is 190, so nothing is truncated.
  const data = await read('/fixtures')
  const fixtures = Array.isArray(data) ? data : (data?.data ?? [])
  if (!fixtures.length) throw new Error('GET /fixtures returned no fixtures; refusing to guess.')

  const answer = args.runningOnly
    ? [runningGameweek(fixtures)].filter((gw) => gw !== null)
    : gameweeksToAuthor(fixtures)

  for (const gw of answer) console.log(gw)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(2)
})
