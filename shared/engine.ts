// Turn rules. The same code runs the online server and the pass-and-play client.
import { type Board, type Mode, clueMap, generateScenario, SPACES } from './board.ts';

// 'disc': a searcher who already had a disc on the searched space must place one elsewhere first.
export type Phase = 'setup' | 'play' | 'penalty' | 'disc' | 'over';

export interface Space {
  cube: number | null; // at most one cube per space, ever
  discs: number[];
}

export type Action =
  | { type: 'cube'; space: number } // setup cube or penalty cube
  | { type: 'question'; space: number; target: number }
  | { type: 'search'; space: number }
  | { type: 'disc'; space: number }; // the searcher's extra disc

export type LogEntry =
  | { t: 'setup'; p: number; space: number }
  | { t: 'question'; p: number; target: number; space: number; answer: 'disc' | 'cube' }
  | { t: 'search'; p: number; space: number; answers: { p: number; answer: 'disc' | 'cube' }[]; found: boolean; extra?: number }
  | { t: 'penalty'; p: number; space: number }
  | { t: 'skip'; p: number }; // penalty owed but no legal space left

/** Everything every player may see, plus `clues`, which is masked per player in a view. */
export interface Table {
  board: Board;
  players: string[];
  clues: (string | null)[];
  marks: Space[];
  phase: Phase;
  turn: number; // whose turn; during setup, who places next
  setupPlaced: number;
  searching: number | null; // the searched space while phase is 'disc'
  winner: number | null;
  log: LogEntry[];
}

export interface GameState extends Table {
  clues: string[];
  habitat: number;
}

export interface PlayerView extends Table {
  you: number | null;
  habitat: number | null; // only once the game is over
}

/** `secret` picks the clues; keep it off the wire (see generateScenario). */
export function newGame(seed: number, players: string[], secret: number, mode: Mode = 'standard'): GameState {
  const { board, clues, habitat } = generateScenario(seed, players.length, secret, mode);
  return {
    board, players, clues, habitat,
    marks: Array.from({ length: SPACES }, () => ({ cube: null, discs: [] })),
    phase: 'setup', turn: 0, setupPlaced: 0, searching: null, winner: null, log: [],
  };
}

/** Who must act next, or null when the game is over. */
export const actor = (t: Table) => (t.phase === 'over' ? null : t.turn);

// Clue maps are recomputed per call; memoised on the clue id + board seed since boards never change.
const cache = new Map<string, boolean[]>();
export function allowed(t: Table, p: number): boolean[] | null {
  const id = t.clues[p];
  if (!id) return null;
  const key = `${t.board.seed}|${t.board.mode}|${id}`;
  if (!cache.has(key)) {
    if (cache.size > 500) cache.clear();
    cache.set(key, clueMap(id, t.board));
  }
  return cache.get(key)!;
}

/** Spaces where player p may put a cube: no cube there, none of p's pieces, and p's clue rules it out. */
export function cubeSpaces(t: Table, p: number): boolean[] {
  const ok = allowed(t, p);
  return t.marks.map((m, i) => m.cube === null && !m.discs.includes(p) && !!ok && !ok[i]);
}

/**
 * Why `action` by player p is illegal right now, or null if it is legal.
 * Works on a masked view too, because it only reads the acting player's own clue.
 */
export function illegal(t: Table, p: number, a: Action): string | null {
  if (t.phase === 'over') return 'The game is over.';
  if (p !== t.turn) return `It is ${t.players[t.turn]}'s turn.`;
  if (!Number.isInteger(a.space) || a.space < 0 || a.space >= SPACES) return 'That is not a space on the map.';
  const m = t.marks[a.space];

  if (t.phase === 'setup' || t.phase === 'penalty') {
    if (a.type !== 'cube') return t.phase === 'setup' ? 'Place your opening cubes first.' : 'Place your penalty cube first.';
  } else if (t.phase === 'disc') {
    if (a.type !== 'disc') return 'Place your extra disc first.';
  } else if (a.type === 'cube' || a.type === 'disc') return 'Pieces are only placed this way during setup, a penalty or a search.';

  if (m.cube !== null) return 'A space with a cube on it is closed to every action.';

  if (a.type === 'cube') {
    if (m.discs.includes(p)) return 'You already have a piece on that space.';
    if (allowed(t, p)![a.space]) return 'Your clue says the habitat could be there, so a cube would be a lie.';
    return null;
  }
  if (a.type === 'disc') {
    if (m.discs.includes(p)) return 'You already have a disc there.';
    if (!allowed(t, p)![a.space]) return 'Your extra disc must go on a space your clue allows.';
    return null;
  }
  if (a.type === 'question') {
    if (!Number.isInteger(a.target) || a.target < 0 || a.target >= t.players.length || a.target === p) {
      return 'Choose another player to question.';
    }
    if (m.discs.includes(a.target)) return `${t.players[a.target]} already has a disc there.`;
    return null;
  }
  if (!allowed(t, p)![a.space]) return 'You can only search a space your own clue allows.';
  return null;
}

