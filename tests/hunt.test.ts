import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLUE, clueMap } from '../shared/board.ts';
import { CRYPTIDS, HUNT_MODES, MODE_RULES, generateHunt, hintFor, narrowing } from '../shared/hunt.ts';

test('hunts: every clue is true of the habitat, narrows the field, and the last leaves exactly one space', () => {
  for (let s = 1; s <= 150; s++) {
    const h = generateHunt(s * 7, s * 131);
    assert.ok(h.clues.length >= 5 && h.clues.length <= 7, `seed ${s}: ${h.clues.length} clues`);
    assert.equal(new Set(h.clues).size, h.clues.length, 'no clue repeats');
    assert.ok(h.board.hexes.every((x) => x.structure?.color !== 'black'), 'standard boards only');
    for (const id of h.clues) {
      assert.ok(CLUE[id], id);
      assert.ok(clueMap(id, h.board)[h.habitat], `seed ${s}: "${CLUE[id].text}" is false at the habitat`);
    }
    const n = narrowing(h.board, h.clues);
    for (let k = 1; k < n.length; k++) assert.ok(n[k] < n[k - 1], `seed ${s}: clue ${k} removes nothing`);
    assert.equal(n.at(-1), 1);
    assert.ok(n.at(-2)! >= 3, 'the final clue still matters');
    assert.ok(h.cryptid >= 0 && h.cryptid < CRYPTIDS.length);
  }
});

test('hunts: the clue draw comes from the secret, not the public board seed', () => {
  const a = generateHunt(42, 1), b = generateHunt(42, 2);
  assert.deepEqual(a.board, b.board);
  assert.notDeepEqual([a.clues, a.habitat], [b.clues, b.habitat]);
});

test('hunts: feedback is a band of distance only, never a direction', () => {
  for (const mode of HUNT_MODES) assert.equal(hintFor(mode, 0), 'found');
  assert.deepEqual([1, 2, 3, 9].map((d) => hintFor('classic', d)), ['near', 'near', 'far', 'far']);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 11].map((d) => hintFor('hotcold', d)), ['scorching', 'hot', 'warm', 'cool', 'cool', 'cold', 'cold']);
  assert.equal(hintFor('oneshot', 3), 'sealed');
  assert.equal(MODE_RULES.oneshot.shots, 1);
  assert.ok(MODE_RULES.classic.cooldownMs(3) > MODE_RULES.classic.cooldownMs(1), 'classic misses cost more each time');
});
