// Public Hunt: one board, one hidden habitat, one public clue sequence that everyone receives at the same time.
// Pure: the server runs it, the tests check it, the client only reads the types and the feedback words.
import { type Board, CLUES, SPACES, clueMap, generateBoard, rng } from './board.ts';

export type HuntMode = 'classic' | 'hotcold' | 'oneshot';
export const HUNT_MODES: HuntMode[] = ['classic', 'hotcold', 'oneshot'];

export interface ModeRules {
  name: string;
  pitch: string; // one line on the home sheet
  rule: string; // one line in the briefing
  shots: number; // guesses allowed per hunt (Infinity for unlimited)
  cooldownMs: (wrong: number) => number; // wait after the n-th wrong guess
}

export const MODE_RULES: Record<HuntMode, ModeRules> = {
  classic: {
    name: 'First to Find',
    pitch: 'Unlimited guesses. Each miss tells you near or far, and costs you a little more time.',
    rule: 'A miss says near (within two spaces) or far, and locks you out a little longer each time.',
    shots: Infinity,
    cooldownMs: (wrong) => Math.min(20_000, 4_000 + 3_000 * (wrong - 1)),
  },
  hotcold: {
    name: 'Hot or Cold',
    pitch: 'Every miss reads a temperature. Follow the heat, but wait out the cooldown.',
    rule: 'A miss reads scorching, hot, warm, cool or cold by distance. Ten seconds between guesses.',
    shots: Infinity,
    cooldownMs: () => 10_000,
  },
  oneshot: {
    name: 'One Shot',
    pitch: 'One guess, no feedback. Wait for more clues, or call it before anyone else.',
    rule: 'You get exactly one guess. A miss puts you out of the race; you can still watch it end.',
    shots: 1,
    cooldownMs: () => 0,
  },
};

/** Original creatures; the name and report set the scene and never hint at the location. */
export const CRYPTIDS = [
  { name: 'The Fenmother', epithet: 'Tall as a heron, quiet as rot', report: 'Two lights over still water, then nothing. The camp dog would not stop shaking until dawn.' },
  { name: 'Quillback', epithet: 'A hedgehog the size of a cart', report: 'Something dragged the supply crate forty paces and left it bristling with spines as long as pencils.' },
  { name: 'Old Lanternjaw', epithet: 'Its mouth glows when it is hungry', report: 'A green glow behind the ridge, low to the ground, moving against the wind.' },
  { name: 'The Hollow Stag', epithet: 'Antlers you can see the moon through', report: 'Hoofprints that start in the middle of a clearing and stop in the middle of another.' },
  { name: 'Murkwing', epithet: 'Wings like wet sailcloth', report: 'A shadow crossed the moon twice. The second time it was much closer.' },
  { name: 'Bramblecat', epithet: 'Leaves a trail of snapped thorns', report: 'The tripwire bell rang at 3 a.m. By the time we looked, the camera strap had been chewed through.' },
  { name: 'The Gloaming Toad', epithet: 'Sings in a chord, alone', report: 'A three-note croak from every direction at once. Then a splash, heavy as a dropped barrel.' },
  { name: 'Skittervane', epithet: 'Too many legs, all of them polite', report: 'Neat rows of tiny prints circled the tent and left. Nothing was taken. Everything was rearranged.' },
] as const;

/** Standard boards have no black structures; "not" clues add variety to the public sequence. */
const POOL = CLUES.filter((c) => !c.id.endsWith(':black'));

export interface HuntScenario {
  board: Board;
  clues: string[]; // in reveal order
  habitat: number;
  cryptid: number; // index into CRYPTIDS
}

/** How many spaces are still possible after each clue, in order (index 0 = before any clue). */
export function narrowing(board: Board, clues: string[]): number[] {
  const live = Array(SPACES).fill(true);
  const out = [SPACES];
  for (const id of clues) {
    const m = clueMap(id, board);
    for (let i = 0; i < SPACES; i++) live[i] &&= m[i];
    out.push(live.filter(Boolean).length);
  }
  return out;
}

/**
 * A board plus 5 to 7 public clues. Each clue removes at least one candidate and none removes more than
 * three quarters of what is left (until the last), at least 3 spaces remain before the final clue, and
 * after the final clue exactly one space fits. Like generateScenario, `secret` drives the draw so the
 * public board seed cannot be rerun to read the answer. Bounded: throws instead of looping.
 */