const next = (s: GameState) => (s.turn + 1) % s.players.length;

function owePenalty(s: GameState) {
  if (cubeSpaces(s, s.turn).some(Boolean)) s.phase = 'penalty';
  else {
    // The rulebook does not cover this; we skip the penalty rather than deadlock the game.
    s.log.push({ t: 'skip', p: s.turn });
    s.turn = next(s);
  }
}

/** Apply a legal action and return the new state. Throws on an illegal one; the input is never mutated. */
export function apply(state: GameState, p: number, a: Action): GameState {
  const why = illegal(state, p, a);
  if (why) throw new Error(why);
  const s = structuredClone(state);
  const m = s.marks[a.space];

  if (a.type === 'cube') {
    m.cube = p;
    if (s.phase === 'setup') {
      s.log.push({ t: 'setup', p, space: a.space });
      s.setupPlaced++;
      s.turn = next(s);
      if (s.setupPlaced === s.players.length * 2) {
        s.phase = 'play';
        s.turn = 0;
      }
    } else {
      s.log.push({ t: 'penalty', p, space: a.space });
      s.phase = 'play';
      s.turn = next(s);
    }
    return s;
  }

  if (a.type === 'question') {
    const yes = allowed(s, a.target)![a.space];
    if (yes) m.discs.push(a.target);
    else m.cube = a.target;
    s.log.push({ t: 'question', p, target: a.target, space: a.space, answer: yes ? 'disc' : 'cube' });
    if (yes) s.turn = next(s);
    else owePenalty(s);
    return s;
  }

  if (a.type === 'search' && m.discs.includes(p)) {
    // Rulebook: your disc is already there, so you place one on another space your clue allows first.
    const ok = allowed(s, p)!;
    if (s.marks.some((x, i) => ok[i] && x.cube === null && !x.discs.includes(p))) {
      s.phase = 'disc';
      s.searching = a.space;
      return s;
    }
  }
  if (a.type === 'disc') {
    m.discs.push(p);
    const at = s.searching!;
    s.phase = 'play';
    s.searching = null;
    return resolveSearch(s, p, at, a.space);
  }
  return resolveSearch(s, p, a.space);
}

// Searcher's disc first, then each other player clockwise until someone places a cube.
function resolveSearch(s: GameState, p: number, space: number, extra?: number): GameState {
  const m = s.marks[space];
  if (!m.discs.includes(p)) m.discs.push(p);
  const answers: { p: number; answer: 'disc' | 'cube' }[] = [];
  for (let k = 1; k < s.players.length; k++) {
    const q = (p + k) % s.players.length;
    if (m.discs.includes(q)) continue;
    if (allowed(s, q)![space]) {
      m.discs.push(q);
      answers.push({ p: q, answer: 'disc' });
    } else {
      m.cube = q;
      answers.push({ p: q, answer: 'cube' });
      break;
    }
  }
  const found = m.cube === null;
  s.log.push({ t: 'search', p, space, answers, found, ...(extra !== undefined && { extra }) });
  if (found) {
    s.phase = 'over';
    s.winner = p;
  } else owePenalty(s);
  return s;
}

/** What player p (or a spectator, null) is allowed to see. Clues and the habitat stay hidden until the end. */
export function viewFor(s: GameState, you: number | null): PlayerView {
  const over = s.phase === 'over';
  const { habitat, clues, ...table } = s;
  return {
    ...structuredClone(table),
    clues: clues.map((c, i) => (over || i === you ? c : null)),
    you,
    habitat: over ? habitat : null,
  };
}
