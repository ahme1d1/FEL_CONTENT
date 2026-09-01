/**
 * Calling Composio from a standalone script.
 *
 * The publisher runs as a plain Node process, so it cannot use the MCP tools an
 * interactive session has. Composio's REST API is the same thing over HTTPS,
 * and it needs one credential: COMPOSIO_API_KEY, kept beside the TikTok pair in
 * a gitignored file and never committed.
 *
 * Zero npm dependencies, and retried on the network only, like every other
 * request this repo makes.
 */

import { withRetry } from './retry.mjs'

export const COMPOSIO_API = 'https://backend.composio.dev/api/v3'

/**
 * @param {{apiKey: string, connectedAccountId?: string, userId?: string}} auth
 * @returns {({tool: string, args: object}) => Promise<{successful: boolean, data?: object, error?: string}>}
 */
export function composioExecute({ apiKey, connectedAccountId, userId }) {
  if (!apiKey) throw new Error('COMPOSIO_API_KEY is required to publish through Composio.')

  return ({ tool, args }) =>
    withRetry(
      async () => {
        const body = { arguments: args }
        if (connectedAccountId) body.connected_account_id = connectedAccountId
        if (userId) body.user_id = userId

        const res = await fetch(`${COMPOSIO_API}/tools/execute/${tool}`, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))

        // Composio reports failure in the body, so a non-2xx with no body is the
        // only case the status code has to answer for.
        if (!res.ok && json?.successful === undefined) {
          throw new Error(`Composio ${tool} failed: HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
        }
        return json
      },
      { onRetry: ({ attempt, attempts, delay, error }) =>
          console.error(`    ${tool} — ${error.cause?.code ?? error.message}; retry ${attempt}/${attempts - 1} in ${delay / 1000}s`) },
    )
}
