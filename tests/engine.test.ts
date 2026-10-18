import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Board, type Hex, CLUES, COLS, cluesFor, SPACES, clueMap, distance, evaluateClue, findValidHabitats,
  generateBoard, generateScenario, neighbors, spaceName,
} from '../shared/board.ts';
import { type GameState, allowed, apply, cubeSpaces, illegal, newGame, viewFor } from '../shared/engine.ts';

const idx = (col: number, row: number) => row * COLS + col;

test('hex geometry: odd-q neighbours and distance agree', () => {
  assert.deepEqual(neighbors(idx(0, 0)).sort((a, b) => a - b), [idx(1, 0), idx(0, 1)].sort((a, b) => a - b));
  assert.equal(neighbors(idx(5, 4)).length, 6);
  for (let i = 0; i < SPACES; i++) for (const n of neighbors(i)) assert.equal(distance(i, n), 1);
  assert.equal(distance(idx(0, 0), idx(11, 8)), 14); // 11 diagonal steps cover 5 rows, 3 more straight down
  assert.equal(spaceName(idx(2, 3)), 'C4');
});

// A blank desert board with one feature per test.
function board(edit: (h: Hex[]) => void): Board {
  const hexes: Hex[] = Array.from({ length: SPACES }, () => ({ terrain: 'desert' }));
  edit(hexes);
  return { seed: Math.random() * 1e9 | 0, mode: 'standard', hexes };
}

test('every clue family: positive and negative cases, "within" includes the feature itself', () => {
  const c = idx(5, 4);
  const far = idx(0, 0);
  const at = (n: number) => neighbors(c).flatMap(neighbors).find((i) => distance(i, c) === n)!;
  const ring3 = [...Array(SPACES).keys()].find((i) => distance(i, c) === 3)!;
  const ring4 = [...Array(SPACES).keys()].find((i) => distance(i, c) === 4)!;

  const cases: [string, (h: Hex[]) => void, number[], number[]][] = [
    ['on:forest+water', (h) => { h[c].terrain = 'forest'; h[far].terrain = 'water'; }, [c, far], [neighbors(c)[0]]],
    ['1:swamp', (h) => { h[c].terrain = 'swamp'; }, [c, neighbors(c)[0]], [at(2)]],
    ['1:animal', (h) => { h[c].animal = 'cougar'; }, [c, neighbors(c)[1]], [at(2)]],
    ['2:stone', (h) => { h[c].structure = { kind: 'stone', color: 'blue' }; }, [c, at(2)], [ring3]],
    ['2:shack', (h) => { h[c].structure = { kind: 'stone', color: 'blue' }; }, [], [c]],
    ['2:bear', (h) => { h[c].animal = 'bear'; }, [c, at(2)], [ring3]],
    ['2:cougar', (h) => { h[c].animal = 'bear'; }, [], [c]],
    ['3:green', (h) => { h[c].structure = { kind: 'shack', color: 'green' }; }, [c, ring3], [ring4]],
    ['3:white', (h) => { h[c].structure = { kind: 'shack', color: 'green' }; }, [], [c]],
  ];
  for (const [id, edit, yes, no] of cases) {
    const b = board(edit);
    for (const i of yes) assert.equal(evaluateClue(id, b, i), true, `${id} should allow ${spaceName(i)}`);
    for (const i of no) assert.equal(evaluateClue(id, b, i), false, `${id} should rule out ${spaceName(i)}`);
  }
  assert.equal(cluesFor('standard').length, 23); // 10 + 5 + 1 + 2 + 2 + 3 standard clues
  assert.equal(CLUES.length, 48); // hard mode: 24 positive (black added) and their 24 "not" forms
});

