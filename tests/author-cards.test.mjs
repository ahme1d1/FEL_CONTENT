import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  DRAWABLE_FORMATIONS,
  DRAWABLE_WINNER_FORMATIONS,
  deadlineCard,
  leagueTableCard,
  matchdayCard,
  playerOfRoundCard,
  podiumCard,
  priceChangesCard,
  questionCard,
  resultsCard,
  singleMatchCard,
  statCard,
  teamOfWeekCard,
  topPlayersCard,
  winnerCard,
} from '../build/author/cards.mjs'

const club = (id, short) => ({ id, short })
const fx = (home, away, kickoffAt, over = {}) => ({
  home,
  away,
  homeClub: club(home, { AHL: 'الأهلي', ZAM: 'الزمالك', PYR: 'بيراميدز', ENP: 'إنبي' }[home]),
  awayClub: club(away, { AHL: 'الأهلي', ZAM: 'الزمالك', PYR: 'بيراميدز', ENP: 'إنبي' }[away]),
  kickoffAt,
  status: 'SCHEDULED',
  homeScore: null,
  awayScore: null,
  ...over,
})
const player = (over = {}) => ({
  playerId: 1,
  name: 'إمام عاشور',
  club: 'AHL',
  pos: 'MID',
  points: 10,
  ...over,
})

const TWO = [fx('AHL', 'ZAM', '2026-09-07T14:00:00Z'), fx('PYR', 'ENP', '2026-09-07T17:00:00Z')]

/* ─────────────────────────── shapes ─────────────────────────── */

test('the matchday card lays a fixture out as home, kickoff, away from t2', () => {
  const s = matchdayCard({ gameweek: 4, fixtures: TWO })
  assert.equal(s.card, 'A_MATCHDAY_2_rows')
  assert.equal(s.texts[0], 'الجولة الرابعة')
  assert.deepEqual([s.texts[2], s.texts[3], s.texts[4]], ['الأهلي', '5:00', 'الزمالك'])
  assert.deepEqual([s.texts[5], s.texts[6], s.texts[7]], ['بيراميدز', '8:00', 'إنبي'])
  assert.deepEqual(s.assets, { 0: 'AHL', 1: 'ZAM', 2: 'PYR', 3: 'ENP' })
})

test('the row variant follows the number of fixtures, never a blanked row', () => {
  const four = [...TWO, fx('AHL', 'ENP', '2026-09-07T18:00:00Z'), fx('ZAM', 'PYR', '2026-09-07T19:00:00Z')]
  assert.equal(matchdayCard({ gameweek: 4, fixtures: four }).card, 'A_MATCHDAY_4_rows')
})

// 5, 6 and 7 rows were never built. Rendering one of them would leave a sample fixture on the card.
test('a fixture count with no card refuses instead of leaving sample rows on the design', () => {
  const five = [...TWO, ...TWO, TWO[0]]
  assert.throws(() => matchdayCard({ gameweek: 4, fixtures: five }), /No matchday card has 5 rows/)
})

test('one fixture becomes the single-match card, not a one-row matchday that does not exist', () => {
  assert.equal(matchdayCard({ gameweek: 4, fixtures: [TWO[0]] }).card, 'C_SINGLE_MATCH')
})

test('the results card straddles the locked separator, writing neither side of it', () => {
  const played = TWO.map((f) => ({ ...f, status: 'FINISHED', homeScore: 2, awayScore: 1 }))
  const s = resultsCard({ gameweek: 4, fixtures: played })
  assert.equal(s.card, 'B_RESULTS_2_rows')
  assert.deepEqual([s.texts[2], s.texts[3], s.texts[5], s.texts[6]], ['الأهلي', '2', '1', 'الزمالك'])
  assert.equal(s.texts[4], undefined, 't4 is the locked dash')
  assert.equal(s.texts[9], undefined, 't9 is the locked dash')
})

test('a goalless draw writes zeros rather than dropping the slot', () => {
  const played = TWO.map((f) => ({ ...f, status: 'FINISHED', homeScore: 0, awayScore: 0 }))
  const s = resultsCard({ gameweek: 4, fixtures: played })
  assert.equal(s.texts[3], '0')
  assert.equal(s.texts[5], '0')
})

