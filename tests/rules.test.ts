// Rulebook compliance (standard mode). The rules are re-implemented here from the rulebook text, independently
// of shared/engine.ts and shared/board.ts, and the engine is checked against them across many full games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Board, type Mode, CLUE, CLUES, COLS, ROWS, SPACES, TERRAINS, clueMap, cluesFor, distance, generateBoard, generateScenario, neighbors, rng,
} from '../shared/board.ts';
import { type Action, type GameState, apply, illegal, newGame, viewFor } from '../shared/engine.ts';

// ---- Independent geometry: hex centres in the plane, adjacency by centre distance, BFS for distance ----

const centre = (i: number) => {
  const c = i % COLS, r = Math.floor(i / COLS);
  return [1.5 * c, Math.sqrt(3) * (r + (c % 2) / 2)];
};
const ADJ = [...Array(SPACES).keys()].map((i) => [...Array(SPACES).keys()].filter((j) => {
  const [x0, y0] = centre(i), [x1, y1] = centre(j);
  return j !== i && Math.abs(Math.hypot(x1 - x0, y1 - y0) - Math.sqrt(3)) < 1e-6;
}));
const DIST = [...Array(SPACES).keys()].map((from) => {
  const d = Array(SPACES).fill(Infinity);
  d[from] = 0;
  for (const q = [from]; q.length;) {
    const i = q.shift()!;
    for (const j of ADJ[i]) if (d[j] === Infinity) { d[j] = d[i] + 1; q.push(j); }
  }
  return d;
});

// ---- Independent clue semantics, from "Possible clues" in the rulebook ----

/** "Any element on the board is zero spaces away from itself": within N counts the element's own space. */
const memo = new Map<string, boolean[]>();
function oracleClue(id: string, b: Board): boolean[] {
  const key = `${b.seed}|${b.mode}|${id}`;
  if (!memo.has(key)) memo.set(key, computeClue(id, b));
  return memo.get(key)!;
}
function computeClue(id: string, b: Board): boolean[] {
  // Advanced mode: "the habitat is not ..." is exactly the spaces the positive clue rules out.
  if (id.startsWith('!')) return computeClue(id.slice(1), b).map((x) => !x);
  const [kind, arg] = id.split(':');
  const near = (n: number, has: (i: number) => boolean) =>
    b.hexes.map((_, i) => b.hexes.some((_, j) => has(j) && DIST[i][j] <= n));
  if (kind === 'on') { const [x, y] = arg.split('+'); return b.hexes.map((h) => h.terrain === x || h.terrain === y); }
  if (kind === '1' && arg === 'animal') return near(1, (j) => !!b.hexes[j].animal);
  if (kind === '1') return near(1, (j) => b.hexes[j].terrain === arg);
  if (kind === '2' && (arg === 'stone' || arg === 'shack')) return near(2, (j) => b.hexes[j].structure?.kind === arg);
  if (kind === '2') return near(2, (j) => b.hexes[j].animal === arg);
  if (kind === '3') return near(3, (j) => b.hexes[j].structure?.color === arg);
  throw new Error(`unknown clue ${id}`);
}

// ---- Independent rules: legality and resolution, from "Playing the game", "Core principles", etc. ----

type Marks = { cube: number | null; discs: number[] }[];
const clueOf = (s: GameState, p: number) => oracleClue(s.clues[p], s.board);
const hasPiece = (m: Marks[number], p: number) => m.cube === p || m.discs.includes(p);

/** Rulebook legality. Returns true when the action is allowed. */
function oracleLegal(s: GameState, p: number, a: Action): boolean {
  if (s.phase === 'over' || p !== s.turn) return false;
  if (!Number.isInteger(a.space) || a.space < 0 || a.space >= SPACES) return false;
  const m = s.marks[a.space], mine = clueOf(s, p);
  // Core principle: never interact with a space that contains any cube.
  if (m.cube !== null) return false;
  if (s.phase === 'setup' || s.phase === 'penalty') return a.type === 'cube' && !mine[a.space] && !hasPiece(m, p);
  if (s.phase === 'disc') return a.type === 'disc' && mine[a.space] && !m.discs.includes(p);
  if (a.type === 'question') {
    // Any other player, any open space; they cannot add a second piece to a space they already marked.
    return Number.isInteger(a.target) && a.target >= 0 && a.target < s.players.length && a.target !== p && !hasPiece(m, a.target);
  }
  if (a.type === 'search') return mine[a.space]; // "a space which could be the habitat according to your clue"
  return false;
}

function allActions(s: GameState): Action[] {
  const out: Action[] = [];
  for (let space = 0; space < SPACES; space++) {
    out.push({ type: 'cube', space }, { type: 'search', space }, { type: 'disc', space });
    for (let target = 0; target < s.players.length; target++) out.push({ type: 'question', space, target });
  }
  return out;
}