test('generated boards are reproducible and complete', () => {
  assert.deepEqual(generateBoard(42), generateBoard(42));
  const b = generateBoard(7);
  const structures = b.hexes.filter((h) => h.structure);
  assert.equal(structures.length, 6);
  for (const t of ['forest', 'desert', 'water', 'mountain', 'swamp']) assert.ok(b.hexes.some((h) => h.terrain === t));
  assert.ok(b.hexes.some((h) => h.animal === 'bear') && b.hexes.some((h) => h.animal === 'cougar'));
});

test('every scenario has exactly one habitat and no redundant clue', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const n of [3, 4, 5]) {
      const s = generateScenario(seed, n, seed);
      assert.equal(new Set(s.clues).size, n);
      assert.deepEqual(findValidHabitats(s.board, s.clues), [s.habitat], `seed ${seed} / ${n}p`);
      for (let k = 0; k < n; k++) {
        assert.ok(findValidHabitats(s.board, s.clues.filter((_, j) => j !== k)).length > 1, `clue ${k} redundant`);
      }
    }
  }
  assert.throws(() => generateScenario(1, 2, 1));
});

// --- turn flow ---

const firstCube = (s: GameState, p: number) => cubeSpaces(s, p).indexOf(true);

function afterSetup(seed = 3, names = ['Ana', 'Ben', 'Cy']) {
  let s = newGame(seed, names, seed);
  for (let k = 0; k < names.length * 2; k++) s = apply(s, s.turn, { type: 'cube', space: firstCube(s, s.turn) });
  return s;
}

test('setup: two cubes each in turn order, only on spaces your clue rules out', () => {
  let s = newGame(3, ['Ana', 'Ben', 'Cy'], 3);
  const yes = allowed(s, 0)!.indexOf(true);
  assert.match(illegal(s, 0, { type: 'cube', space: yes })!, /lie/);
  assert.match(illegal(s, 1, { type: 'cube', space: firstCube(s, 1) })!, /Ana's turn/);
  assert.match(illegal(s, 0, { type: 'search', space: yes })!, /opening cubes/);
  s = apply(s, 0, { type: 'cube', space: firstCube(s, 0) });
  assert.equal(s.turn, 1);
  const taken = (s.log[0] as { space: number }).space;
  assert.match(illegal(s, 1, { type: 'cube', space: taken })!, /closed/);
  s = afterSetup();
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 0);
  assert.equal(s.marks.filter((m) => m.cube !== null).length, 6);
});

test('illegal actions never mutate state', () => {
  const s = afterSetup();
  const before = JSON.stringify(s);
  assert.throws(() => apply(s, 1, { type: 'search', space: 0 }));
  assert.throws(() => apply(s, 0, { type: 'question', space: 0, target: 0 }));
  assert.throws(() => apply(s, 0, { type: 'question', space: 999, target: 1 }));
  assert.equal(JSON.stringify(s), before);
});

test('question: a disc passes the turn, a cube costs the asker a penalty cube', () => {
  const s = afterSetup();
  const ben = allowed(s, 1)!;
  const open = (i: number) => s.marks[i].cube === null;
  const yesSpace = ben.findIndex((v, i) => v && open(i));
  const noSpace = ben.findIndex((v, i) => !v && open(i));

  const a = apply(s, 0, { type: 'question', space: yesSpace, target: 1 });
  assert.deepEqual(a.marks[yesSpace].discs, [1]);
  assert.equal(a.turn, 1);
  assert.match(illegal({ ...a, turn: 0 }, 0, { type: 'question', space: yesSpace, target: 1 })!, /already has a disc/);

  const b = apply(s, 0, { type: 'question', space: noSpace, target: 1 });
  assert.equal(b.marks[noSpace].cube, 1);
  assert.equal(b.phase, 'penalty');
  assert.equal(b.turn, 0);
  assert.match(illegal(b, 0, { type: 'question', space: yesSpace, target: 2 })!, /penalty cube/);
  const c = apply(b, 0, { type: 'cube', space: firstCube(b, 0) });
  assert.equal(c.phase, 'play');
  assert.equal(c.turn, 1);
  assert.equal(c.log.at(-1)!.t, 'penalty');
});