test('the deadline card says the deadline out loud', () => {
  const s = deadlineCard({ gameweek: 4, deadline: '2026-09-07T13:00:00Z' })
  assert.deepEqual(s.texts, {
    0: 'الجولة الرابعة',
    1: 'الاتنين 4 العصر',
    2: 'آخر ميعاد لتغيير فريقك',
  })
})

test('a stat hero longer than the card can hold is refused', () => {
  assert.throws(
    () => statCard({ gameweek: 4, hero: 'ا'.repeat(20), support: 'x' }),
    /wraps past 16/,
  )
})

test('the question card shortens every name to fit the 284px box', () => {
  const s = questionCard({
    gameweek: 4,
    players: [
      player({ name: 'أحمد سيد زيزو' }),
      player({ name: 'وسام أبو علي', club: 'AHL' }),
      player({ name: 'محمد الشناوي' }),
      player({ name: 'مروان عطية' }),
    ],
  })
  assert.deepEqual([s.texts[2], s.texts[3], s.texts[4], s.texts[5]], [
    'زيزو',
    'أبو علي',
    'الشناوي',
    'عطية',
  ])
})

test('the top-players card takes ten rows when there are ten, three when there are not', () => {
  const many = Array.from({ length: 12 }, (_, i) => player({ playerId: i, points: 20 - i }))
  assert.equal(topPlayersCard({ players: many }).card, 'F1_TOP_PLAYERS_10_rows')
  assert.equal(topPlayersCard({ players: many.slice(0, 5) }).card, 'F1_TOP_PLAYERS_3_rows')
  assert.throws(() => topPlayersCard({ players: many.slice(0, 2) }), /3 or 10 rows/)
})

test('the top-players card numbers its own rows', () => {
  const s = topPlayersCard({ players: [player({ points: 14 }), player({ points: 12 }), player({ points: 11 })] })
  assert.deepEqual([s.texts[1], s.texts[4], s.texts[7]], ['1', '2', '3'])
  assert.deepEqual([s.texts[3], s.texts[6], s.texts[9]], ['14', '12', '11'])
})

test('the podium leads with the manager, and carries the team name it was given', () => {
  const s = podiumCard({
    gameweek: 4,
    rows: [
      { name: 'محمد عبد الرحمن', teamName: 'فريق النسور', gwPts: 87 },
      { name: 'أحمد سامي', teamName: 'الملوك', gwPts: 84 },
      { name: 'كريم الشناوي', teamName: 'ريد ديفيلز', gwPts: 81 },
    ],
  })
  assert.deepEqual([s.texts[2], s.texts[3], s.texts[4], s.texts[5]], ['1', 'فريق النسور', 'محمد عبد الرحمن', '87'])
  assert.equal(s.texts[13], '81')
})

test('the league table writes eight rows of rank, club, played, points', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    club: 'AHL',
    clubShort: 'الأهلي',
    p: 8,
    pts: 22 - i,
  }))
  const s = leagueTableCard({ rows })
  assert.deepEqual([s.texts[3], s.texts[4], s.texts[5], s.texts[6]], ['1', 'الأهلي', '8', '22'])
  assert.equal(s.texts[34], '15', 'the eighth row ends at t34')
  assert.equal(s.texts[35], undefined, 't35 is the wordmark')
})

const move = (change, price = 10.7) => ({ name: 'إمام عاشور', club: 'AHL', price, change })
const EIGHT_MOVES = [...Array.from({ length: 5 }, () => move(0.2)), ...Array.from({ length: 3 }, () => move(-0.1))]

test('a price move is written old then new, derived from the change the API reports', () => {
  const s = priceChangesCard({ changes: EIGHT_MOVES })
  assert.equal(s.texts[2], '10.5')
  assert.equal(s.texts[4], '10.7')
})

