// Online rooms: the server holds the only full GameState and sends each seat its own view.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { type GameState, apply, newGame, viewFor } from '../shared/engine.ts';
import { type Ack, type Joined, type RoomUpdate, ActMsg, CreateMsg, JoinMsg, ResumeMsg, StartMsg } from '../shared/protocol.ts';

interface SeatState {
  name: string;
  tokenHash: Buffer; // the reconnect token is only kept as a digest
  sockets: Set<string>;
}

interface Room {
  code: string;
  seats: SeatState[];
  game: GameState | null;
  touched: number;
}

const rooms = new Map<string, Room>();
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 5000; // memory ceiling; beyond it, new rooms are refused until the sweep frees some
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they read as digits

const digest = (token: string) => createHash('sha256').update(token).digest();

function newCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

function seatFor(room: Room, token: string) {
  const h = digest(token);
  return room.seats.findIndex((s) => timingSafeEqual(s.tokenHash, h));
}

/**
 * Wrap a socket's handlers: rate limit, schema check, and a guaranteed ack. The token bucket
 * (8 messages per second sustained, bursts of 16) lives on the socket, so rooms and public hunts share it.
 */
export function guard(socket: Socket) {
  const bucket: { tokens: number; last: number } = (socket.data.bucket ??= { tokens: 16, last: Date.now() });
  const limited = () => {
    const now = Date.now();
    bucket.tokens = Math.min(16, bucket.tokens + ((now - bucket.last) / 1000) * 8);
    bucket.last = now;
    if (bucket.tokens < 1) return true;
    bucket.tokens--;
    return false;
  };
  return function on<S extends { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>(
    event: string, schema: S | null, handle: (msg: any, ack: Ack<any>) => void,
  ) {
    socket.on(event, (raw: unknown, ack: unknown) => {
      // A message sent without a payload arrives with its ack callback in the first position.
      if (typeof raw === 'function' && ack === undefined) [raw, ack] = [undefined, raw];
      if (raw === null) raw = undefined; // an explicit undefined payload is serialised as null
      const reply: Ack<any> = typeof ack === 'function' ? (ack as Ack<any>) : () => {};
      if (limited()) return reply({ ok: false, error: 'Slow down a little.' });
      const parsed = schema ? schema.safeParse(raw) : { success: true, data: raw };
      if (!parsed.success) return reply({ ok: false, error: 'That request was malformed.' });
      try {
        handle(parsed.data, reply);
      } catch (e) {
        reply({ ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' });
      }
    });
  };
}

/** `perIp` caps simultaneous sockets from one address; raise it when many players share one network (an event, a school). */
export function attach(io: Server, seedSource: () => number = () => randomInt(2 ** 31), perIpMax = 24) {
  // Per-socket seat binding; a socket is in at most one room.
  const bound = new Map<string, { code: string; seat: number }>();

  function broadcast(room: Room) {
    room.touched = Date.now();
    const seats = room.seats.map((s) => ({ name: s.name, online: s.sockets.size > 0 }));
    room.seats.forEach((seat, you) => {
      const update: RoomUpdate = { code: room.code, seats, you, view: room.game ? viewFor(room.game, you) : null };
      for (const id of seat.sockets) io.to(id).emit('room', update);
    });
  }

  function bind(socket: Socket, room: Room, seat: number) {
    unbind(socket);
    room.seats[seat].sockets.add(socket.id);
    bound.set(socket.id, { code: room.code, seat });
    broadcast(room);
  }

  function unbind(socket: Socket) {
    const b = bound.get(socket.id);
    if (!b) return;
    bound.delete(socket.id);
    const room = rooms.get(b.code);
    if (!room) return;
    room.seats[b.seat].sockets.delete(socket.id);
    broadcast(room);
  }

  function addSeat(room: Room, name: string) {
    const token = randomBytes(24).toString('base64url');
    room.seats.push({ name, tokenHash: digest(token), sockets: new Set() });
    return { token, you: room.seats.length - 1 };
  }

  const perIp = new Map<string, number>();
  io.on('connection', (socket) => {
    // A ceiling on simultaneous sockets from one address keeps one client from multiplying its rate limits.
    const ip = socket.handshake.address;
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    socket.on('disconnect', () => { const n = (perIp.get(ip) ?? 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });
    if (perIp.get(ip)! > perIpMax) { socket.disconnect(true); return; }
    let created = 0; // rooms this socket has opened
    const on = guard(socket);

    on('create', CreateMsg, ({ name }, ack: Ack<Joined>) => {
      if (++created > 5) return ack({ ok: false, error: 'Too many rooms from this connection. Refresh to start over.' });
      if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'The server is full right now. Try again in a few minutes.' });
      const room: Room = { code: newCode(), seats: [], game: null, touched: Date.now() };
      rooms.set(room.code, room);
      const { token, you } = addSeat(room, name);
      ack({ ok: true, code: room.code, token, you });
      bind(socket, room, you);
    });

    on('join', JoinMsg, ({ code, name }, ack: Ack<Joined>) => {
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: `No room called ${code}.` });
      if (room.game) return ack({ ok: false, error: 'That game has already started.' });
      if (room.seats.length >= 5) return ack({ ok: false, error: 'That room is full (5 players).' });
      if (room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        return ack({ ok: false, error: 'Someone in that room already uses that name.' });
      }
      const { token, you } = addSeat(room, name);
      ack({ ok: true, code, token, you });
      bind(socket, room, you);
    });

    on('resume', ResumeMsg, ({ code, token }, ack: Ack<Joined>) => {
      const room = rooms.get(code);
      const seat = room ? seatFor(room, token) : -1;
      if (!room || seat < 0) return ack({ ok: false, error: 'That game is no longer available.' });
      ack({ ok: true, code, token, you: seat });
      bind(socket, room, seat);
    });

    on('start', StartMsg, ({ mode }, ack) => {
      const b = bound.get(socket.id);
      const room = b && rooms.get(b.code);
      if (!room || !b) return ack({ ok: false, error: 'You are not in a room.' });
      if (b.seat !== 0) return ack({ ok: false, error: 'Only the host can start the game.' });
      if (room.game && room.game.phase !== 'over') return ack({ ok: false, error: 'The game has already started.' });
      if (room.seats.length < 3) return ack({ ok: false, error: 'Hunch needs at least 3 players.' });
      room.game = newGame(seedSource(), room.seats.map((s) => s.name), seedSource(), mode);
      ack({ ok: true });
      broadcast(room);
    });

    on('act', ActMsg, (action, ack) => {
      const b = bound.get(socket.id);
      const room = b && rooms.get(b.code);
      if (!room?.game || !b) return ack({ ok: false, error: 'There is no game in progress.' });
      // Node is single-threaded and apply() is synchronous, so two requests can never interleave here.
      room.game = apply(room.game, b.seat, action);
      ack({ ok: true });
      broadcast(room);
    });

    on('leave', null, (_msg, ack) => {
      unbind(socket);
      ack({ ok: true });
    });

    socket.on('disconnect', () => unbind(socket));
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const online = room.seats.some((s) => s.sockets.size > 0);
      if (!online && now - room.touched > ROOM_TTL_MS) rooms.delete(code);
    }
  }, 5 * 60 * 1000);
  sweep.unref();
}