test('search: wins on the habitat, fails with a penalty anywhere else', () => {
  const s = afterSetup();
  assert.match(illegal(s, 0, { type: 'search', space: allowed(s, 0)!.indexOf(false) })!, /closed|own clue/);

  const win = apply(s, 0, { type: 'search', space: s.habitat });
  assert.equal(win.phase, 'over');
  assert.equal(win.winner, 0);
  assert.deepEqual(win.marks[s.habitat].discs.sort(), [0, 1, 2]);
  assert.throws(() => apply(win, 1, { type: 'search', space: s.habitat }), /over/);

  const ana = allowed(s, 0)!;
  const wrong = ana.findIndex((v, i) => v && i !== s.habitat && s.marks[i].cube === null);
  const fail = apply(s, 0, { type: 'search', space: wrong });
  assert.equal(fail.phase, 'penalty');
  assert.equal(fail.winner, null);
  const entry = fail.log.at(-1)!;
  assert.ok(entry.t === 'search' && !entry.found && entry.answers.at(-1)!.answer === 'cube');
  assert.ok(fail.marks[wrong].discs.includes(0));
});

test('player views never carry other clues or the habitat until the game ends', () => {
  const s = afterSetup(11, ['Ana', 'Ben', 'Cy', 'Dee']);
  for (let p = 0; p < 4; p++) {
    const v = viewFor(s, p);
    assert.equal(v.habitat, null);
    assert.deepEqual(v.clues.map((c, i) => (i === p ? c : null)), v.clues);
    const json = JSON.stringify(v);
    for (let q = 0; q < 4; q++) if (q !== p) assert.ok(!json.includes(`"${s.clues[q]}"`));
  }
  assert.deepEqual(viewFor(s, null).clues, [null, null, null, null]);
  // A masked view still answers legality for its own player.
  const v = viewFor(s, 0);
  const space = allowed(s, 0)!.findIndex((ok, i) => ok && s.marks[i].cube === null);
  assert.equal(illegal(v, 0, { type: 'search', space }), illegal(s, 0, { type: 'search', space }));

  const done = viewFor(apply(s, 0, { type: 'search', space: s.habitat }), 2);
  assert.equal(done.habitat, s.habitat);
  assert.deepEqual(done.clues, s.clues);
});

test('clue maps match the cached map used by the engine', () => {
  const s = newGame(5, ['A', 'B', 'C'], 5);
  for (let p = 0; p < 3; p++) assert.deepEqual(allowed(s, p), clueMap(s.clues[p], s.board));
});

test('search where you already have a disc: place an extra disc elsewhere first (rulebook)', () => {
  let s = afterSetup();
  // Give Ana a disc on the habitat via Ben questioning her about it.
  s = apply(s, 0, { type: 'question', space: s.habitat, target: 1 }); // Ben's clue allows the habitat: disc
  s = { ...s, marks: s.marks.map((m, i) => (i === s.habitat ? { ...m, discs: [...m.discs, 0] } : m)), turn: 0 };
  const searched = apply(s, 0, { type: 'search', space: s.habitat });
  assert.equal(searched.phase, 'disc');
  assert.equal(searched.searching, s.habitat);
  assert.match(illegal(searched, 0, { type: 'disc', space: s.habitat })!, /already have a disc/);
  assert.match(illegal(searched, 0, { type: 'question', space: 0, target: 1 })!, /extra disc/);
  const ok = allowed(s, 0)!;
  const extra = ok.findIndex((v, i) => v && i !== s.habitat && s.marks[i].cube === null && !s.marks[i].discs.includes(0));
  const done = apply(searched, 0, { type: 'disc', space: extra });
  assert.equal(done.phase, 'over');
  assert.equal(done.winner, 0);
  assert.ok(done.marks[extra].discs.includes(0));
  const entry = done.log.at(-1)!;
  assert.ok(entry.t === 'search' && entry.extra === extra);
});