const cubeTargets = (s: { marks: Marks }, mine: boolean[], p: number) =>
  s.marks.flatMap((m, i) => (m.cube === null && !hasPiece(m, p) && !mine[i] ? [i] : []));

interface Expect { marks: Marks; phase: GameState['phase']; turn: number; winner: number | null }

/** Rulebook resolution of one legal action. */
function oracleNext(s: GameState, p: number, a: Action): Expect {
  const marks: Marks = structuredClone(s.marks);
  const n = s.players.length, left = (p + 1) % n;
  const penalty = (): Expect =>
    // "If you make someone place a cube on your turn, you must also place one of your cubes."
    cubeTargets({ marks }, clueOf(s, p), p).length ? { marks, phase: 'penalty', turn: p, winner: null } : { marks, phase: 'play', turn: left, winner: null };
  const search = (space: number): Expect => {
    if (!marks[space].discs.includes(p)) marks[space].discs.push(p);
    // "Moving clockwise, ask each other player"; a player with a disc there already passes; the first cube stops it.
    for (let k = 1; k < n; k++) {
      const q = (p + k) % n;
      if (marks[space].discs.includes(q)) continue;
      if (clueOf(s, q)[space]) marks[space].discs.push(q);
      else { marks[space].cube = q; return penalty(); }
    }
    return { marks, phase: 'over', turn: p, winner: p };
  };

  if (s.phase === 'setup') {
    marks[a.space].cube = p;
    const placed = s.log.filter((l) => l.t === 'setup').length + 1;
    return placed === 2 * n ? { marks, phase: 'play', turn: 0, winner: null } : { marks, phase: 'setup', turn: left, winner: null };
  }
  if (s.phase === 'penalty') { marks[a.space].cube = p; return { marks, phase: 'play', turn: left, winner: null }; }
  if (a.type === 'disc') { marks[a.space].discs.push(p); return search(s.searching!); }
  if (a.type === 'question') {
    if (clueOf(s, a.target)[a.space]) { marks[a.space].discs.push(a.target); return { marks, phase: 'play', turn: left, winner: null }; }
    marks[a.space].cube = a.target;
    return penalty();
  }
  // Search. "If one of your discs is already on that space, you must place a disc on a different space which
  // could be the habitat according to your clue, and which does not already contain one of your discs."
  const mine = clueOf(s, p);
  if (marks[a.space].discs.includes(p) && marks.some((m, i) => i !== a.space && m.cube === null && mine[i] && !m.discs.includes(p))) {
    return { marks, phase: 'disc', turn: p, winner: null };
  }
  return search(a.space);
}

/** Invariants that must hold in every reachable state. */
function checkInvariants(s: GameState, prev: GameState | null) {
  s.marks.forEach((m, i) => {
    // Honesty: every piece agrees with its owner's clue.
    if (m.cube !== null) assert.equal(clueOf(s, m.cube)[i], false, `cube by ${m.cube} on ${i} contradicts its clue`);
    for (const q of m.discs) assert.equal(clueOf(s, q)[i], true, `disc by ${q} on ${i} contradicts its clue`);
    // One piece per player per space; a cube never shares a space with that player's disc.
    assert.equal(new Set(m.discs).size, m.discs.length);
    if (m.cube !== null) assert.ok(!m.discs.includes(m.cube));
    if (prev) {
      // Pieces are never removed, and nothing is added to a space that already had a cube.
      const was = prev.marks[i];
      if (was.cube !== null) { assert.equal(m.cube, was.cube); assert.deepEqual(m.discs, was.discs); }
      assert.deepEqual(m.discs.slice(0, was.discs.length), was.discs);
    }
  });
  // An honest table can never close the habitat.
  assert.equal(s.marks[s.habitat].cube, null);
}

function checkViews(s: GameState) {
  const over = s.phase === 'over';
  for (let p = 0; p < s.players.length; p++) {
    const v = viewFor(s, p), json = JSON.stringify(v);
    assert.equal(v.habitat, over ? s.habitat : null);
    for (let q = 0; q < s.players.length; q++) {
      if (q === p || over) continue;
      assert.equal(v.clues[q], null);
      assert.ok(!json.includes(`"${s.clues[q]}"`), 'another player\'s clue leaked into a view');
    }
  }
}

// ---- Tests ----

test('geometry: engine adjacency and distance match plane geometry on the 12 x 9 map', () => {
  assert.equal(COLS * ROWS, 108);
  for (let i = 0; i < SPACES; i++) {
    assert.deepEqual([...neighbors(i)].sort((a, b) => a - b), ADJ[i]);
    for (let j = 0; j < SPACES; j++) assert.equal(distance(i, j), DIST[i][j]);
  }
});

