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
| `.github/workflows/author.yml` | **the routine that writes the week** — author, render, push, schedule |
| `.github/workflows/publish.yml` | the routine that publishes what is due, eight times a day |
| `build/author-cli.mjs` | **writes the manifest** from the live API and the calendar |
| `build/current-gw-cli.mjs` | which gameweeks to author, worked out from public `/fixtures` |
| `build/author/calendar.json` | which card goes out at which slot on which day |
| `build/author/caption-templates.json` | every caption; none is left for a human |
| `build/copy-rules.json` | the linter's rules — check against real posts before blaming a template |
| `build/author/copy.json` | the fixed words a card carries: ordinals, day names, clock phrases |
| `build/copy-rules.json` | voice and forbidden-claims rules, mirroring `content-design-kit.md` §2 and §5 |
| `build/lint-copy.mjs` | caption linter |
| `build/manifest-schema.mjs` | manifest validator, including the Cairo slot and aspect-ratio guards |
| `build/render-manifest.mjs` | renders the cards and stamps `media` back into the manifest |
| `publish/publish.mjs` | the publisher a cloud routine runs eight times a day |
| `publish/schedule-facebook.mjs` | hands the Facebook posts to Meta's own scheduler, run by `author.yml` |
| `publish/wait-media.mjs` | blocks until Pages actually serves the media Meta is about to fetch |
| `publish/tiktok-auth-cli.mjs` | one-time TikTok authorization, run by hand |
| `publish/tiktok-draft.mjs` | sends a video to the TikTok drafts inbox, run by hand |
| `publish/ledger.jsonl` | append-only record of what actually went out |

## Commands

```bash
npm test                                    # 277 unit tests, no network, no accounts
node build/current-gw-cli.mjs               # which gameweeks are worth authoring right now
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
author  ->  render  ->  push  ->  Pages  ->  schedule (Facebook)  ->  the routine (Instagram)
└──────────────── author.yml, every two hours ─────────────────┘   └── publish.yml, 8×/day ──┘
```

**Nobody runs any of this.** `author.yml` performs the first five moves and `publish.yml` the
last. The order inside the first workflow is fixed and load-bearing: Meta schedules a Facebook
post by **URL**, so the media has to be committed *and* served by Pages before Meta is told about
it — `wait-media.mjs` is that barrier, and it verifies the sha256 rather than settling for a 200,
which also catches Pages still serving the previous build.

The commands below are how you drive it by hand when you want to look before it does.

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

**Every caption is templated, the settle-day four included.** The winner, the player of the round,
the team of the week and the top-players post came back `null` with a brief until 2026-09-02, on
the reasoning that a post naming a real person is taste. **The naming was never needed.**
`content-design-kit.md` §2 rule 2 forbids a caption restating what the card carries, and the card
already carries every name, club and score — so the caption carries the *stake* instead, and a
caption that names nobody is one a template can write. That is what lets a settled round publish
with nobody awake.

`--captions <file>` still overrides a generated caption for a week that deserves better words, and
an override is linted exactly like a template. `due.mjs` and `schedule-plan.mjs` both hold a post
carrying no caption at all rather than send a bare image.

**A manager's team name goes onto the card verbatim** — including `My FEL Team`, which the style
guide would reject in our own copy. `review.mjs` prints a warning so a surprising name is visible
in the log, and gates nothing: the rule governs what *we* write, not what a manager called their
team, and holding back a winner's podium over it would be worse than printing it.

**Cards it cannot fill are skipped by name, with the reason.** A results card for a day that has
not been played, a winner for a round that has not settled: both are answers, not failures.

**The player cards need `GET /gameweeks/:gw/top-players`**, which is deployed on prod and public —
verified 2026-09-02, GW2 returns 200 to an anonymous caller. What it refuses is an *unsettled*
round, with `GAMEWEEK_NOT_SETTLED`, because bonus points are entered by hand and a pre-settlement
total would be provisional. So the author says `topPlayers: GAMEWEEK_NOT_SETTLED` and skips those
cards mid-round, then picks them up on the re-run after the round settles. That is the loop
working, not a deployment gap.

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
instant and the epoch for every post, which is where a timezone mistake becomes visible.

**`author.yml` runs it now**, which it did not before 2026-09-02. The old reasoning was that Meta
holds the queue once it is handed over, so there is nothing for a cron to keep doing — true of a
*finished* manifest, and false of this one: a gameweek's manifest keeps growing as results land
and the round settles, so there is always a next batch nobody has handed over. Running it every
pass is safe because the ledger records a `scheduled` state per post, and `schedule-plan.mjs`
skips anything already carrying one.