// The arrows are painted into the design per row, not derived from the numbers. Row 4 is a red
// down arrow whatever you put beside it, so a riser there renders as a fall.
test('rows follow the card fixed up-down pattern, not the order the API returned', () => {
  const changes = [
    ...Array.from({ length: 5 }, (_, i) => move(0.2, 10 + i)),
    ...Array.from({ length: 3 }, (_, i) => move(-0.1, 5 + i)),
  ]
  const s = priceChangesCard({ changes })
  const rose = (row) => Number(s.texts[4 + 4 * row]) > Number(s.texts[2 + 4 * row])

  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(rose), [true, true, true, false, false, true, false, true])
})

test('too few of either direction is refused rather than mismatching an arrow', () => {
  assert.throws(
    () => priceChangesCard({ changes: Array.from({ length: 8 }, () => move(0.2)) }),
    /5 risers and 3 fallers/,
  )
  assert.throws(() => priceChangesCard({ changes: EIGHT_MOVES.slice(0, 4) }), /5 risers and 3 fallers/)
})

// Owner call, 2026-09-04: the wide cards carry the FULL name. Rule 9's 284px box is the one under
// a shirt, and this card's name is a hero, not a shirt label — its own template ships
// «أحمد سيد زيزو» in full. `shortName` is untouched and still what the shirt cards use.
test('the player of the round names his club in words and his points as a number', () => {
  const s = playerOfRoundCard({
    player: { name: 'أحمد سيد زيزو', club: 'AHL', clubShort: 'الأهلي', points: 14 },
  })
  assert.deepEqual(s.texts, {
    0: 'أعلى نقط الجولة',
    1: 'أحمد سيد زيزو',
    2: 'الأهلي',
    3: '14',
    4: 'نقطة',
  })
})

// The budget still bites. A name past it falls back to the last name rather than overflowing the
// slot, which is rule 9 doing the job it was written for.
test('a player of the round whose name overruns the hero slot falls back to his last name', () => {
  const s = playerOfRoundCard({
    player: { name: 'محمود عبد المنعم كهربا', club: 'AHL', clubShort: 'الأهلي', points: 14 },
  })
  assert.equal(s.texts[1], 'كهربا')
})

/* ─────────────────────────── team of the week ─────────────────────────── */

const squad = (counts, pointsFor) =>
  Object.entries(counts).flatMap(([pos, n]) =>
    Array.from({ length: n }, (_, i) => player({ playerId: `${pos}${i}`.length * 100 + i, pos, points: pointsFor(pos, i) })),
  )

// Picking the side moved to the API on 2026-09-04. What is left here is rendering the eleven it
// hands back — and refusing anything this repo cannot actually draw.
const TEAM = (over = {}) => ({
  formation: '4-4-2',
  totalPoints: 128,
  players: Array.from({ length: 11 }, (_, i) => player({ playerId: i, points: 20 - i })),
  ...over,
})

test('the card follows the formation the API picked', () => {
  assert.equal(teamOfWeekCard({ gameweek: 3, team: TEAM() }).card, 'M_TEAM_OF_THE_WEEK_4_4_2')
  assert.equal(
    teamOfWeekCard({ gameweek: 3, team: TEAM({ formation: '5-4-1' }) }).card,
    'M_TEAM_OF_THE_WEEK_5_4_1',
  )
})

// All eight legal shapes have a template since 2026-09-05, so `?formations=` no longer narrows
// what the API may pick. The guard stays for a shape the rules engine does not admit at all —
// rendering one we hold no card for would put SAMPLE players on a real post.
test('every shape the rules engine admits can now be drawn', () => {
  for (const formation of DRAWABLE_FORMATIONS) {
    const [def, mid, fwd] = formation.split('-').map(Number)
    const team = { formation, totalPoints: 128, players: squad({ FWD: fwd, MID: mid, DEF: def, GK: 1 }, () => 8) }
    assert.equal(
      teamOfWeekCard({ gameweek: 3, team }).card,
      `M_TEAM_OF_THE_WEEK_${formation.replace(/-/g, '_')}`,
    )
  }
  assert.equal(DRAWABLE_FORMATIONS.length, 8)
})

test('a formation with no card template is still refused by name', () => {
  assert.throws(
    () => teamOfWeekCard({ gameweek: 3, team: TEAM({ formation: '6-3-1' }) }),
    /No card template for a 6-3-1/,
  )
})

