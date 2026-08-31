/**
 * Append-only record of what actually went out.
 *
 * One JSON object per line. The ordering rule is the whole point: a `claimed`
 * record is written and flushed BEFORE the first platform call, so a crash
 * mid-call leaves "possibly missing, alerted" rather than "possibly duplicated".
 * On a public brand account a duplicate is much worse than a miss.
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'

/** @returns {Array<object>} every record, oldest first; empty if the file is absent. */
export function readLedger(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line)
      } catch (cause) {
        throw new Error(`Ledger ${path} line ${i + 1} is not JSON: ${line.slice(0, 80)}`, { cause })
      }
    })
}

/**
 * Append one record and flush it to disk before returning. Without the fsync a
 * crash could lose the claim we are about to rely on.
 */
export function appendLedger(path, record) {
  const line = `${JSON.stringify(record)}\n`
  const fd = openSync(path, 'a')
  try {
    writeSync(fd, line)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return record
}

export const record = (id, state, extra = {}) => ({
  ts: new Date().toISOString(),
  id,
  state,
  ...extra,
})
