// Socket payloads. Every client message is parsed with these on the server before anything reads it.
import { z } from 'zod';
import type { PlayerView } from './engine.ts';

const name = z.string().trim().min(1).max(20);
const code = z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/);
const space = z.number().int().min(0).max(107);

export const CreateMsg = z.object({ name });
export const JoinMsg = z.object({ code, name });
export const ResumeMsg = z.object({ code, token: z.string().min(16).max(64) });
export const StartMsg = z.object({ mode: z.enum(['standard', 'hard']).default('standard') }).strict().default({ mode: 'standard' });
export const ActMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cube'), space }),
  z.object({ type: z.literal('question'), space, target: z.number().int().min(0).max(4) }),
  z.object({ type: z.literal('search'), space }),
  z.object({ type: z.literal('disc'), space }),
]);

export interface Seat {
  name: string;
  online: boolean;
}

/** Sent to each socket on every change; `view` is built for that socket's seat only. */
export interface RoomUpdate {
  code: string;
  seats: Seat[];
  you: number;
  view: PlayerView | null;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;
export type Joined = { code: string; token: string; you: number };

// ---- Public hunts ----
const huntMode = z.enum(['classic', 'hotcold', 'oneshot']);
export const PublicJoinMsg = z.object({
  mode: huntMode,
  name,
  token: z.string().min(16).max(64).optional(), // the hunter's own token, to keep stats and resume a hunt
  resume: z.boolean().default(false), // true: go back to the hunter's last hunt, even a finished one
}).strict();
export const GuessMsg = z.object({ space, nonce: z.string().min(4).max(40) }).strict();
export const LeadersMsg = z.object({ mode: huntMode }).strict();
