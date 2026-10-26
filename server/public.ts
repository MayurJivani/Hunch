// Public hunts: up to `capacity` hunters on one board, racing to the same hidden habitat with the same clues.
// The server keeps the habitat and the unrevealed clues, runs the clue clock, judges every guess and picks
// the winner. Every socket in a hunt receives the same HuntState; only a hunter's own guesses are per socket.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Server, Socket } from 'socket.io';
import { SPACES, distance } from '../shared/board.ts';
import {
  type HunterView, type HuntMode, type HuntPhase, type HuntScenario, type HuntState, type LeaderRow, type Leaders,
  type MyGuess, type Pulse, type Stats, HUNT_MODES, MODE_RULES, generateHunt, hintFor,
} from '../shared/hunt.ts';
import { type Ack, GuessMsg, LeadersMsg, PublicJoinMsg } from '../shared/protocol.ts';
import { guard } from './rooms.ts';

export interface PublicOptions {
  capacity?: number; // hunters per hunt; a full hunt opens a parallel one of the same mode
  briefingMs?: number; // join window before clue 1
  clueEveryMs?: number; // between clue drops
  graceMs?: number; // after the last clue, before the hunt times out
  cooldownScale?: number; // tests shrink the guess cooldowns
  dataFile?: string | null; // JSON stats file; null keeps everything in memory
}

interface Guess extends MyGuess { d: number } // d never leaves the server before the reveal

interface Entry {
  pid: string;
  name: string;
  guesses: Guess[];
  readyAt: number;
  nonces: Map<string, unknown>; // recent guess replies, so a resent guess gets the same answer
}

interface Hunt {
  id: string;
  number: number;
  mode: HuntMode;
  phase: HuntPhase;
  s: HuntScenario;
  startsAt: number;
  nextClueAt: number | null;
  endsAt: number;
  revealed: number;
  entries: Map<string, Entry>;
  heat: number[];
  guesses: number;
  out: number;
  winner: { name: string; pid: string; ms: number; clues: number } | null;
  timer: NodeJS.Timeout | null;
  finishedAt: number;
  pulse: string; // last pulse sent, to skip unchanged ones
}

interface Player { pid: string; name: string; sockets: Set<string>; hunt: Hunt | null }

interface Saved {
  seq: number; // hunt numbers keep counting across restarts
  tokens: Record<string, string>; // token digest -> pid; the token itself is never stored
  stats: Record<string, Stats>; // `${mode}:${pid}`
  wins: { mode: HuntMode; pid: string; at: number; ms: number; clues: number }[];
}

