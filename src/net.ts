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