test('clues: the 23 standard-mode clues, worded as in the rulebook, with matching semantics on many boards', () => {
  const expected = [
    ...TERRAINS.flatMap((a, i) => TERRAINS.slice(i + 1).map((b) => `on:${a}+${b}`)),
    ...TERRAINS.map((t) => `1:${t}`), '1:animal', '2:stone', '2:shack', '2:bear', '2:cougar', '3:white', '3:green', '3:blue',
  ];
  assert.deepEqual(cluesFor('standard').map((c) => c.id).sort(), expected.sort());
  // Standard mode: positive clues only, no black structures.
  for (const c of cluesFor('standard')) assert.ok(!/^not |black/.test(c.text), c.text);
  // Advanced (hard) mode: black joins the colour clues, and every clue also comes in a "not" form.
  const positives = [...expected, '3:black'];
  assert.deepEqual(cluesFor('hard').map((c) => c.id).sort(), [...positives, ...positives.map((id) => `!${id}`)].sort());
  assert.equal(CLUE['!2:bear'].text, 'not within two spaces of bear territory');
  assert.equal(CLUE['3:black'].text, 'within three spaces of a black structure');
  assert.equal(CLUE['on:forest+swamp'].text, 'on forest or swamp');
  assert.equal(CLUE['1:desert'].text, 'within one space of desert');
  assert.equal(CLUE['1:animal'].text, 'within one space of either animal territory');
  assert.equal(CLUE['2:stone'].text, 'within two spaces of a standing stone');
  assert.equal(CLUE['2:bear'].text, 'within two spaces of bear territory');
  assert.equal(CLUE['3:blue'].text, 'within three spaces of a blue structure');
  for (let seed = 1; seed <= 25; seed++) {
    for (const mode of ['standard', 'hard'] as Mode[]) {
      const b = generateBoard(seed * 7, mode);
      for (const c of cluesFor(mode)) assert.deepEqual(clueMap(c.id, b), oracleClue(c.id, b), `${c.id} on ${mode} board ${seed}`);
    }
  }
});

test('setup: standard-mode map pieces (three stones, three shacks; white, green, blue) and both territories', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = generateBoard(seed);
    const st = b.hexes.flatMap((h) => (h.structure ? [`${h.structure.kind}:${h.structure.color}`] : []));
    assert.deepEqual(st.sort(), ['shack:blue', 'shack:green', 'shack:white', 'stone:blue', 'stone:green', 'stone:white']);
    for (const t of TERRAINS) assert.ok(b.hexes.some((h) => h.terrain === t), `${t} missing on ${seed}`);
    assert.ok(b.hexes.some((h) => h.animal === 'bear') && b.hexes.some((h) => h.animal === 'cougar'));
    // Advanced mode: "All four structures of each type are used instead of three."
    const hard = generateBoard(seed, 'hard').hexes.flatMap((h) => (h.structure ? [`${h.structure.kind}:${h.structure.color}`] : []));
    assert.deepEqual(hard.sort(), ['shack:black', 'shack:blue', 'shack:green', 'shack:white', 'stone:black', 'stone:blue', 'stone:green', 'stone:white']);
  }
});

test('setup: every player gets a different clue, the clues meet on exactly one habitat, and the draw is secret', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const [n, mode] of [3, 4, 5].flatMap((n) => [[n, 'standard'], [n, 'hard']] as [number, Mode][])) {
      const sc = generateScenario(seed, n, seed * 31 + n, mode);
      assert.equal(new Set(sc.clues).size, n, 'players are never given identical clues');
      assert.ok(sc.clues.every((id) => cluesFor(mode).some((c) => c.id === id)), `${mode} deals only ${mode} clues`);
      if (mode === 'hard') assert.ok(sc.clues.some((id) => id.startsWith('!')), 'hard mode deals at least one "not" clue');
      for (let k = 0; k < n; k++) {
        const rest = sc.clues.filter((_, j) => j !== k).map((id) => oracleClue(id, sc.board));
        assert.ok(sc.board.hexes.filter((_, i) => rest.every((m) => m[i])).length > 1, 'every clue is needed');
      }
      const all = sc.clues.map((id) => oracleClue(id, sc.board));
      assert.deepEqual(sc.board.hexes.flatMap((_, i) => (all.every((m) => m[i]) ? [i] : [])), [sc.habitat]);
      // Every player can always make their two opening cubes even after everyone else's.
      for (const m of all) assert.ok(m.filter((x) => !x).length >= 2 * n);
    }
  }
  // The board seed is public; the clue draw must not follow from it.
  let differ = 0;
  for (let k = 0; k < 20; k++) {
    const a = generateScenario(77, 4, 1000 + k), b = generateScenario(77, 4, 5000 + k);
    if (a.board.seed === b.board.seed && a.clues.join() !== b.clues.join()) differ++;
  }
  assert.ok(differ >= 15, `same board, different secrets should usually draw different clues (${differ}/20)`);
});

