import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { attachPublic } from '../server/public.ts';
import { attach } from '../server/rooms.ts';
import { distance } from '../shared/board.ts';
import type { HunterView, HuntState } from '../shared/hunt.ts';

const http = createServer();
const io = new Server(http);
attach(io); // the private rooms keep working beside public hunts
const pub = attachPublic(io, { capacity: 3, briefingMs: 250, clueEveryMs: 250, graceMs: 300, cooldownScale: 0.02 });
await new Promise<void>((r) => http.listen(0, r));
const url = `http://localhost:${(http.address() as { port: number }).port}`;
const sockets: Socket[] = [];
after(() => { sockets.forEach((s) => s.close()); pub.close(); io.close(); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const nonce = () => `n-${++n}-${Math.random()}`;

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  const seen: string[] = []; // every raw public payload, to check nothing secret ever arrived
  let state: HuntState | null = null;
  s.on('public:state', (u: HuntState) => { state = u; seen.push(JSON.stringify(u)); });
  s.on('public:pulse', (p) => { if (state) state = { ...state, ...p }; seen.push(JSON.stringify(p)); });
  const send = async (event: string, msg?: unknown) => {
    const res = await s.emitWithAck(event, msg);
    seen.push(JSON.stringify(res));
    if (res.state) state = res.state;
    return res;
  };
  const until = async (ok: (u: HuntState) => boolean, ms = 3000) => {
    for (let t = 0; t < ms / 10 && !(state && ok(state)); t++) await wait(10);
    assert.ok(state && ok(state), 'expected hunt state did not arrive');
    return state!;
  };
  return { s, send, until, seen, state: () => state! };
}

const secretOf = (id: string) => pub.hunts.get(id)!.s;
const wrongSpace = (habitat: number, d: (x: number) => boolean) => [...Array(108).keys()].find((i) => i !== habitat && d(distance(i, habitat)))!;

test('public: shared clues on a server clock, late join, near/far misses, cooldown, idempotent guesses, first correct wins', async () => {
  const [a, b] = [client(), client()];
  const ja = await a.send('public:join', { mode: 'classic', name: 'Ana' });
  assert.equal(ja.ok, true);
  assert.equal(ja.state.phase, 'briefing');
  assert.equal(ja.state.clues.length, 0);
  const jb = await b.send('public:join', { mode: 'classic', name: 'Ben' });
  assert.equal(jb.state.id, ja.state.id, 'both land in the same hunt');
  assert.match((await a.send('public:guess', { space: 0, nonce: nonce() })).error, /not dropped/);

  const s = secretOf(ja.state.id);
  const live = await a.until((u) => u.phase === 'live');
  assert.deepEqual(live.clues, [s.clues[0]]);
  assert.equal(live.total, s.clues.length);
  await b.until((u) => u.clues.length === 1);

  // A late hunter gets every clue already out, and nothing ahead of it.
  await a.until((u) => u.clues.length === 2);
  const c = client();
  const jc = await c.send('public:join', { mode: 'classic', name: 'Cy' });
  assert.equal(jc.state.id, ja.state.id);
  assert.deepEqual(jc.state.clues, s.clues.slice(0, 2));

  // A miss: the server judges it, says near or far, and starts a cooldown.
  const far = wrongSpace(s.habitat, (d) => d >= 3);
  const k = nonce();
  const miss = await a.send('public:guess', { space: far, nonce: k });
  assert.equal(miss.ok, true);
  assert.equal(miss.guess.hint, 'far');
  assert.equal(miss.guess.d, undefined, 'the distance itself stays on the server');
  assert.deepEqual(await a.send('public:guess', { space: far, nonce: k }), miss, 'a resent guess is answered once');
  assert.equal(pub.hunts.get(ja.state.id)!.guesses, 1);
  assert.match((await a.send('public:guess', { space: s.habitat, nonce: nonce() })).error, /again in/);
  await wait(120);
  assert.match((await a.send('public:guess', { space: far, nonce: nonce() })).error, /already tried/);
  const near = wrongSpace(s.habitat, (d) => d === 2);
  assert.equal((await a.send('public:guess', { space: near, nonce: nonce() })).guess.hint, 'near');
  assert.equal((await a.send('public:guess', { space: 'x', nonce: nonce() })).error, 'That request was malformed.');

  // Two correct guesses fired together: the first one the server processes wins, the second finds it over.
  await wait(250);
  const [rb, rc] = await Promise.all([
    b.send('public:guess', { space: s.habitat, nonce: nonce() }),
    c.send('public:guess', { space: s.habitat, nonce: nonce() }),
  ]);
  const results = [rb, rc];
  assert.equal(results.filter((r) => r.ok && r.guess.hint === 'found').length, 1, JSON.stringify(results));
  assert.match(results.find((r) => !r.ok).error, /over/);
  const end = await a.until((u) => u.phase === 'over');
  assert.equal(end.result!.habitat, s.habitat);
  assert.deepEqual(end.result!.clues, s.clues);
  assert.equal(end.result!.winner!.name, rb.ok ? 'Ben' : 'Cy');
  assert.equal(end.result!.heat.reduce((x, y) => x + y, 0), 3);
  assert.equal(end.result!.closest[0].d, 0);

  // Before the reveal, no payload carried the habitat or a clue that had not dropped yet.
  for (const raw of [...a.seen, ...b.seen, ...c.seen]) {
    const msg = JSON.parse(raw), st: HuntState | undefined = msg.state ?? (msg.board ? msg : undefined);
    if (st?.phase === 'over' || msg.guess?.hint === 'found') continue;
    assert.ok(!raw.includes('"habitat"'), raw.slice(0, 80));
    if (st) for (const id of s.clues.slice(st.clues.length)) assert.ok(!raw.includes(`"${id}"`), `leaked ${id} early`);
  }

  const lb = await a.send('public:leaders', { mode: 'classic' });
  assert.equal(lb.leaders.all[0].value, 1);
  assert.equal(lb.leaders.you.entered, 1);
  assert.equal(lb.leaders.you.wins, 0);
  assert.equal((await a.send('public:leaders', { mode: 'oneshot' })).leaders.all.length, 0, 'rankings are per mode');
});

test('public: reconnect resumes the same hunter, and two tabs share one set of attempts', async () => {
  const a = client();
  const j = await a.send('public:join', { mode: 'hotcold', name: 'Ana' });
  const s = secretOf(j.state.id);
  await a.until((u) => u.phase === 'live');
  const warm = wrongSpace(s.habitat, (d) => d === 3);
  const g = await a.send('public:guess', { space: warm, nonce: nonce() });
  assert.equal(g.guess.hint, 'warm');

  // A second tab with the same token is the same hunter: same guesses, same cooldown, live updates.
  const tab = client();
  const t = await tab.send('public:join', { mode: 'hotcold', name: 'Ana', token: j.token });
  assert.equal(t.token, j.token);
  assert.equal(t.state.id, j.state.id);
  assert.equal(t.you.pid, j.you.pid);
  assert.deepEqual(t.you.guesses.map((x: HunterView['guesses'][0]) => x.space), [warm]);
  assert.match((await tab.send('public:guess', { space: s.habitat, nonce: nonce() })).error, /again in/);

  // Drop and come back: a fresh socket resumes the hunt and its history.
  a.s.close();
  const back = client();
  const r = await back.send('public:join', { mode: 'hotcold', name: 'Ana', token: j.token, resume: true });
  assert.equal(r.state.id, j.state.id);
  assert.equal(r.you.guesses.length, 1);
  assert.deepEqual(r.state.clues, s.clues.slice(0, r.state.clues.length));

  // A made-up token gets a new identity, never someone else's.
  const stranger = client();
  const x = await stranger.send('public:join', { mode: 'hotcold', name: 'Eve', token: 'not-a-real-token-but-long-enough' });
  assert.notEqual(x.token, j.token);
  assert.notEqual(x.you.pid, j.you.pid);
});

test('public: One Shot allows one guess; a miss is out but can watch; a full hunt opens a parallel one', async () => {
  const hunters = [client(), client(), client(), client()];
  const joins = [];
  for (const [i, h] of hunters.entries()) joins.push(await h.send('public:join', { mode: 'oneshot', name: `H${i}` }));
  assert.equal(new Set(joins.slice(0, 3).map((j) => j.state.id)).size, 1);
  assert.notEqual(joins[3].state.id, joins[0].state.id, 'capacity 3: the fourth hunter opens another hunt');
  const s = secretOf(joins[0].state.id);
  await hunters[0].until((u) => u.phase === 'live');
  const miss = await hunters[0].send('public:guess', { space: wrongSpace(s.habitat, () => true), nonce: nonce() });
  assert.equal(miss.guess.hint, 'sealed', 'One Shot gives no feedback');
  assert.equal(miss.you.shotsLeft, 0);
  await wait(50);
  assert.match((await hunters[0].send('public:guess', { space: s.habitat, nonce: nonce() })).error, /one shot/);
  await hunters[1].until((u) => u.out === 1);
});

test('public: a hunt nobody solves times out and reveals the answer', async () => {
  const a = client();
  const j = await a.send('public:join', { mode: 'classic', name: 'Solo' });
  const s = secretOf(j.state.id);
  const end = await a.until((u) => u.phase === 'over', 250 * (s.clues.length + 2) + 600);
  assert.equal(end.result!.winner, null);
  assert.equal(end.result!.habitat, s.habitat);
  assert.equal(end.clues.length, s.clues.length, 'every clue dropped before the timeout');
});

test('public: the shared rate limit refuses a flood', async () => {
  const a = client();
  await a.send('public:join', { mode: 'classic', name: 'Spam' });
  const res = await Promise.all(Array.from({ length: 30 }, () => a.send('public:lobby')));
  assert.ok(res.some((r) => !r.ok && /Slow down/.test(r.error)));
  assert.ok(res[0].ok && typeof res[0].modes.classic.hunters === 'number');
});
