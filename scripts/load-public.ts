// Load test: N hunters (default 400) play one public hunt against the real server process.
// Every hunter joins, all of them miss at once, all of them drop and reconnect at once, and when the last clue
// is out every hunter works out the answer from the public clues and fires at the same moment. Checks that
// exactly one hunter wins, and reports server CPU, memory, event latency and payload size.
//   node scripts/load-public.ts [hunters]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { SPACES, clueMap } from '../shared/board.ts';
import type { HuntState } from '../shared/hunt.ts';

const N = Number(process.argv[2] ?? 400);
const PORT = 4300 + Math.floor(Math.random() * 600);
const url = `http://localhost:${PORT}`;
const PACE = 0.2; // briefing 4s, a clue every 6s

const server = spawn(process.execPath, [join(import.meta.dirname, '..', 'server', 'index.ts')], {
  env: { ...process.env, PORT: String(PORT), PUBLIC_PACE: String(PACE), SOCKETS_PER_IP: String(N * 2 + 10), PUBLIC_CAPACITY: String(N), PUBLIC_DATA: join(tmpdir(), `hunch-load-${PORT}.json`) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((r) => server.stdout!.on('data', (d) => { if (String(d).includes('hunch server')) r(); }));

// Server CPU (ms) and resident memory (MB) straight from /proc, so the clients in this process do not count.
const tick = 1000 / 100; // USER_HZ is 100 on Linux
function usage() {
  const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1].split(' ');
  const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${server.pid}/status`, 'utf8'))![1]) / 1024;
  return { cpu: (Number(stat[11]) + Number(stat[12])) * tick, rss };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN; };
const ms = (xs: number[]) => `p50 ${pct(xs, 50).toFixed(0)}ms, p95 ${pct(xs, 95).toFixed(0)}ms, max ${Math.max(...xs).toFixed(0)}ms`;

interface Hunter { s: Socket; token: string; state: HuntState | null; clueAt: number[]; bytes: number }
const hunters: Hunter[] = [];
function open(h?: Hunter) {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  const me: Hunter = h ?? { s, token: '', state: null, clueAt: [], bytes: 0 };
  me.s = s;
  s.on('public:state', (st: HuntState) => {
    me.bytes = Math.max(me.bytes, JSON.stringify(st).length);
    if (me.state && st.clues.length > me.state.clues.length) me.clueAt[st.clues.length - 1] = performance.now();
    me.state = st;
  });
  s.on('public:pulse', (p) => { if (me.state) me.state = { ...me.state, ...p }; });
  return me;
}

const before = usage();
const t0 = performance.now();
console.log(`${N} hunters joining...`);
const joinLat: number[] = [];
await Promise.all(Array.from({ length: N }, async (_, i) => {
  const h = open();
  hunters.push(h);
  await new Promise<void>((r) => h.s.on('connect', () => r()));
  const t = performance.now();
  const res = await h.s.emitWithAck('public:join', { mode: 'classic', name: `Hunter ${i}` });
  joinLat.push(performance.now() - t);
  if (!res.ok) throw new Error(res.error);
  h.token = res.token;
  h.state = res.state;
}));
const ids = new Set(hunters.map((h) => h.state!.id));
console.log(`joined in ${(performance.now() - t0).toFixed(0)}ms, ${ids.size} hunt(s); join ${ms(joinLat)}`);
if (ids.size !== 1) throw new Error('every hunter should share one hunt');

// Clue 1: how far apart did 400 sockets receive the same broadcast?
while (!hunters.every((h) => h.state!.phase === 'live')) await wait(20);
await wait(PACE * 30_000 + 500); // clue 2
const spread = hunters.map((h) => h.clueAt[1]).filter(Boolean);
console.log(`clue 2 reached ${spread.length}/${N} hunters within ${(Math.max(...spread) - Math.min(...spread)).toFixed(0)}ms of each other`);

// Everyone misses at once: a space the revealed clues already rule out.
const guessLat: number[] = [];
const board = hunters[0].state!.board;
const maps = (ids: string[]) => ids.map((c) => clueMap(c, board)); // worked out once, outside the timed calls
const early = maps(hunters[0].state!.clues);
const ruledOut = [...Array(SPACES).keys()].filter((s) => early.some((m) => !m[s]));
await Promise.all(hunters.map(async (h, i) => {
  const t = performance.now();
  const res = await h.s.emitWithAck('public:guess', { space: ruledOut[i % ruledOut.length], nonce: `miss-${i}` });
  guessLat.push(performance.now() - t);
  if (!res.ok || res.guess.hint === 'found') throw new Error(`miss ${i}: ${JSON.stringify(res)}`);
}));
console.log(`${N} simultaneous misses: ${ms(guessLat)}`);

// Mass reconnect: every socket drops and a new one resumes with its token.
const reLat: number[] = [];
await Promise.all(hunters.map(async (h, i) => {
  h.s.close();
  open(h);
  await new Promise<void>((r) => h.s.on('connect', () => r()));
  const t = performance.now();
  const res = await h.s.emitWithAck('public:join', { mode: 'classic', name: `Hunter ${i}`, token: h.token, resume: true });
  reLat.push(performance.now() - t);
  if (!res.ok || res.you.guesses.length !== 1) throw new Error(`reconnect ${i}: ${JSON.stringify(res).slice(0, 200)}`);
}));
console.log(`${N} reconnects, each kept its guess: ${ms(reLat)}`);

// The last clue: everyone deduces the one space left and fires at once. Exactly one may win.
while (!hunters.every((h) => h.state!.clues.length === h.state!.total)) await wait(50);
const all = maps(hunters[0].state!.clues);
const live = [...Array(SPACES).keys()].filter((s) => all.every((m) => m[s]));
if (live.length !== 1) throw new Error('the clues should leave exactly one space');
const fire = performance.now();
const winLat: number[] = [];
const results = await Promise.all(hunters.map(async (h, i) => {
  const t = performance.now();
  const res = await h.s.emitWithAck('public:guess', { space: live[0], nonce: `win-${i}` });
  winLat.push(performance.now() - t);
  return res;
}));
const found = results.filter((r) => r.ok && r.guess.hint === 'found').length;
while (!hunters.every((h) => h.state!.phase === 'over')) await wait(20);
const over = hunters[0].state!;
console.log(`${N} simultaneous correct guesses: ${found} winner (${over.result!.winner!.name}), the rest refused (${ms(winLat)}); all ${N} saw the reveal ${(performance.now() - fire).toFixed(0)}ms after firing`);
if (found !== 1 || hunters.some((h) => h.state!.result!.winner!.pid !== over.result!.winner!.pid)) throw new Error('expected exactly one winner, seen by everyone');

const after = usage();
const wall = performance.now() - t0;
console.log(`server: ${(after.cpu - before.cpu).toFixed(0)}ms CPU over ${(wall / 1000).toFixed(1)}s (${((100 * (after.cpu - before.cpu)) / wall).toFixed(1)}% of one core), RSS ${before.rss.toFixed(0)} -> ${after.rss.toFixed(0)} MB`);
console.log(`largest state payload: ${(Math.max(...hunters.map((h) => h.bytes)) / 1024).toFixed(1)} KB (the board plus the reveal)`);
hunters.forEach((h) => h.s.close());
server.kill();
console.log('ok');