const MAX_HUNTS = 200; // across all modes; beyond it, joins are refused until a sweep frees some
const MAX_PLAYERS = 20_000; // live hunter records in memory
const MAX_WINS = 50_000;
const DAY = 86_400_000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function attachPublic(io: Server, opts: PublicOptions = {}) {
  const capacity = opts.capacity ?? 400;
  const briefingMs = opts.briefingMs ?? 20_000;
  const clueEveryMs = opts.clueEveryMs ?? 30_000;
  const graceMs = opts.graceMs ?? 60_000;
  const scale = opts.cooldownScale ?? 1;
  const file = opts.dataFile ?? null;

  let saved: Saved = { seq: 0, tokens: {}, stats: {}, wins: [] };
  if (file) {
    try { saved = { ...saved, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* first run: no file yet */ }
  }
  let saveTimer: NodeJS.Timeout | null = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      // Only hunters who are here now or have stats keep their token, so join spam cannot grow the file.
      const keep = new Set(Object.keys(saved.stats).map((k) => k.slice(k.indexOf(':') + 1)));
      for (const [d, pid] of Object.entries(saved.tokens)) if (!keep.has(pid) && !players.has(pid)) delete saved.tokens[d];
      if (!file) return;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, JSON.stringify(saved));
        renameSync(`${file}.tmp`, file); // atomic: a crash mid-write never leaves half a file
      } catch (e) {
        console.error('public hunt stats were not saved:', e instanceof Error ? e.message : e);
      }
    }, 2000);
    saveTimer.unref();
  }

  const hunts = new Map<string, Hunt>();
  const players = new Map<string, Player>(); // by pid
  const bound = new Map<string, Player>(); // socket id -> hunter
  const room = (h: Hunt) => `hunt:${h.id}`;

  const online = (h: Hunt) => {
    let n = 0;
    for (const pid of h.entries.keys()) { const p = players.get(pid); if (p?.hunt === h && p.sockets.size) n++; }
    return n;
  };

  function state(h: Hunt): HuntState {
    const over = h.phase === 'over';
    return {
      id: h.id, number: h.number, mode: h.mode, phase: h.phase, board: h.s.board, cryptid: h.s.cryptid,
      total: h.s.clues.length, clues: h.s.clues.slice(0, h.revealed),
      startsAt: h.startsAt, nextClueAt: h.nextClueAt, endsAt: h.endsAt,
      hunters: online(h), guesses: h.guesses, out: h.out, now: Date.now(),
      result: !over ? null : {
        winner: h.winner, habitat: h.s.habitat, clues: h.s.clues, heat: h.heat,
        closest: [...h.entries.values()].filter((e) => e.guesses.length)
          .map((e) => ({ name: e.name, pid: e.pid, d: Math.min(...e.guesses.map((g) => g.d)) }))
          .sort((a, b) => a.d - b.d).slice(0, 10),
      },
    };
  }

  function view(h: Hunt, p: Player): HunterView | null {
    const e = h.entries.get(p.pid);
    if (!e) return null;
    const shots = MODE_RULES[h.mode].shots;
    return {
      pid: p.pid, name: e.name, readyAt: e.readyAt,
      guesses: e.guesses.map(({ d: _d, ...g }) => g),
      shotsLeft: Number.isFinite(shots) ? Math.max(0, shots - e.guesses.length) : null,
    };
  }

  const send = (h: Hunt) => io.to(room(h)).emit('public:state', state(h));

  function create(mode: HuntMode): Hunt {
    const s = generateHunt(randomInt(2 ** 31), randomInt(2 ** 31));
    const now = Date.now();
    const h: Hunt = {
      id: randomBytes(6).toString('base64url'), number: ++saved.seq, mode, phase: 'briefing', s,
      startsAt: now + briefingMs, nextClueAt: null, endsAt: now + briefingMs + clueEveryMs * (s.clues.length - 1) + graceMs,
      revealed: 0, entries: new Map(), heat: Array(SPACES).fill(0), guesses: 0, out: 0, winner: null,
      timer: null, finishedAt: 0, pulse: '',
    };
    hunts.set(h.id, h);
    at(h, briefingMs, () => reveal(h));
    save();
    return h;
  }

  function at(h: Hunt, ms: number, run: () => void) {
    if (h.timer) clearTimeout(h.timer);
    h.timer = setTimeout(run, Math.max(0, ms));
    h.timer.unref();
  }

  // Clue drops run on the server clock: everyone in the hunt receives clue n in the same broadcast.
  function reveal(h: Hunt) {
    if (h.phase === 'over') return;
    h.phase = 'live';
    h.revealed++;
    const more = h.revealed < h.s.clues.length;
    h.nextClueAt = more ? h.startsAt + clueEveryMs * h.revealed : null;
    if (more) at(h, h.nextClueAt! - Date.now(), () => reveal(h));
    else at(h, h.endsAt - Date.now(), () => finish(h, null));
    send(h);
  }

  function finish(h: Hunt, winner: Hunt['winner']) {
    if (h.phase === 'over') return;
    if (h.timer) clearTimeout(h.timer);
    h.timer = null;
    h.phase = 'over';
    h.winner = winner;
    h.nextClueAt = null;
    h.finishedAt = Date.now();
    // Stats count everyone who made at least one guess; rankings are kept per mode.
    for (const e of h.entries.values()) {
      if (!e.guesses.length) continue;
      const key = `${h.mode}:${e.pid}`;
      const st = (saved.stats[key] ??= { name: e.name, entered: 0, wins: 0, streak: 0, bestStreak: 0, fastestMs: null, cluesAtWin: 0, missSum: 0, misses: 0 });
      st.name = e.name;
      st.entered++;
      for (const g of e.guesses) if (g.d > 0) { st.missSum += g.d; st.misses++; }
      if (winner?.pid === e.pid) {
        st.wins++;
        st.streak++;
        st.bestStreak = Math.max(st.bestStreak, st.streak);
        st.fastestMs = Math.min(st.fastestMs ?? Infinity, winner.ms);
        st.cluesAtWin += winner.clues;
      } else st.streak = 0;
    }
    if (winner) {
      saved.wins.push({ mode: h.mode, pid: winner.pid, at: h.finishedAt, ms: winner.ms, clues: winner.clues });
      if (saved.wins.length > MAX_WINS) saved.wins.splice(0, saved.wins.length - MAX_WINS);
    }
    save();
    send(h);
  }

  /** The hunt a new arrival joins: the first open one of that mode with room, or a fresh one. */
  function open(mode: HuntMode): Hunt | null {
    for (const h of hunts.values()) if (h.mode === mode && h.phase !== 'over' && online(h) < capacity && h.entries.size < capacity * 4) return h;
    return hunts.size < MAX_HUNTS ? create(mode) : null;
  }

  function moveTo(p: Player, h: Hunt) {
    if (p.hunt && p.hunt !== h) for (const id of p.sockets) io.in(id).socketsLeave(room(p.hunt));
    p.hunt = h;
    for (const id of p.sockets) io.in(id).socketsJoin(room(h));
  }

  function unbind(socket: Socket) {
    const p = bound.get(socket.id);
    if (!p) return;
    bound.delete(socket.id);
    p.sockets.delete(socket.id);
    if (p.hunt) socket.leave(room(p.hunt));
  }

  function leaders(mode: HuntMode, me: Player | undefined): Leaders {
    const nameOf = (pid: string) => saved.stats[`${mode}:${pid}`]?.name ?? 'Hunter';
    const top = (m: Map<string, number>, asc = false): LeaderRow[] => [...m]
      .sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1])).slice(0, 10).map(([pid, value]) => ({ pid, name: nameOf(pid), value }));
    const winsSince = (t: number) => {
      const m = new Map<string, number>();
      for (const w of saved.wins) if (w.mode === mode && w.at >= t) m.set(w.pid, (m.get(w.pid) ?? 0) + 1);
      return top(m);
    };
    const fastest = new Map<string, number>(), all = new Map<string, number>(), sharpest = new Map<string, number>();
    for (const w of saved.wins) if (w.mode === mode) fastest.set(w.pid, Math.min(fastest.get(w.pid) ?? Infinity, w.ms));
    for (const [key, st] of Object.entries(saved.stats)) {
      if (!key.startsWith(`${mode}:`)) continue;
      const pid = key.slice(mode.length + 1);
      if (st.wins) all.set(pid, st.wins);
      if (st.misses >= 5) sharpest.set(pid, Math.round((st.missSum / st.misses) * 10) / 10); // average miss, in spaces
    }
    const now = Date.now();
    return {
      today: winsSince(now - (now % DAY)), week: winsSince(now - 7 * DAY), all: top(all),
      fastest: top(fastest, true), sharpest: top(sharpest, true),
      you: me ? saved.stats[`${mode}:${me.pid}`] ?? null : null,
    };
  }

  io.on('connection', (socket) => {
    const on = guard(socket);

    on('public:lobby', null, (_msg, ack) => {
      const modes = Object.fromEntries(HUNT_MODES.map((m) => {
        const live = [...hunts.values()].filter((h) => h.mode === m && h.phase !== 'over');
        return [m, { hunters: live.reduce((n, h) => n + online(h), 0), phase: live[0]?.phase ?? null, startsAt: live[0]?.startsAt ?? null }];
      }));
      ack({ ok: true, modes, now: Date.now() });
    });

    on('public:join', PublicJoinMsg, ({ mode, name, token, resume }, ack: Ack<{ token: string; state: HuntState; you: HunterView | null }>) => {
      let issued = token;
      let pid = token ? saved.tokens[digest(token)] : undefined;
      if (!pid) {
        if (players.size >= MAX_PLAYERS) return ack({ ok: false, error: 'The hunt is full right now. Try again in a few minutes.' });
        issued = randomBytes(24).toString('base64url');
        pid = randomBytes(8).toString('hex');
        saved.tokens[digest(issued)] = pid;
      }
      const p = players.get(pid) ?? { pid, name, sockets: new Set<string>(), hunt: null };
      players.set(pid, p);
      p.name = name;
      const keep = p.hunt && hunts.has(p.hunt.id) && (resume || (p.hunt.mode === mode && p.hunt.phase !== 'over'));
      const h = keep ? p.hunt! : open(mode);
      if (!h) return ack({ ok: false, error: 'Every public hunt is full right now. Try again in a minute.' });
      const prev = bound.get(socket.id);
      if (prev && prev !== p) unbind(socket);
      bound.set(socket.id, p);
      p.sockets.add(socket.id);
      moveTo(p, h);
      const e = h.entries.get(pid);
      if (e) e.name = name;
      else if (h.phase !== 'over') h.entries.set(pid, { pid, name, guesses: [], readyAt: 0, nonces: new Map() });
      ack({ ok: true, token: issued!, state: state(h), you: view(h, p) });
    });

    on('public:guess', GuessMsg, ({ space, nonce }, ack) => {
      const p = bound.get(socket.id), h = p?.hunt, e = h && p && h.entries.get(p.pid);
      if (!p || !h || !e) return ack({ ok: false, error: 'Join a hunt first.' });
      const seen = e.nonces.get(nonce);
      if (seen) return ack(seen as never); // the same guess sent twice is answered once
      if (h.phase === 'briefing') return ack({ ok: false, error: 'The first clue has not dropped yet.' });
      if (h.phase === 'over') return ack({ ok: false, error: 'This hunt is already over.' });
      const rules = MODE_RULES[h.mode];
      if (e.guesses.length >= rules.shots) return ack({ ok: false, error: 'You have used your one shot.' });
      const now = Date.now();
      if (now < e.readyAt) return ack({ ok: false, error: `Steady. You can guess again in ${Math.ceil((e.readyAt - now) / 1000)}s.` });
      if (e.guesses.some((g) => g.space === space)) return ack({ ok: false, error: 'You already tried that space.' });

      // Node runs this synchronously, so guesses resolve in arrival order: the first correct one processed wins.
      const d = distance(space, h.s.habitat);
      const g: Guess = { space, at: now - h.startsAt, hint: hintFor(h.mode, d), clues: h.revealed, d };
      e.guesses.push(g);
      h.heat[space]++;
      h.guesses++;
      if (d > 0) {
        e.readyAt = now + rules.cooldownMs(e.guesses.length) * scale;
        if (e.guesses.length === rules.shots) h.out++;
      }
      const { d: _d, ...mine } = g;
      const reply = { ok: true as const, guess: mine, you: view(h, p) };
      e.nonces.set(nonce, reply);
      if (e.nonces.size > 32) e.nonces.delete(e.nonces.keys().next().value!);
      ack(reply);
      for (const id of p.sockets) if (id !== socket.id) io.to(id).emit('public:you', reply.you);
      if (d === 0) finish(h, { name: e.name, pid: p.pid, ms: g.at, clues: h.revealed });
    });

    on('public:leaders', LeadersMsg, ({ mode }, ack) => ack({ ok: true, leaders: leaders(mode, bound.get(socket.id)) }));

    on('public:leave', null, (_msg, ack) => { unbind(socket); ack({ ok: true }); });

    socket.on('disconnect', () => unbind(socket));
  });

  // Hunter counts are aggregated and sent at most once a second, never per player.
  const ticker = setInterval(() => {
    const now = Date.now();
    for (const h of hunts.values()) {
      if (h.phase === 'over') {
        if (now - h.finishedAt > 15 * 60_000) hunts.delete(h.id);
        continue;
      }
      const pulse: Pulse = { hunters: online(h), guesses: h.guesses, out: h.out };
      const key = `${pulse.hunters}|${pulse.guesses}|${pulse.out}`;
      if (key !== h.pulse) { h.pulse = key; io.to(room(h)).emit('public:pulse', pulse); }
      // A hunt everyone has left still runs out its clock, then gets swept.
    }
    for (const p of players.values()) if (!p.sockets.size && (!p.hunt || !hunts.has(p.hunt.id))) players.delete(p.pid);
    if (Object.keys(saved.tokens).length > players.size + 10_000) save(); // the save pass prunes unused tokens
  }, 1000);
  ticker.unref();

  return { hunts, close: () => clearInterval(ticker) };
}
