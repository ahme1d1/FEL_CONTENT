# fel-content

Social content for [Fantasy EG](https://fantasyeg.com): the weekly plan, the rendered media,
and the publisher. Separate from `FEL_WEBSITE` so that no image, video or ledger entry ever
lands in the product's Docker image or its git history.

This repo is public for two reasons, both structural:

- **Instagram can only fetch media from a public HTTPS URL**, and TikTok's `PULL_FROM_URL`
  needs a domain we own and have verified. GitHub Pages serves this repo at
  `media.fantasyeg.com` with a free certificate, which satisfies both.
- **Public repos get unmetered GitHub Actions**, so every manifest and caption is validated
  on every pull request at no cost.

Nothing secret lives here. Meta credentials come from a Composio connector attached to the
publishing routine; TikTok tokens never leave the author's machine.

## Layout

| path | what |
|---|---|
| `manifests/gwNN.json` | the week's plan, reviewed as a diff before anything publishes |
| `gwNN/` | rendered media, served by Pages, content-addressed by sha256 |
| `build/author-cli.mjs` | **writes the manifest** from the live API and the calendar |
| `build/author/calendar.json` | which card goes out at which slot on which day |
| `build/author/caption-templates.json` | captions for the posts whose copy is mechanical |
| `build/author/copy.json` | the fixed words a card carries: ordinals, day names, clock phrases |
| `build/copy-rules.json` | voice and forbidden-claims rules, mirroring `content-design-kit.md` §2 and §5 |
| `build/lint-copy.mjs` | caption linter |
| `build/manifest-schema.mjs` | manifest validator, including the Cairo slot and aspect-ratio guards |
| `build/render-manifest.mjs` | renders the cards and stamps `media` back into the manifest |
| `publish/publish.mjs` | the publisher a cloud routine runs eight times a day |
| `publish/schedule-facebook.mjs` | hands the Facebook posts to Meta's own scheduler, run by hand |
| `publish/tiktok-auth-cli.mjs` | one-time TikTok authorization, run by hand |
| `publish/tiktok-draft.mjs` | sends a video to the TikTok drafts inbox, run by hand |
| `publish/ledger.jsonl` | append-only record of what actually went out |

## Commands

```bash
npm test                                    # 250+ unit tests, no network, no accounts
node build/author-cli.mjs --gameweek 4      # write manifests/gw04.json from the live API
npm run render -- manifests/gw04.json       # render the cards, stamp media, re-validate
node build/validate-cli.mjs                 # validate every manifest
node build/lint-copy-cli.mjs instagram "…"  # lint one caption
node publish/schedule-facebook.mjs --manifest manifests/gw04.json --dry-run
node publish/publish.mjs --manifest fixtures/gw03.json --dry-run --now 2026-09-03T08:00:00Z
node publish/tiktok-draft.mjs --file ../FEL_VIDEO/out/ad-full.mp4 --dry-run
```

## The authoring pass

A gameweek goes out in four moves. Only the third touches an account.

```
author  ->  render  ->  schedule (Facebook)  ->  the routine (Instagram, stories)
```

**`build/author-cli.mjs` writes the plan.** It reads the public API — no token, no account,
nothing written — works out the gameweek's content window from its fixtures, fills each card's
slots with real data and picks a caption. It leaves `media: null`, which is exactly what
`render-manifest.mjs` fills and exactly what `validateManifest` rejects until it has, so an
un-rendered manifest cannot publish by construction.

```bash
node build/author-cli.mjs --gameweek 4 --snapshot /tmp/gw04.json --dry-run   # look first
node build/author-cli.mjs --gameweek 4                                       # write it
npm run render -- manifests/gw04.json
```

**Running it twice is the normal loop, not a mistake.** Everything that needs no match results is
authored days ahead; the results cards land one at a time as the scores come in. A re-run merges —
a post that already exists keeps its stamped media and its written caption — and reports any post
whose data has changed underneath it rather than quietly replacing it. `--refresh` replaces those.

**`--data` authors from a saved snapshot** instead of the network, which makes a manifest
reproducible and lets the whole thing be re-run without touching prod.

**Some captions are not the author's to write.** The winner, the player of the round, the team of
the week and the top-players post all name a real person, so the author emits `caption: null` and
a `captionBrief`, and refuses to write the manifest until someone answers. Write them into a JSON
file keyed by post id and pass `--captions`; they go through the same linter as generated copy.
`--allow-missing-captions` overrides, and `schedule-facebook.mjs` still refuses to send one.

**Cards it cannot fill are skipped by name, with the reason.** A results card for a day that has
not been played, a winner for a round that has not settled: both are answers, not failures.

**It warns about text it did not write.** A manager's team name goes onto the podium card
verbatim, and GW2's real top three contains `My FEL Team` — the wordmark retired from every
user-facing surface on 2026-08-25. Nothing can fix that automatically, so it is printed while
there is still time to decide whether to post the card at all.

**The player cards need `GET /gameweeks/:gw/top-players`**, which is new server surface in
`../FEL_API`. Until that is deployed the author says
`topPlayers: not served by …` and skips the three cards that need it.

## Scheduling the Facebook half

`due.mjs` skips `fb-scheduled` and `fb-text` because Meta schedules those natively "during the
authoring pass" — and until now nothing performed that pass but a curl typed by hand.
`publish/schedule-facebook.mjs` does, with the same ledger discipline the routine uses, so the two
can never post the same thing twice.

```bash
node publish/schedule-facebook.mjs --manifest manifests/gw04.json --dry-run
printf '%s' "$FB_PAGE_TOKEN" | node publish/schedule-facebook.mjs --manifest manifests/gw04.json
```

It writes `published=false` with a `scheduled_publish_time`, so posts land in the Page's Planner
and stay editable until they go out. Read a dry run first: it prints the Cairo reading, the UTC
instant and the epoch for every post, which is where a timezone mistake becomes visible. It is not
in CI — Meta holds the queue once it is handed over, so there is nothing for a cron to keep doing.

## TikTok

Composio has no managed auth for TikTok, so the OAuth lives here. Authorize once:

```bash
export TIKTOK_CLIENT_KEY=aw1a…
export TIKTOK_CLIENT_SECRET=…
npm run tiktok:auth
```

There is no local callback server because there cannot be one — TikTok only registers
redirect URIs that are absolute HTTPS, so `http://localhost` is rejected outright. The
browser lands on `https://fantasyeg.com/tiktok/callback`, which does not need to exist; a
404 still carries `?code=` in the address bar, and you paste that address back.

**The refresh token rotates on nearly every use and retires the one you sent.** Losing the
new one cannot be repaired, only reauthorized, so `publish/.tiktok-token.json` is written
atomically — temp file, fsync, rename, fsync the directory — and the access token is never
handed to a caller until that write has succeeded. It is gitignored and mode 0600.

Two consequences of Direct Post being off, both deliberate:

- Everything goes to the **drafts inbox**, so the only scopes needed are `user.info.basic`
  and `video.upload` and the app faces no audit. A draft's terminal state is
  `SEND_TO_USER_INBOX`, not `PUBLISH_COMPLETE` — the latter arrives only if a human opens
  the notification and posts it.
- **The caption does not travel.** The inbox endpoint accepts the file and nothing else, so
  `tiktok-draft.mjs` prints the manifest's caption at the end for you to paste.

### The app must be a Sandbox until it passes review

This is the part that costs a day if you do not know it. A **production app in Draft cannot
authorize a user at all**, and the error page does not say so - it says:

> If you're a developer, correct the following and try again: **client_key**

The key is fine. That message means *the TikTok account signing in is not allowed to use an
unreviewed app*. It is what defeated the earlier attempt to route this through Composio, which
was misread at the time as a Composio workspace problem.

The fix is TikTok's **Sandbox**, which exists for exactly this:

1. App page -> **Sandbox** tab -> **Create Sandbox**, cloning the production config.
2. Re-add the redirect URI - **cloning does not carry it over.**
3. **Sandbox settings -> Target Users -> Add account**, signing in as the account the drafts
   should land in. Up to 10. Only a listed account can approve.
4. Use the **sandbox** credentials (`sbaw...`), not production's (`aw1a...`).

Two things worth knowing, both verified rather than assumed:

- **The sandbox uses the same hosts as production** - `www.tiktok.com/v2/auth/authorize/` and
  `open.tiktokapis.com`. There is no separate base URL, whatever you may read elsewhere.
- **Sandbox blocks the Content Posting API for *public* videos, but not for drafts.** The path
  in this repo is the one sandbox still allows, which is why it can be proven before review.

Production credentials are kept in `.env.tiktok` alongside the sandbox pair, for the day the app
is approved; switching environments is a two-line edit and no code change.

**Status: submitted for review on 2026-09-01**, with a demo video recorded from this sandbox.
Until it is approved, only accounts listed as Target Users can authorise the app.

One limit worth knowing before testing: TikTok counts an upload as *pending* until the creator
actually **posts** it. Discarding a draft does not clear the counter, so a run of test uploads
eventually returns `spam_risk_too_many_pending_share`. Post one, or wait.

Uploads use `FILE_UPLOAD` rather than `PULL_FROM_URL`. The latter needs both a valid
certificate on `media.fantasyeg.com` and the domain verified in TikTok's portal; sending the
bytes from this machine needs neither, and matches where the token already lives.

## Two things that are easy to get wrong

**Times are absolute.** `publishAt` is a UTC instant, converted once from the Cairo wall clock
at authoring time. Cairo drops from UTC+3 to UTC+2 on **2026-10-29**, around GW9. The publisher
does no timezone arithmetic, so that change shows up as a reviewed diff rather than as every
post silently moving by an hour.

**A duplicate is worse than a miss.** The publisher writes a `claimed` record and flushes it
before the first platform call. If it then dies, the next run reports the post as needing
reconciliation and refuses to re-post it.
