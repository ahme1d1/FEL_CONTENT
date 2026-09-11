/**
 * The round-review reel: which of our players stands where in the borrowed video.
 *
 * Data only, no behaviour, so the casting reviews as a diff the way a manifest does.
 *
 * The source is a 28-card GW3 review from the page "Fantasy PL Players". Every card is matched
 * to what its ORIGINAL player actually returned in FPL GW3, because that video's voiceover is
 * kept and is still describing those returns: a card whose voice is roasting one point cannot
 * carry a player who hauled. Both sides were read from live data, never typed — FPL from
 * `fantasy.premierleague.com/api/event/3/live/`, ours from
 * `api.fantasyeg.com/api/v1/gameweeks/4/*`. `source.points` is kept beside each pick so a
 * rebuild can assert the pairing still holds instead of trusting this file.
 *
 * Of the 27 cards carrying a number, 13 match exactly and 22 are within one point. 22 of the 28
 * are الأهلي / الزمالك / بيراميدز, which was the owner's call.
 *
 * Cut times are the source's own scene boundaries, agreed by a `scene>0.08` pass and a
 * per-second read of every frame.
 */

/** The video being rebuilt. Provenance only; nothing here fetches it. */
export const SOURCE = {
  url: 'https://www.facebook.com/reel/1530658225477836',
  page: 'Fantasy PL Players',
  /** The master we render against, so the composite is an overlay with no rescale. */
  master: { width: 2172, height: 1080 },
  duration: 100.233,
  fps: 30,
}

/** The gameweek this cast is scored from. */
export const GAMEWEEK = 4

/** House label for it — `copy.json` gameweekOrdinals. */
export const ROUND_LABEL = 'الجولة الرابعة'

/**
 * 28 cards, in the order the source plays them.
 *
 * `start`/`end` are seconds into the source, `source` is who stood there and what he scored in
 * FPL GW3, `player` is ours written exactly as the card renders it.
 */