## The calendar

**The day starts at noon** (owner call, 2026-09-02). `SLOTS_CAIRO` is `12:00 13:00 14:00 16:00
20:00 22:30`, and `publish.yml`'s six crons fire on exactly those times — **change the two
together**, or a slot has no routine behind it and its posts wait for the next one.

| day role | slots |
|---|---|
| build-up | 20:00 build-up |
| middle | 12:00 prices · 14:00 league table · 20:00 captain poll |
| deadline day | 12:00 matchday · 14:00 deadline · 22:30 results |
| match day | 12:00 matchday · 22:30 results |
| settle day | **12:00 winner + shirt** · 13:00 podium · 14:00 player of the round · 16:00 team of the week · 20:00 top players |

The settle day leads with the prize post, because that is the one the audience waits for. Note
that **12:00 is noon, eleven hours after the ~01:00 settlement run** — not before it. Nothing can
jump the gun even if the clock slips: the winner and podium builders both gate on `topPlayers`,
whose endpoint 404s `GAMEWEEK_NOT_SETTLED` until bonus points are in, which is the API's own
signal that a round is final. `/gameweeks/:gw/standings` is NOT that signal — it answers from live
ranks mid-round, and authoring against it named the current leader as champion.

An earlier slot was considered and rejected on mechanics: the authoring workflow's nearest run is
01:20 Cairo, it needs 5–8 minutes to render and push, and Meta refuses anything scheduled less
than ten minutes ahead. 02:30 is the earliest that would work at all.

## Captions

Two registers, split by what a post is FOR. **Engagement** posts close on a question — matchday,
matchdayFinal, question, podium, playerOfRound, teamOfWeek, topPlayers. **Informational** posts
state and point forward — buildUp, deadline, priceChanges, leagueTable, results, resultsFinal,
winner. `captions.mjs` holds the list and lifts the linter's trailing-question ban for the first
group only, because that ban is a property of the post's kind, not the platform.

**The house voice is read off the page, not out of a style guide.** Two caption sets were written
from `content-design-kit.md` §6 and both were rejected as not sounding like anyone. The fix was to
pull the page's own published captions:

```
COMPOSIO_MULTI_EXECUTE_TOOL -> FACEBOOK_GET_PAGE_POSTS
  { page_id: "1236455056218105", limit: 40, fields: "id,message,created_time,permalink_url" }
```

One or two lines, **one** emoji at the end of a line, plain and conversational. A linter rule was
fighting exactly that: `facebook.minEmoji` was 2, so a caption the page writes as one line had a
second line invented to carry a second emoji. **Check copy-rules.json against real posts before
blaming the templates.** The archive also settles rules by evidence — 👇 and ownership percentages
are all over the August posts and appear in none from 30 Aug on, so both stay retired.

Captions interpolate real values, because a line that would read the same in any gameweek is the
failure this replaced: `{matches}` `{these}` `{remaining}` `{rounds}` `{deadline}` `{gw}`
`{winner}` `{untilDeadline}`. Arabic counts one and two in the noun, so these are pluralised in
`plan.mjs` and never with a bare numeral. `{untilDeadline}` is computed per post — «الديدلاين كمان
ساعتين» is true at 14:00 against a 16:00 deadline and six hours wrong in GW18, whose deadline is
20:30.

The prize post is the one caption that names a person: «مبروك يا مراد 🏆». Congratulating an
unnamed person is not a congratulation.

## TikTok

**TikTok is vertical.** Every kind it posts takes a 1080 × 1920 story card — see `STORY_BUILDERS`
in `plan.mjs`. It was being handed the same 4:5 feed image as Facebook until 2026-09-02.

That was blocked on the card tool: the base matchday story card holds **eight** fixture rows and a
matchday never has more than four, and an unset slot does not go blank — it publishes the design's
own sample fixture with a crest off a rotating guess list. `ROW_VARIANTS` in `build-cards.py` now
derives short variants of both story cards, so the tool ships **48 cards, not 43**.

Regenerating it needs the Claude Design source, which **cannot be fetched through DesignSync** —
`get_file` caps at 256 KiB and `FEL Social Cards.dc.html` is 305,559 bytes, so it truncates
silently into a card-less build. The owner exports it by hand. **Verify any rebuild by first
building with the unchanged config and confirming the same card keys come back** — that is what
proves it is the right file.

A story builder returns `null` where no layout of that shape exists (a single-fixture day has
none) and the caller falls back to the feed image rather than inventing one.

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
