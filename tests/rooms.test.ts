import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { attach } from '../server/rooms.ts';
import { allowed, cubeSpaces } from '../shared/engine.ts';
import { CLUES } from '../shared/board.ts';
import type { RoomUpdate } from '../shared/protocol.ts';

const http = createServer();
const io = new Server(http);
attach(io, () => 3);
await new Promise<void>((r) => http.listen(0, r));
const url = `http://localhost:${(http.address() as { port: number }).port}`;
const sockets: Socket[] = [];
after(() => { sockets.forEach((s) => s.close()); io.close(); });

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  let last: RoomUpdate | null = null;
  s.on('room', (u: RoomUpdate) => (last = u));
  const send = (event: string, msg?: unknown) => s.emitWithAck(event, msg);
  // Wait until the latest update matches.
  const until = async (ok: (u: RoomUpdate) => boolean) => {
    for (let i = 0; i < 100 && !(last && ok(last)); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(last && ok(last), 'expected room update did not arrive');
    return last!;
  };
  return { s, send, until, raw: () => JSON.stringify(last) };
}

test('rooms: join, start, private views, out-of-turn rejection, reconnect', async () => {
  const [a, b, c] = [client(), client(), client()];
  const made = await a.send('create', { name: 'Ana' });
  assert.equal(made.ok, true);
  const bJoin = await b.send('join', { code: made.code.toLowerCase(), name: 'Ben' });
  assert.equal(bJoin.ok, true);
  assert.match((await c.send('join', { code: made.code, name: 'ben' })).error, /already uses/);
  const cJoin = await c.send('join', { code: made.code, name: 'Cy' });
  assert.equal(cJoin.you, 2);

  assert.match((await b.send('start')).error, /host/);
  assert.equal((await a.send('start')).ok, true);
  const [va, vb] = [await a.until((u) => !!u.view), await b.until((u) => !!u.view)];

  // Each seat sees its own clue and nobody else's; the habitat is never sent.
  assert.ok(va.view!.clues[0] && !va.view!.clues[1] && !va.view!.clues[2]);
  assert.ok(vb.view!.clues[1] && !vb.view!.clues[0]);
  assert.equal(va.view!.habitat, null);
  assert.ok(!a.raw().includes(vb.view!.clues[1]!));

  // Malformed and out-of-turn requests are refused.
  assert.match((await a.send('act', { type: 'cube', space: 'x' })).error, /malformed/);
  const space = cubeSpaces(vb.view!, 1).indexOf(true);
  assert.match((await b.send('act', { type: 'cube', space })).error, /Ana's turn/);
  const aSpace = cubeSpaces(va.view!, 0).indexOf(true);
  assert.equal((await a.send('act', { type: 'cube', space: aSpace })).ok, true);
  // The same request twice cannot resolve twice.
  assert.ok((await a.send('act', { type: 'cube', space: aSpace })).error);
  await b.until((u) => u.view!.turn === 1);

  // Ben drops and comes back with his token to the same seat and the same private clue.
  b.s.close();
  await a.until((u) => !u.seats[1].online);
  const b2 = client();
  assert.equal((await b2.send('resume', { code: made.code, token: 'not-a-real-token-but-long-enough' })).ok, false);
  const real = await b2.send('resume', { code: made.code, token: bJoin.token });
  assert.equal(real.you, 1);
  const vb2 = await b2.until((u) => !!u.view && u.seats[1].online);
  assert.equal(vb2.view!.clues[1], vb.view!.clues[1]);
  assert.equal(vb2.view!.clues[0], null);
});


test('rooms: a whole game over sockets, each seat acting only on its own view, with no clue ever leaked', async () => {
  const seats = [client(), client(), client()];
  const made = await seats[0].send('create', { name: 'Host' });
  await seats[1].send('join', { code: made.code, name: 'Two' });
  await seats[2].send('join', { code: made.code, name: 'Three' });
  assert.equal((await seats[0].send('start')).ok, true);
  const pause = () => new Promise((r) => setTimeout(r, 40)); // stay under the per-socket rate limit
  let over = null as RoomUpdate | null;
  for (let step = 0; step < 400 && !over; step++) {
    const views = await Promise.all(seats.map((c) => c.until((u) => !!u.view)));
    for (const [p, u] of views.entries()) {
      const v = u.view!;
      if (v.phase === 'over') { over = u; break; }
      // Only your own clue text and id ever reach your socket; the habitat stays null.
      assert.equal(v.habitat, null);
      const raw = seats[p].raw();
      for (const c of CLUES) if (c.id !== v.clues[p]) assert.ok(!raw.includes(`"${c.id}"`), `seat ${p} received ${c.id}`);
    }
    if (over) break;
    const turn = views[0].view!.turn, v = views[turn].view!;
    const mine = allowed(v, turn)!;
    // A simple honest policy: opening and penalty cubes where the clue rules out, otherwise search the
    // open space your clue allows that already carries the most discs.
    const action = v.phase === 'setup' || v.phase === 'penalty'
      ? { type: 'cube', space: cubeSpaces(v, turn).indexOf(true) }
      : v.phase === 'disc'
        ? { type: 'disc', space: v.marks.findIndex((m, i) => mine[i] && m.cube === null && !m.discs.includes(turn)) }
        : { type: 'search', space: v.marks.map((m, i) => (mine[i] && m.cube === null ? m.discs.length : -1)).reduce((b, x, i, a) => (x > a[b] ? i : b), 0) };
    const before = v.log.length;
    const res = await seats[turn].send('act', action);
    assert.equal(res.ok, true, JSON.stringify(res));
    await seats[turn].until((u) => u.view!.log.length > before || u.view!.phase === 'disc' || u.view!.phase === 'over');
    await pause();
  }
  assert.ok(over, 'the game should reach a found habitat');
  const end = over!.view!;
  assert.notEqual(end.habitat, null);
  assert.ok(end.clues.every(Boolean), 'clues are revealed to everyone once the habitat is found');
  assert.equal(end.marks[end.habitat!].cube, null);
});

test('rooms: the host picks hard mode at start; anything else is refused', async () => {
  const [a, b, c] = [client(), client(), client()];
  const made = await a.send('create', { name: 'Ana' });
  await b.send('join', { code: made.code, name: 'Ben' });
  await c.send('join', { code: made.code, name: 'Cy' });
  assert.match((await a.send('start', { mode: 'nightmare' })).error, /malformed/);
  assert.match((await a.send('start', { mode: 'hard', extra: 1 })).error, /malformed/);
  assert.equal((await a.send('start', { mode: 'hard' })).ok, true);
  const v = (await b.until((u) => !!u.view)).view!;
  assert.equal(v.board.mode, 'hard');
  assert.equal(v.board.hexes.filter((h) => h.structure?.color === 'black').length, 2);
  assert.ok(v.clues[1] && v.clues.filter(Boolean).length === 1);
});