test('a side that is not eleven is refused rather than part-drawn', () => {
  assert.throws(
    () => teamOfWeekCard({ gameweek: 3, team: TEAM({ players: [player()] }) }),
    /eleven players, got 1/,
  )
})

test('no team at all is a card that cannot be written yet, not a crash', () => {
  assert.throws(() => teamOfWeekCard({ gameweek: 3, team: null }), /no gameweek team/)
})

test('the eleven keep the order the API sent them in', () => {
  const team = TEAM()
  const s = teamOfWeekCard({ gameweek: 3, team })
  assert.equal(s.assets[0], team.players[0].club)
  assert.equal(Object.keys(s.assets).length, 11)
})

/* ─────────────── the generated slot map is the contract ─────────────── */

const SLOT_MAPS = new URL('../../FEL_WEBSITE/docs/marketing/card-slot-maps.md', import.meta.url)

/** Parse the generated map into { CARD_ID: { texts, locked:Set, assets, keepNames } }. */
function readSlotMaps(file) {
  const cards = {}
  let current = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = line.match(/^### `([A-Za-z0-9_]+)`/)
    if (heading) {
      current = { texts: 0, locked: new Set(), assets: 0, keepNames: false }
      cards[heading[1]] = current
      continue
    }
    if (!current) continue

    const texts = line.match(/^- \*\*texts\*\* \((\d+)\):(.*)$/)
    if (texts) {
      current.texts = Number(texts[1])
      for (const m of texts[2].matchAll(/`(\d+)(\*?)`/g)) if (m[2]) current.locked.add(Number(m[1]))
      continue
    }
    const assets = line.match(/^- \*\*assets\*\* \((\d+)\)/)
    if (assets) current.assets = Number(assets[1])
    if (line.includes('"keepNames": true')) current.keepNames = true
  }
  return cards
}