test('setup: initial sharing goes clockwise one cube at a time until everyone has two, then the starter plays', () => {
  for (const n of [3, 4, 5]) {
    let s = newGame(9 + n, Array.from({ length: n }, (_, k) => `P${k}`), 4242);
    const order: number[] = [];
    while (s.phase === 'setup') {
      order.push(s.turn);
      const mine = clueOf(s, s.turn);
      s = apply(s, s.turn, { type: 'cube', space: cubeTargets(s, mine, s.turn)[0] });
    }
    assert.deepEqual(order, [...Array(2 * n).keys()].map((k) => k % n));
    assert.equal(s.phase, 'play');
    assert.equal(s.turn, 0);
  }
});

test('full games: the engine matches the rulebook oracle at every step, for every possible action', () => {
  let games = 0, wins = 0, searches = 0, questions = 0, penalties = 0, extraDiscs = 0;
  for (let g = 0; g < 60; g++) {
    const n = 3 + (g % 3), mode: Mode = g % 2 ? 'hard' : 'standard';
    let s = newGame(1000 + g, Array.from({ length: n }, (_, k) => `P${k}`), 77 + g * 13, mode);
    const r = rng(g + 1);
    checkInvariants(s, null);
    for (let step = 0; step < 500 && s.phase !== 'over'; step++) {
      // Legality: engine and oracle agree on every action for every player.
      const legal: Action[] = [];
      for (let p = 0; p < n; p++) {
        for (const a of allActions(s)) {
          const ok = oracleLegal(s, p, a);
          assert.equal(illegal(s, p, a) === null, ok, `step ${step} p${p} ${JSON.stringify(a)} phase ${s.phase}`);
          if (ok) legal.push(a);
        }
      }
      // Liveness: the player to act always has a legal move.
      assert.ok(legal.length > 0, `no legal move for p${s.turn} in ${s.phase}`);
      // Pick a move: lean toward searches so games finish, but question plenty too.
      const searchesNow = legal.filter((a) => a.type === 'search');
      const a = searchesNow.length && r() < 0.3 ? searchesNow[Math.floor(r() * searchesNow.length)] : legal[Math.floor(r() * legal.length)];
      const p = s.turn, before = JSON.stringify(s);
      const want = oracleNext(s, p, a);
      const next = apply(s, p, a);
      assert.equal(JSON.stringify(s), before, 'apply must not mutate its input');
      assert.deepEqual(next.marks, want.marks, `marks after ${JSON.stringify(a)}`);
      assert.equal(next.phase, want.phase);
      assert.equal(next.turn, want.turn);
      assert.equal(next.winner, want.winner);
      if (a.type === 'search') {
        searches++;
        // A search succeeds exactly on the habitat.
        if (next.phase !== 'disc') assert.equal(next.phase === 'over', a.space === s.habitat);
        if (next.phase === 'disc') extraDiscs++;
      }
      if (a.type === 'question') questions++;
      if (s.phase === 'penalty') penalties++;
      checkInvariants(next, s);
      if (step % 7 === 0) checkViews(next);
      s = next;
    }
    games++;
    if (s.phase === 'over') { wins++; checkViews(s); }
  }
  // The random tables really exercised every rule.
  assert.ok(wins > games / 2, `${wins}/${games} games ended in a found habitat`);
  for (const [k, v] of Object.entries({ searches, questions, penalties, extraDiscs })) assert.ok(v > 0, `${k} never happened`);
});

test('core principle: a space with any cube is closed to questions, searches and pieces', () => {
  let s = newGame(5, ['A', 'B', 'C'], 99);
  const space = cubeTargets(s, clueOf(s, 0), 0)[0];
  s = apply(s, 0, { type: 'cube', space });
  for (let p = 0; p < 3; p++) {
    for (const a of [{ type: 'cube', space }, { type: 'search', space }, { type: 'disc', space }, { type: 'question', space, target: (p + 1) % 3 }] as Action[]) {
      assert.ok(illegal({ ...s, turn: p }, p, a), `${a.type} on a cubed space must be refused`);
    }
  }
});

test('question: may target any open space, even one your own clue rules out', () => {
  let s = newGame(8, ['A', 'B', 'C'], 8);
  while (s.phase === 'setup') s = apply(s, s.turn, { type: 'cube', space: cubeTargets(s, clueOf(s, s.turn), s.turn)[0] });
  const ruledOut = clueOf(s, 0).findIndex((ok, i) => !ok && s.marks[i].cube === null);
  assert.equal(illegal(s, 0, { type: 'question', space: ruledOut, target: 1 }), null);
  assert.ok(illegal(s, 0, { type: 'question', space: ruledOut, target: 0 }), 'you question another player, never yourself');
});
