#!/usr/bin/env node
/**
 * Telling a person, once, that something needs them.
 *
 * WHY THIS EXISTS. Every alarm in this repo ends in a GitHub issue, and GitHub's own mail for a
 * failed scheduled workflow demonstrably does not reach anyone here — that is how five consecutive
 * red `author.yml` runs on 2026-09-04 went unnoticed until a person went looking. The issue is
 * still the record; this is the tap on the shoulder that sends someone to read it.
 *
 * TWO RULES, BOTH LEARNED FROM THE THING IT REPLACES:
 *
 * 1. IT NEVER THROWS. A notifier that fails the job it is reporting on is worse than the silence
 *    it replaces — it would turn a stalled publish into a red publish AND a lost alarm. Every path
 *    returns a boolean; nothing propagates.
 * 2. IT IS CALLED ON A TRANSITION, NOT ON A TICK. The watchdog runs half-hourly, so a five-hour
 *    outage must be two messages — raised, stood down — not ten. That decision belongs to the
 *    caller, which is why this module has no memory of its own: `watchdog.yml` sends only on
 *    `gh issue create`, never on a comment.
 *
 * Zero npm dependencies, like the rest of the publisher, so there is no install step to fail.
 *
 *   node publish/notify.mjs --test
 */

import { pathToFileURL } from 'node:url'
import { isTransient, withRetry } from './retry.mjs'

/** Telegram rejects the whole message above this, so a long backlog must not cost the alarm. */
export const TELEGRAM_LIMIT = 4096

const TRUNCATION_NOTE = '\n\n… truncated; the issue has the rest.'

/**
 * The alarm bodies are written by `watchdog-plan.mjs` as markdown for a GitHub issue. Telegram
 * shows those characters literally unless a `parse_mode` is set, and escaping for MarkdownV2 is
 * its own class of bug — a stray `.` or `-` in a post id is enough to make the API refuse the
 * whole message. Stripping the markers is the version that cannot fail.
 */
export function toPlainText(markdown) {
  return String(markdown ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
}

/** @returns {{chat_id: string, text: string, disable_web_page_preview: boolean}} */
export function buildPayload({ chatId, text }) {
  const flat = toPlainText(text)
  const body =
    flat.length <= TELEGRAM_LIMIT
      ? flat
      : `${flat.slice(0, TELEGRAM_LIMIT - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`
  return { chat_id: chatId, text: body, disable_web_page_preview: true }
}

/**
 * @param {{text: string, token?: string, chatId?: string, fetchImpl?: Function, sleep?: Function}} input
 * @returns {Promise<boolean>} whether the message was accepted. Never throws.
 */
export async function notify({
  text,
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  fetchImpl = fetch,
  sleep,
} = {}) {
  // Not an error. The secrets may legitimately not be set yet, and a workflow that goes red
  // because nobody has made a bot is a worse outcome than an alarm that only reaches the issue.
  if (!token || !chatId) {
    console.warn('notify: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is unset; not sending.')
    return false
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildPayload({ chatId, text })),
  }

  try {
    // Retry the NETWORK only. A 400 is an answer — a bad chat id repeats identically however
    // often it is asked, and re-sending it only burns the rate limit.
    const res = await withRetry(
      async () => {
        const r = await fetchImpl(url, init)
        if (!r.ok) {
          const detail = await r.json().catch(() => ({}))
          // Deliberately not a transient error, so withRetry rethrows it immediately.
          throw new Error(`Telegram refused: HTTP ${r.status} ${detail?.description ?? ''}`.trim())
        }
        return r
      },
      sleep ? { sleep } : {},
    )
    return Boolean(res)
  } catch (err) {
    // The last line of defence. Whatever happened, the caller must carry on.
    console.error(`notify: could not send — ${err.message}${isTransient(err) ? ' (network)' : ''}`)
    return false
  }
}

/**
 * The CLI. Two shapes:
 *
 *   node publish/notify.mjs --test        prove the channel works, end to end
 *   ... | node publish/notify.mjs         send whatever is on stdin
 *
 * GUARDED ON `isMain`. `publish.mjs` runs main() on import and therefore cannot be tested —
 * `route.mjs` exists only to carve a testable piece back out of it. This module must not repeat
 * that: without the guard, importing it from a test reads the test runner's own stdin.
 *
 * The stdin form ALWAYS exits 0. Its only callers are the `if: failure()` steps and the
 * watchdog's alarm step, which have already decided the run is bad — a notifier that turned a
 * reported failure into a second failure would be the bug this whole file exists to avoid.
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv[2] === '--test') {
  const stamp = new Date().toISOString()
  const ok = await notify({ text: `FEL alarm channel test — ${stamp}. If you can read this, it works.` })
  console.log(ok ? 'sent.' : 'not sent; see the warning above.')
  process.exit(ok ? 0 : 1)
} else if (isMain && !process.stdin.isTTY) {
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(0, 'utf8').trim()
  if (text) await notify({ text })
  else console.warn('notify: nothing on stdin; not sending.')
  process.exit(0)
}