export function generateHunt(seed: number, secret: number): HuntScenario {
  for (let attempt = 0; attempt < 40; attempt++) {
    const board = generateBoard(seed + attempt * 7919, 'standard');
    const rand = rng((secret + attempt * 104729) ^ 0x51ed270b);
    const maps = POOL.map((c) => ({ id: c.id, m: clueMap(c.id, board) }));
    for (let t = 0; t < 400; t++) {
      const order = maps.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
      let live = Array.from({ length: SPACES }, (_, i) => i);
      const picked: string[] = [];
      for (const { id, m } of order) {
        const next = live.filter((i) => m[i]);
        if (!next.length || next.length === live.length) continue;
        const final = next.length === 1;
        if (final ? picked.length < 4 || live.length < 3 : next.length < live.length * 0.25) continue;
        picked.push(id);
        live = next;
        if (final || picked.length === 7) break;
      }
      if (live.length === 1 && picked.length >= 5) {
        return { board, clues: picked, habitat: live[0], cryptid: Math.floor(rand() * CRYPTIDS.length) };
      }
    }
  }
  throw new Error(`Could not build a hunt from seed ${seed}`);
}

// ---- Guess feedback ------------------------------------------------------------------------------

export type Hint = 'found' | 'near' | 'far' | 'scorching' | 'hot' | 'warm' | 'cool' | 'cold' | 'sealed';

/** The only thing a miss tells you, by mode. Distances are hex steps; One Shot says nothing until the end. */
export function hintFor(mode: HuntMode, d: number): Hint {
  if (d === 0) return 'found';
  if (mode === 'oneshot') return 'sealed';
  if (mode === 'classic') return d <= 2 ? 'near' : 'far';
  return d === 1 ? 'scorching' : d === 2 ? 'hot' : d === 3 ? 'warm' : d <= 5 ? 'cool' : 'cold';
}

export const HINT_TEXT: Record<Hint, string> = {
  found: 'Found it',
  near: 'Near: within two spaces',
  far: 'Far: three or more spaces away',
  scorching: 'Scorching: right next to it',
  hot: 'Hot: two spaces away',
  warm: 'Warm: three spaces away',
  cool: 'Cool: four or five spaces away',
  cold: 'Cold: six or more spaces away',
  sealed: 'Its distance stays sealed until the reveal',
};

// ---- Wire types ------------------------------------------------------------------------------------

export type HuntPhase = 'briefing' | 'live' | 'over';

export interface HuntResult {
  winner: { name: string; pid: string; ms: number; clues: number } | null;
  habitat: number;
  clues: string[]; // the full sequence, including any never revealed
  heat: number[]; // guesses per space, all hunters
  closest: { name: string; pid: string; d: number }[]; // best miss per hunter, nearest first
}

/** Identical for every socket in the hunt. Holds nothing secret until `result` arrives with phase 'over'. */
export interface HuntState {
  id: string;
  number: number;
  mode: HuntMode;
  phase: HuntPhase;
  board: Board;
  cryptid: number;
  total: number; // how many clues this hunt has
  clues: string[]; // revealed so far
  startsAt: number; // server clock: briefing ends, clue 1 drops
  nextClueAt: number | null;
  endsAt: number | null;
  hunters: number;
  guesses: number;
  out: number; // One Shot hunters who missed
  now: number; // server clock when sent, for the client's offset
  result: HuntResult | null;
}

export interface Pulse { hunters: number; guesses: number; out: number }

export interface MyGuess { space: number; at: number; hint: Hint; clues: number }

/** Sent only to the sockets of one hunter. */
export interface HunterView {
  pid: string;
  name: string;
  guesses: MyGuess[];
  readyAt: number; // server clock when the next guess is allowed
  shotsLeft: number | null; // null = unlimited
}

export interface Stats {
  name: string;
  entered: number;
  wins: number;
  streak: number;
  bestStreak: number;
  fastestMs: number | null;
  cluesAtWin: number; // sum, for the average
  missSum: number; // sum of wrong-guess distances
  misses: number;
}

export interface LeaderRow { name: string; pid: string; value: number }
export interface Leaders { today: LeaderRow[]; week: LeaderRow[]; all: LeaderRow[]; fastest: LeaderRow[]; sharpest: LeaderRow[]; you: Stats | null }
