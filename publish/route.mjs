/**
 * Which publisher a strategy belongs to.
 *
 * Its own module because publish.mjs runs main() on import and so cannot be
 * tested, and because the answer for TikTok is "not this process at all".
 */

/**
 * @param {string} strategy
 * @returns {'instagram'|'fb-story'} throws for anything the routine must not send
 */
export function routeFor(strategy) {
  if (strategy?.startsWith('tiktok')) {
    throw new Error(
      `"${strategy}" cannot be published by the routine — the TikTok token never leaves the author's machine. ` +
        'Run it during the authoring pass: node publish/tiktok-draft.mjs --manifest <path>',
    )
  }
  if (strategy === 'fb-story') return 'fb-story'
  if (strategy === 'ig-feed' || strategy === 'ig-story' || strategy === 'ig-reel') return 'instagram'

  throw new Error(`"${strategy}" has no publisher here; it is scheduled at authoring time, not by the routine.`)
}