// A stale slot map is invisible: it puts text in the wrong slot and you only find out from the
// PNG. This is the tripwire — it fails the moment build-cards.py moves an index under us.
test('every slot a filler writes still exists on the card it names', { skip: !existsSync(SLOT_MAPS) }, () => {
  const maps = readSlotMaps(SLOT_MAPS)
  const ten = Array.from({ length: 12 }, (_, i) => player({ playerId: i, points: 20 - i }))
  const four = [...TWO, fx('AHL', 'ENP', '2026-09-07T18:00:00Z'), fx('ZAM', 'PYR', '2026-09-07T19:00:00Z')]
  const played = four.map((f) => ({ ...f, status: 'FINISHED', homeScore: 1, awayScore: 0 }))

  const sources = [
    matchdayCard({ gameweek: 4, fixtures: TWO }),
    matchdayCard({ gameweek: 4, fixtures: four.slice(0, 3) }),
    matchdayCard({ gameweek: 4, fixtures: four }),
    resultsCard({ gameweek: 4, fixtures: played.slice(0, 2) }),
    resultsCard({ gameweek: 4, fixtures: played.slice(0, 3) }),
    resultsCard({ gameweek: 4, fixtures: played }),
    singleMatchCard({ gameweek: 4, fixture: played[0] }),
    deadlineCard({ gameweek: 4, deadline: '2026-09-07T13:00:00Z' }),
    statCard({ gameweek: 4, hero: 'كابتنك ملعبش', support: 'الأهلي بكرة' }),
    questionCard({ gameweek: 4, players: ten.slice(0, 4) }),
    topPlayersCard({ players: ten.slice(0, 3) }),
    topPlayersCard({ players: ten }),
    playerOfRoundCard({ player: { name: 'زيزو', club: 'AHL', clubShort: 'الأهلي', points: 14 } }),
    teamOfWeekCard({
      gameweek: 4,
      team: { formation: '4-4-2', totalPoints: 128, players: ten.slice(0, 10).concat(ten[0]) },
    }),
    teamOfWeekCard({
      gameweek: 4,
      team: { formation: '5-4-1', totalPoints: 132, players: ten.slice(0, 10).concat(ten[0]) },
    }),
    // The winner's eleven, one card per shape. Slots run points, captain, name per man — the
    // mapping most likely to be written off by one, and the one where being off by one publishes
    // every man's score against the wrong face. The XI must be a REAL shape: eleven midfielders
    // derive as 0-11-0, fall through to the fixed card, and quietly test nothing.
    ...DRAWABLE_WINNER_FORMATIONS.map((formation) => {
      const [def, mid, fwd] = formation.split('-').map(Number)
      const xi = [
        ...Array.from({ length: fwd }, () => ({ ...ten[0], pos: 'FWD' })),
        ...Array.from({ length: mid }, () => ({ ...ten[0], pos: 'MID' })),
        ...Array.from({ length: def }, () => ({ ...ten[0], pos: 'DEF' })),
        { ...ten[0], pos: 'GK' },
      ].map((p, i) => ({ ...p, isCaptain: i === 4 }))
      return winnerCard({ gameweek: 4, winner: { name: 'Mohamed Sadek', teamName: 'العالمي', gwPts: 80, xi } })
    }),
    // ...and every team-of-week shape, now that all eight have a template.
    ...DRAWABLE_FORMATIONS.map((formation) => {
      const [def, mid, fwd] = formation.split('-').map(Number)
      return teamOfWeekCard({
        gameweek: 4,
        team: {
          formation,
          totalPoints: 128,
          players: [
            ...Array.from({ length: fwd }, () => ({ ...ten[0], pos: 'FWD' })),
            ...Array.from({ length: mid }, () => ({ ...ten[0], pos: 'MID' })),
            ...Array.from({ length: def }, () => ({ ...ten[0], pos: 'DEF' })),
            { ...ten[0], pos: 'GK' },
          ],
        },
      })
    }),
    priceChangesCard({ changes: EIGHT_MOVES }),
    podiumCard({
      gameweek: 4,
      rows: [1, 2, 3].map((n) => ({ name: `م${n}`, teamName: `ف${n}`, gwPts: 90 - n })),
    }),
    leagueTableCard({
      rows: Array.from({ length: 8 }, () => ({ club: 'AHL', clubShort: 'الأهلي', p: 8, pts: 22 })),
    }),
  ]

  for (const source of sources) {
    const map = maps[source.card]
    assert.ok(map, `card ${source.card} is not in the generated slot map`)

    for (const index of Object.keys(source.texts).map(Number)) {
      assert.ok(index < map.texts, `${source.card} t${index} is past its ${map.texts} text slots`)
      assert.ok(!map.locked.has(index), `${source.card} t${index} is a locked slot`)
    }
    for (const index of Object.keys(source.assets).map(Number)) {
      assert.ok(index < map.assets, `${source.card} a${index} is past its ${map.assets} asset slots`)
    }
    assert.equal(
      Boolean(source.keepNames),
      map.keepNames,
      `${source.card} keepNames disagrees with the generated map`,
    )
  }
})

// ── the photo hero, and the winner's team ──────────────────────────────────────────────────────

// The two G cards carry identical texts and one crest; only the 520x520 photo hero differs. So the
// choice is made by the DATA — a player the API has a photo for gets the spotlight, and one it does
// not still gets a complete card rather than a hole where a face should be.
test('a player the API has a photo for gets the spotlight card', () => {
  const s = playerOfRoundCard({
    player: { name: 'احمد سامى', club: 'PYR', clubShort: 'بيراميدز', points: 17, photoUrl: 'https://api.fantasyeg.com/api/v1/assets/players/21.jpg' },
  })
  assert.equal(s.card, 'G_PLAYER_SPOTLIGHT')
  assert.equal(s.photoUrl, 'https://api.fantasyeg.com/api/v1/assets/players/21.jpg')
})

test('a player with no photo still gets a complete card', () => {
  const s = playerOfRoundCard({ player: { name: 'احمد سامى', club: 'PYR', clubShort: 'بيراميدز', points: 17 } })
  assert.equal(s.card, 'G_NO_PHOTO_FALLBACK')
  assert.equal(s.photoUrl, undefined, 'no dangling key for the renderer to trip on')
})