export const CAST = [
  {
    n: 1,
    start: 0,
    end: 3.73,
    source: { card: 'Szoboszlai', team: 'LIV', fplId: 368, pos: 'MID', points: 3 },
    player: {
      id: 9,
      name: 'أشرف بنشرقي',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'مهاجم',
      points: '4',
      detail: '',
    },
  },
  {
    n: 2,
    start: 3.73,
    end: 9.63,
    source: { card: 'João Pedro', team: 'CHE', fplId: 165, pos: 'FWD', points: 1 },
    player: {
      id: 17,
      name: 'عدي الدباغ',
      club: 'ZAM',
      clubName: 'الزمالك',
      position: 'مهاجم',
      points: '2',
      detail: '',
    },
  },
  {
    n: 3,
    start: 9.63,
    end: 13.3,
    source: { card: 'Elanga', team: 'NEW', fplId: 454, pos: 'MID', points: 1 },
    player: {
      id: 7,
      name: 'أحمد كوكا',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'وسط',
      points: '2',
      detail: '',
    },
  },
  {
    n: 4,
    start: 13.3,
    end: 18.6,
    source: { card: 'Cherki', team: 'MCI', fplId: 399, pos: 'MID', points: 3 },
    player: {
      id: 969,
      name: 'أحمد عبد القادر',
      club: 'PYR',
      clubName: 'بيراميدز',
      position: 'وسط',
      points: '3',
      detail: '',
    },
  },
  {
    n: 5,
    start: 18.6,
    end: 21.6,
    source: { card: 'Tzolis', team: 'ARS', fplId: 557, pos: 'MID', points: 5 },
    player: {
      id: 25,
      name: 'مهند لاشين',
      club: 'PYR',
      clubName: 'بيراميدز',
      position: 'وسط',
      points: '5',
      detail: 'شباك نظيفة',
    },
  },
  {
    n: 6,
    start: 21.6,
    end: 27.33,
    source: { card: 'Wirtz', team: 'LIV', fplId: 366, pos: 'MID', points: 3 },
    player: {
      id: 274,
      name: 'ناصر ماهر',
      club: 'PYR',
      clubName: 'بيراميدز',
      position: 'وسط',
      points: '1',
      detail: '',
    },
  },
  {
    n: 7,
    start: 27.33,
    end: 34.57,
    source: { card: 'Havertz', team: 'ARS', fplId: 26, pos: 'FWD', points: 8 },
    player: {
      id: 544,
      name: 'أحمد ياسر ريان',
      club: 'NBE',
      clubName: 'البنك الأهلي',
      position: 'مهاجم',
      points: '8',
      detail: 'هدف · نقطتين إضافيتين',
    },
  },
  {
    n: 8,
    start: 34.57,
    end: 39.03,
    source: { card: 'Gakpo', team: 'LIV', fplId: 367, pos: 'MID', points: 11 },
    player: {
      id: 132,
      name: 'اسلام محارب',
      club: 'TLG',
      clubName: 'طلائع الجيش',
      position: 'وسط',
      points: '9',
      detail: 'هدف · نقطتين إضافيتين',
    },
  },
  {
    n: 9,
    start: 39.03,
    end: 41.17,
    source: { card: 'Tzolakis', team: 'HUL', fplId: 572, pos: 'GK', points: 6 },
    player: {
      id: 955,
      name: 'المهدي سليمان',
      club: 'ZAM',
      clubName: 'الزمالك',
      position: 'حارس',
      points: '8',
      detail: 'شباك نظيفة · نقطة إضافية',
    },
  },
  {
    n: 10,
    start: 41.17,
    end: 42.2,
    source: { card: 'Saka', team: 'ARS', fplId: 12, pos: 'MID', points: 2 },
    player: {
      id: 950,
      name: 'علي محمود',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'وسط',
      points: '1',
      detail: '',
    },
  },
  {
    n: 11,
    start: 42.2,
    end: 44.07,
    source: { card: 'Cunha', team: 'MUN', fplId: 428, pos: 'MID', points: 3 },
    player: {
      id: 278,
      name: 'محمود صابر',
      club: 'PYR',
      clubName: 'بيراميدز',
      position: 'وسط',
      points: '3',
      detail: '',
    },
  },
  {
    n: 12,
    start: 44.07,
    end: 48.17,
    source: { card: 'Ballard', team: 'SUN', fplId: 532, pos: 'DEF', points: 4 },
    player: {
      id: 956,
      name: 'عمر جابر',
      club: 'ZAM',
      clubName: 'الزمالك',
      position: 'مدافع',
      points: '6',
      detail: 'شباك نظيفة',
    },
  },
  {
    n: 13,
    start: 48.17,
    end: 49.27,
    source: { card: 'Haaland', team: 'MCI', fplId: 411, pos: 'FWD', points: 9 },
    player: {
      id: 462,
      name: 'محمود ممدوح',
      club: 'MOD',
      clubName: 'مودرن',
      position: 'مهاجم',
      points: '9',
      detail: 'هدف · 3 نقاط إضافية',
    },
  },
  {
    n: 14,
    start: 49.27,
    end: 52.4,
    source: { card: 'Ødegaard', team: 'ARS', fplId: 15, pos: 'MID', points: 10 },
    player: {
      id: 51,
      name: 'محمود كهربا',
      club: 'ENP',
      clubName: 'إنبي',
      position: 'وسط',
      points: '9',
      detail: 'هدف · نقطتين إضافيتين',
    },
  },
  {
    n: 15,
    start: 52.4,
    end: 54.4,
    source: { card: 'B.Fernandes', team: 'MUN', fplId: 426, pos: 'MID', points: 2 },
    player: {
      id: 5,
      name: 'مروان عطية',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'وسط',
      points: '2',
      detail: '',
    },
  },
  {
    n: 16,
    start: 54.4,
    end: 58.6,
    source: { card: 'Isak', team: 'LIV', fplId: 379, pos: 'FWD', points: 13 },
    player: {
      id: 107,
      name: 'أسامة فيصل',
      club: 'NBE',
      clubName: 'البنك الأهلي',
      position: 'مهاجم',
      points: '13',
      detail: 'هدفين · 3 نقاط إضافية',
    },
  },
  {
    n: 17,
    start: 58.6,
    end: 60.5,
    source: { card: 'Maguire', team: 'MUN', fplId: 418, pos: 'DEF', points: 2 },
    player: {
      id: 3,
      name: 'ياسر إبراهيم',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'مدافع',
      points: '2',
      detail: '',
    },
  },
  {
    n: 18,
    start: 60.5,
    end: 64.93,
    source: { card: 'Mbeumo', team: 'MUN', fplId: 427, pos: 'MID', points: 8 },
    player: {
      id: 6,
      name: 'أحمد زيزو',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'وسط',
      points: '8',
      detail: 'هدف · نقطتين إضافيتين',
    },
  },
  {
    n: 19,
    start: 64.93,
    end: 67.93,
    source: { card: 'Foden', team: 'MCI', fplId: 398, pos: 'MID', points: 1 },
    player: {
      id: 906,
      name: 'عبد الله السعيد',
      club: 'ZAM',
      clubName: 'الزمالك',
      position: 'وسط',
      points: '1',
      detail: '',
    },
  },
  {
    n: 20,
    start: 67.93,
    end: 71.77,
    source: { card: 'Gabriel', team: 'ARS', fplId: 4, pos: 'DEF', points: 2 },
    player: {
      id: 2,
      name: 'محمد هاني',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'مدافع',
      points: '2',
      detail: '',
    },
  },
  {
    n: 21,
    start: 71.77,
    end: 76.97,
    source: { card: 'O\'Reilly', team: 'MCI', fplId: 387, pos: 'DEF', points: 0 },
    /**
     * No GW4 record at all: he never came on, same as the card he replaces (O'Reilly, 0 minutes).
     * The card shows 0, because that is what he scored. An earlier cut wrote «ملعبش الجولة دي»
     * in the score's place and it read as the card apologising for him.
     */
    player: {
      id: 190,
      name: 'طاهر محمد طاهر',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'مهاجم',
      points: '0',
      detail: '',
    },
  },
  {
    n: 22,
    start: 76.97,
    end: 81.97,
    source: { card: 'Ajayi', team: 'HUL', fplId: 279, pos: 'DEF', points: 5 },
    player: {
      id: 21,
      name: 'احمد سامى',
      club: 'PYR',
      clubName: 'بيراميدز',
      position: 'مدافع',
      points: '6',
      detail: 'شباك نظيفة',
    },
  },
  {
    n: 23,
    start: 81.97,
    end: 84.23,
    source: { card: 'Palmer', team: 'CHE', fplId: 154, pos: 'MID', points: 1 },
    player: {
      id: 193,
      name: 'إمام عاشور',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'وسط',
      points: '1',
      detail: '',
    },
  },
  {
    n: 24,
    start: 84.23,
    end: 87.9,
    source: { card: 'Mitchell', team: 'CRY', fplId: 204, pos: 'DEF', points: 15 },
    player: {
      id: 12,
      name: 'محمد اسماعيل',
      club: 'ZAM',
      clubName: 'الزمالك',
      position: 'مدافع',
      points: '15',
      detail: 'هدف · شباك نظيفة · 3 نقاط إضافية',
    },
  },
  {
    n: 25,
    start: 87.9,
    end: 90.23,
    source: { card: 'Kinsky', team: 'TOT', fplId: 496, pos: 'GK', points: 6 },
    player: {
      id: 19,
      name: 'أحمد الشناوي',
      club: 'PYR',
      clubName: 'بيراميدز',
      position: 'حارس',
      points: '7',
      detail: 'شباك نظيفة · نقطة إضافية',
    },
  },
  {
    n: 26,
    start: 90.23,
    end: 92.8,
    source: { card: 'Wissa', team: 'NEW', fplId: 464, pos: 'FWD', points: 1 },
    player: {
      id: 777,
      name: 'حسام أشرف',
      club: 'ZAM',
      clubName: 'الزمالك',
      position: 'مهاجم',
      points: '2',
      detail: '',
    },
  },
  {
    n: 27,
    start: 92.8,
    end: 94.4,
    source: { card: 'Rogers', team: 'CHE', fplId: 40, pos: 'MID', points: 6 },
    player: {
      id: 43,
      name: 'احمد بلحاج',
      club: 'CRA',
      clubName: 'سيراميكا',
      position: 'وسط',
      points: '7',
      detail: 'صناعة · شباك نظيفة · نقطة إضافية',
    },
  },
  {
    n: 28,
    start: 94.4,
    end: 100.2,
    source: { card: 'Thiaw', team: 'NEW', fplId: 445, pos: 'DEF', points: -1 },
    player: {
      id: 945,
      name: 'هادي رياض',
      club: 'AHL',
      clubName: 'الأهلي',
      position: 'مدافع',
      points: '1',
      detail: '',
    },
  },
]
