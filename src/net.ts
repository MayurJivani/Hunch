import { io } from 'socket.io-client';
import type { RoomUpdate } from '../shared/protocol.ts';

export const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });

type Res = { ok: true; [k: string]: any } | { ok: false; error: string };

export async function call(event: string, msg?: unknown): Promise<Res> {
  if (!socket.connected) socket.connect();
  try {
    return await socket.timeout(8000).emitWithAck(event, msg);
  } catch {
    return { ok: false, error: 'The server did not answer. Check your connection and try again.' };
  }
}

const KEY = 'hunch.seat';
export const saveSeat = (code: string, token: string) => { try { localStorage.setItem(KEY, JSON.stringify({ code, token })); } catch { /* private mode */ } };
export const clearSeat = () => { try { localStorage.removeItem(KEY); } catch { /* private mode */ } };
export function loadSeat(): { code: string; token: string } | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export type { RoomUpdate };

// Public hunts: one token per device keeps a hunter's stats and lets a refresh resume the hunt in progress.
export interface Hunter { token?: string; name: string; mode: 'classic' | 'hotcold' | 'oneshot'; active: boolean }
const PUBLIC_KEY = 'hunch.public';
export function loadHunter(): Hunter | null {
  try { return JSON.parse(localStorage.getItem(PUBLIC_KEY) ?? 'null'); } catch { return null; }
}
export const saveHunter = (h: Hunter) => { try { localStorage.setItem(PUBLIC_KEY, JSON.stringify(h)); } catch { /* private mode */ } };