test('a blank photo url is not a photo', () => {
  for (const photoUrl of ['', '   ', null]) {
    assert.equal(playerOfRoundCard({ player: { name: 'ا', club: 'PYR', clubShort: 'ب', points: 1, photoUrl } }).card, 'G_NO_PHOTO_FALLBACK')
  }
})

// Owner call, 2026-09-04: the winner card names his team as well as him.
test('the winner card carries his team name beside his points', () => {
  const s = winnerCard({ gameweek: 3, winner: { name: 'Mohamed Sadek', teamName: 'العالمي', gwPts: 80 } })
  assert.equal(s.texts[1], 'Mohamed Sadek')
  assert.equal(s.texts[2], 'العالمي · 80 نقطة')
})

// A manager who never named a team must not get a card with a stray separator on it.
test('a winner with no team name gets a clean support line', () => {
  const s = winnerCard({ gameweek: 3, winner: { name: 'Mohamed Sadek', gwPts: 80 } })
  assert.equal(s.texts[2], '80 نقطة')
})

// The hero slot wraps past 16 characters, so a long name moves down into the support line — and
// must take the team with it rather than dropping it.
test('a long winner name steps aside for the title and keeps the team', () => {
  const s = winnerCard({ gameweek: 3, winner: { name: 'عبد الرحمن محمد السيد', teamName: 'العالمي', gwPts: 80 } })
  assert.equal(s.texts[1], 'بطل الجولة')
  assert.equal(s.texts[2], 'عبد الرحمن محمد السيد · العالمي · 80 نقطة')
})

// ─────────────────────────────────────────────────────────────────────────────
// The winner's pitch draws his real shape
//
// Until 2026-09-05 `P_WINNER_THEIR_TEAM_NO_CLUB_SET` drew a fixed 3/3/4/1 whoever won, so a
// 4-4-2 put a midfielder in the forward line — every name and score right, one man in the wrong
// place. The API always carried what was needed: ClientWinnerPlayer.pos was on the wire and the
// card never read it.
// ─────────────────────────────────────────────────────────────────────────────

/** An XI in the order the API sends one: forwards first, keeper last. */
const XI = (def, mid, fwd, over = {}) => [
  ...Array.from({ length: fwd }, (_, i) => player({ playerId: 100 + i, pos: 'FWD', name: `مهاجم ${i}` })),
  ...Array.from({ length: mid }, (_, i) => player({ playerId: 200 + i, pos: 'MID', name: `وسط ${i}` })),
  ...Array.from({ length: def }, (_, i) => player({ playerId: 300 + i, pos: 'DEF', name: `دفاع ${i}` })),
  player({ playerId: 400, pos: 'GK', name: 'حارس' }),
].map((p, i) => (i === (over.captainAt ?? 0) ? { ...p, isCaptain: true } : p))

const WINNER = (xi, over = {}) => ({ name: 'Mohamed Sadek', teamName: 'العالمي', gwPts: 80, xi, ...over })

