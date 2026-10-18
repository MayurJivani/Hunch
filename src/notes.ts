// The deduction notebook: what the table's public pieces say about each player's clue.
// Only reads pieces everyone can see on the board, so it reveals nothing a careful player with pen and paper
// (as the rulebook suggests) could not work out.
import { CLUE, SPACES, clueMap, cluesFor } from '../shared/board.ts';
import type { PlayerView } from '../shared/engine.ts';

const maps = new Map<string, boolean[]>();
function map(view: PlayerView, id: string) {
  const key = `${view.board.seed}|${view.board.mode}|${id}`;
  if (!maps.has(key)) {
    if (maps.size > 400) maps.clear();
    maps.set(key, clueMap(id, view.board));
  }
  return maps.get(key)!;
}

/** Clue ids player p could hold, given every disc (allows) and cube (rules out) they have placed. */
export function suspects(view: PlayerView, p: number): string[] {
  const discs: number[] = [], cubes: number[] = [];
  view.marks.forEach((m, i) => { if (m.discs.includes(p)) discs.push(i); if (m.cube === p) cubes.push(i); });
  return cluesFor(view.board.mode).map((c) => c.id).filter((id) => {
    const m = map(view, id);
    return discs.every((i) => m[i]) && cubes.every((i) => !m[i]);
  });
}

/**
 * Spaces that can still be the habitat as far as `you` can tell: your own clue allows them, nobody has a cube
 * there, and every other player has at least one possible clue that allows them.
 */
export function openHabitats(view: PlayerView, you: number): boolean[] {
  const mine = map(view, view.clues[you]!);
  const others = view.players.map((_, p) => (p === you ? null : suspects(view, p).map((id) => map(view, id))));
  return Array.from({ length: SPACES }, (_, i) =>
    mine[i] && view.marks[i].cube === null && others.every((ms) => !ms || ms.some((m) => m[i])));
}

export const clueText = (id: string) => CLUE[id].text;
