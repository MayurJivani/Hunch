// Hex map, seeded generation and clues. Pure: no DOM, no Three.js, no sockets.

export const COLS = 12;
export const ROWS = 9;
export const SPACES = COLS * ROWS;

export type Terrain = 'forest' | 'desert' | 'water' | 'mountain' | 'swamp';
export type Animal = 'bear' | 'cougar';
export type StructureKind = 'stone' | 'shack';
export type StructureColor = 'white' | 'green' | 'blue' | 'black';
/** Standard mode, or the rulebook's advanced mode: "not" clues and a fourth (black) structure of each type. */
export type Mode = 'standard' | 'hard';

export const TERRAINS: Terrain[] = ['forest', 'desert', 'water', 'mountain', 'swamp'];
export const COLORS: StructureColor[] = ['white', 'green', 'blue', 'black'];
export const colorsFor = (mode: Mode) => (mode === 'hard' ? COLORS : COLORS.slice(0, 3));

export interface Hex {
  terrain: Terrain;
  animal?: Animal;
  structure?: { kind: StructureKind; color: StructureColor };
}

export interface Board {
  seed: number;
  mode: Mode;
  hexes: Hex[]; // index = row * COLS + col
}

// Flat-topped hexes in "odd-q" columns: odd columns sit half a hex lower, so the map is a rectangle.
export const colOf = (i: number) => i % COLS;
export const rowOf = (i: number) => Math.floor(i / COLS);

export function axial(i: number) {
  const q = colOf(i);
  return { q, r: rowOf(i) - (q - (q & 1)) / 2 };
}

export function distance(a: number, b: number) {
  const A = axial(a), B = axial(b);
  const dq = A.q - B.q, dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const AXIAL_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function neighbors(i: number): number[] {
  const { q, r } = axial(i);
  const out: number[] = [];
  for (const [dq, dr] of AXIAL_DIRS) {
    const col = q + dq, row = r + dr + (col - (col & 1)) / 2;
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) out.push(row * COLS + col);
  }
  return out;
}

/** Human label used in the log and the space panel: column letter + row number, e.g. "C4". */
export const spaceName = (i: number) => `${String.fromCharCode(65 + colOf(i))}${rowOf(i) + 1}`;

// mulberry32: small, fast, good enough for board shuffles.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateBoard(seed: number, mode: Mode = 'standard'): Board {
  const rand = rng(seed);
  const all = [...Array(SPACES).keys()];

  // Terrain: 15 seeded patches (3 per terrain) take turns claiming a neighbour. Patches can still get boxed in,
  // so redraw (bounded) until every terrain covers 15 to 29 of the 108 spaces.
  let terrain: (Terrain | null)[] = [];
  for (let tries = 0; tries < 60; tries++) {
    terrain = Array(SPACES).fill(null);
    const patches = shuffle([...all], rand).slice(0, 15).map((i, k) => {
      terrain[i] = TERRAINS[k % 5];
      return [i];
    });
    for (let left = SPACES - patches.length; left > 0;) {
      for (const patch of shuffle(patches, rand)) {
        const options = patch.flatMap(neighbors).filter((n) => terrain[n] === null);
        if (!options.length || left === 0) continue;
        const n = options[Math.floor(rand() * options.length)];
        terrain[n] = terrain[patch[0]];
        patch.push(n);
        left--;
      }
    }
    const counts = TERRAINS.map((t) => terrain.filter((x) => x === t).length);
    if (Math.min(...counts) >= 15 && Math.max(...counts) <= 29) break;
  }
  const hexes: Hex[] = terrain.map((t) => ({ terrain: t! }));

  // Animal territories: 3 bear and 3 cougar patches of 2 or 3 spaces, never touching each other.
  const blocked = new Set<number>();
  for (const animal of ['bear', 'cougar', 'bear', 'cougar', 'bear', 'cougar'] as Animal[]) {
    const start = shuffle(all.filter((i) => !blocked.has(i)), rand)[0];
    const patch = [start];
    const size = 2 + Math.floor(rand() * 2);
    while (patch.length < size) {
      const options = patch.flatMap(neighbors).filter((n) => !blocked.has(n) && !patch.includes(n));
      if (!options.length) break;
      patch.push(options[Math.floor(rand() * options.length)]);
    }
    for (const i of patch) {
      hexes[i].animal = animal;
      blocked.add(i);
      neighbors(i).forEach((n) => blocked.add(n));
    }
  }

  // Structures: one standing stone and one shack per colour (black too in hard mode), kept 3+ spaces apart, off water.
  const placed: number[] = [];
  for (const color of colorsFor(mode)) {
    for (const kind of ['stone', 'shack'] as StructureKind[]) {
      const spot = shuffle(all.filter((i) => hexes[i].terrain !== 'water' && placed.every((p) => distance(p, i) >= 3)), rand)[0]
        ?? all.find((i) => !placed.includes(i))!; // shortcut: falls back to any free space if spacing fails, never seen at 6 structures
      hexes[spot].structure = { kind, color };
      placed.push(spot);
    }
  }
  return { seed, mode, hexes };
}