test('the card follows the shape the winner actually played', () => {
  const cases = [
    [4, 4, 2, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_4_4_2'],
    [3, 4, 3, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_3_4_3'],
    [5, 4, 1, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_5_4_1'],
    [5, 2, 3, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_5_2_3'],
    [4, 5, 1, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_4_5_1'],
    [3, 5, 2, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_3_5_2'],
    [4, 3, 3, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_4_3_3'],
    [5, 3, 2, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET_5_3_2'],
  ]
  for (const [d, m, f, card] of cases) {
    assert.equal(winnerCard({ gameweek: 3, winner: WINNER(XI(d, m, f)) }).card, card, `${d}-${m}-${f}`)
  }
})

// The whole reason the old card promoted the captain to the front was that its marker existed on
// cell one only. Pitch order is load-bearing now, so the order the API sent must survive.
test('the eleven keep the order the API sent, so the shape is the shape', () => {
  const xi = XI(4, 4, 2, { captainAt: 7 })
  const s = winnerCard({ gameweek: 3, winner: WINNER(xi) })
  for (let i = 0; i < 11; i += 1) {
    assert.equal(s.texts[7 + 3 * i], xi[i].name, `name slot ${i}`)
    assert.equal(s.assets[i], xi[i].club, `shirt slot ${i}`)
  }
})

test('the armband sits on the captain wherever he plays, not on the first cell', () => {
  const s = winnerCard({ gameweek: 3, winner: WINNER(XI(4, 4, 2, { captainAt: 7 })) })
  assert.equal(s.texts[6 + 3 * 7], 'C')
  const marked = Array.from({ length: 11 }, (_, i) => s.texts[6 + 3 * i]).filter((t) => t === 'C')
  assert.equal(marked.length, 1)
})

// An unwritten slot keeps the design's sample value, and every marker's sample IS 'C'. Writing
// all eleven is what stops ten innocent players wearing an armband.
test('every captain slot is written, so no sample "C" can survive', () => {
  const s = winnerCard({ gameweek: 3, winner: WINNER(XI(4, 4, 2)) })
  for (let i = 0; i < 11; i += 1) {
    assert.equal(typeof s.texts[6 + 3 * i], 'string', `marker ${i} must be written`)
  }
})

test('an XI with no captain at all wears no armband', () => {
  const xi = XI(4, 4, 2).map((p) => ({ ...p, isCaptain: false }))
  const s = winnerCard({ gameweek: 3, winner: WINNER(xi) })
  assert.deepEqual(
    Array.from({ length: 11 }, (_, i) => s.texts[6 + 3 * i]).filter((t) => t === 'C'),
    [],
  )
})

test('points sit with their own man', () => {
  const xi = XI(4, 4, 2).map((p, i) => ({ ...p, points: i }))
  const s = winnerCard({ gameweek: 3, winner: WINNER(xi) })
  for (let i = 0; i < 11; i += 1) assert.equal(s.texts[5 + 3 * i], String(i))
})

// A shape the rules engine admits but we hold no template for must not throw on a settle day.
test('an undrawable shape falls back to the fixed card rather than failing the post', () => {
  const xi = [...XI(4, 4, 2)]
  xi[0] = { ...xi[0], pos: 'DEF' } // 5-4-1 by count, but pretend the allowlist lacks it
  const s = winnerCard({ gameweek: 3, winner: WINNER(XI(6, 3, 1)) })
  assert.equal(s.card, 'P_WINNER_THEIR_TEAM_NO_CLUB_SET')
})

test('the name budget follows the line a man stands in, not one number for the card', () => {
  // A 5-4-1: the lone forward has a 900px column, the five defenders have 180px each.
  const long = 'محمود عبد المنعم كهربا'
  const xi = XI(5, 4, 1).map((p) => ({ ...p, name: long }))
  const s = winnerCard({ gameweek: 3, winner: WINNER(xi) })
  assert.equal(s.texts[7], long, 'the lone forward has room for all of it')
  assert.equal(s.texts[7 + 3 * 10], long, 'so does the keeper')
  assert.equal(s.texts[7 + 3 * 6], 'كهربا', 'a five-wide defender does not')
})

// Owner call, 2026-09-05: full names on BOTH shirt cards. The winner card and team of the week
// printed the same man two ways from the same round — أحمد سامى on one, سامى on the other.
test('team of the week carries full names, budgeted by line like the winner card', () => {
  const team = { formation: '5-4-1', totalPoints: 128, players: squad({ FWD: 1, MID: 4, DEF: 5, GK: 1 }, () => 8) }
  const long = 'محمود عبد المنعم كهربا'
  const s = teamOfWeekCard({ gameweek: 3, team: { ...team, players: team.players.map((p) => ({ ...p, name: long })) } })
  assert.equal(s.texts[3], long, 'the lone forward has the room')
  assert.equal(s.texts[3 + 2 * 6], 'كهربا', 'a five-wide defender does not')
})

test('a name that fits is printed whole rather than shortened out of habit', () => {
  const team = { formation: '4-4-2', totalPoints: 128, players: squad({ FWD: 2, MID: 4, DEF: 4, GK: 1 }, () => 8) }
  const s = teamOfWeekCard({
    gameweek: 3,
    team: { ...team, players: team.players.map((p) => ({ ...p, name: 'أحمد سامى' })) },
  })
  assert.equal(s.texts[3], 'أحمد سامى')
})