// ---- Clues -------------------------------------------------------------------------------------

export interface Clue {
  id: string; // a leading "!" marks the negative form
  text: string; // completes "The habitat is ..."
  within: number; // 0 means "on"
  test: (h: Hex) => boolean;
  not: boolean; // "the habitat is not ...": the complement of the positive clue
}

const WORDS = ['', 'one space', 'two spaces', 'three spaces'];
const NAMES: Record<string, string> = {
  stone: 'a standing stone', shack: 'an abandoned shack', bear: 'bear territory', cougar: 'cougar territory',
};

function buildClues(): Clue[] {
  const pos: Omit<Clue, 'not'>[] = [];
  TERRAINS.forEach((a, i) => TERRAINS.slice(i + 1).forEach((b) => {
    pos.push({ id: `on:${a}+${b}`, text: `on ${a} or ${b}`, within: 0, test: (h) => h.terrain === a || h.terrain === b });
  }));
  for (const t of TERRAINS) pos.push({ id: `1:${t}`, text: `within one space of ${t}`, within: 1, test: (h) => h.terrain === t });
  pos.push({ id: '1:animal', text: 'within one space of either animal territory', within: 1, test: (h) => !!h.animal });
  for (const k of ['stone', 'shack'] as const) {
    pos.push({ id: `2:${k}`, text: `within two spaces of ${NAMES[k]}`, within: 2, test: (h) => h.structure?.kind === k });
  }
  for (const a of ['bear', 'cougar'] as const) {
    pos.push({ id: `2:${a}`, text: `within two spaces of ${NAMES[a]}`, within: 2, test: (h) => h.animal === a });
  }
  for (const c of COLORS) {
    pos.push({ id: `3:${c}`, text: `within ${WORDS[3]} of a ${c} structure`, within: 3, test: (h) => h.structure?.color === c });
  }
  return [...pos.map((c) => ({ ...c, not: false })), ...pos.map((c) => ({ ...c, id: `!${c.id}`, text: `not ${c.text}`, not: true }))];
}

export const CLUES = buildClues();
export const CLUE = Object.fromEntries(CLUES.map((c) => [c.id, c])) as Record<string, Clue>;
/** Standard: the 23 positive clues without black. Hard: every positive and "not" clue, black included (48). */
export const cluesFor = (mode: Mode) =>
  mode === 'hard' ? CLUES : CLUES.filter((c) => !c.not && !c.id.endsWith(':black'));

/** Every space, true where the clue allows the habitat. "Within N" counts the feature's own space. */
export function clueMap(clueId: string, board: Board): boolean[] {
  const clue = CLUE[clueId];
  const features = board.hexes.flatMap((h, i) => (clue.test(h) ? [i] : []));
  return board.hexes.map((_, i) => features.some((f) => distance(i, f) <= clue.within) !== clue.not);
}

export const evaluateClue = (clueId: string, board: Board, i: number) => clueMap(clueId, board)[i];

export function findValidHabitats(board: Board, clueIds: string[]): number[] {
  const maps = clueIds.map((id) => clueMap(id, board));
  return board.hexes.flatMap((_, i) => (maps.every((m) => m[i]) ? [i] : []));
}

export interface Scenario {
  board: Board;
  clues: string[];
  habitat: number;
}

/**
 * A board plus one clue per player such that exactly one space satisfies all clues and every clue
 * is needed (dropping any one leaves more than one candidate). Bounded: throws instead of looping.
 *
 * `secret` drives the clue draw. The board seed is public (every client gets it), so the clues must come
 * from separate entropy or anyone could rerun the draw and read every clue and the habitat.
 */
export function generateScenario(seed: number, players: number, secret: number, mode: Mode = 'standard'): Scenario {
  if (players < 3 || players > 5) throw new Error('Hunch needs 3 to 5 players');
  for (let attempt = 0; attempt < 40; attempt++) {
    const board = generateBoard(seed + attempt * 7919, mode);
    const rand = rng((secret + attempt * 104729) ^ 0x9e3779b9);
    // Every clue in play must leave room for its owner's two opening cubes (and allow something).
    const pool = cluesFor(mode).filter((c) => {
      const ruledOut = clueMap(c.id, board).filter((x) => !x).length;
      return ruledOut >= 2 * players && ruledOut < SPACES;
    });
    const maps = new Map(pool.map((c) => [c.id, clueMap(c.id, board)]));
    for (let t = 0; t < 3000; t++) {
      const clues = shuffle(pool.map((c) => c.id), rand).slice(0, players);
      if (mode === 'hard' && !clues.some((id) => CLUE[id].not)) continue; // hard mode always deals at least one "not" clue
      const sets = clues.map((id) => maps.get(id)!);
      const fit = (skip: number) => board.hexes.flatMap((_, i) => (sets.every((s, k) => k === skip || s[i]) ? [i] : []));
      const all = fit(-1);
      if (all.length !== 1) continue;
      if (clues.some((_, k) => fit(k).length < 2)) continue;
      return { board, clues, habitat: all[0] };
    }
  }
  throw new Error(`Could not build a puzzle from seed ${seed}; try another seed`);
}
