// Sound. Event effects (pieces, questions, searches, turns, interface clicks) are synthesised with WebAudio, so
// they cost no downloads. Background music is two calm CC0 tracks (see public/sounds/CREDITS.md), streamed and
// alternated. Effects and music switch on and off separately; both start only after a user gesture.

type Pref = 'sound' | 'music';
const KEYS: Record<Pref, string> = { sound: 'hunch.sound', music: 'hunch.music' };
const read = (p: Pref) => { try { return localStorage.getItem(KEYS[p]) !== 'off'; } catch { return true; } };
const prefs: Record<Pref, boolean> = { sound: read('sound'), music: read('music') };
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let fx: GainNode | null = null;
let unlocked = false;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    fx = ctx.createGain();
    fx.gain.value = 0.55;
    fx.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const isOn = (p: Pref) => prefs[p];
export function onPrefsChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function setPref(p: Pref, on: boolean) {
  prefs[p] = on;
  try { localStorage.setItem(KEYS[p], on ? 'on' : 'off'); } catch { /* private mode */ }
  if (p === 'music') { if (on) startMusic(); else stopMusic(); }
  listeners.forEach((f) => f());
}

// ---- Effects ----------------------------------------------------------------------------------------------------

/** A short pitched tone with an exponential decay. */
function tone(freq: number, { at = 0, dur = 0.18, type = 'sine' as OscillatorType, gain = 0.3, slide = 0 } = {}) {
  const a = audio();
  if (!a || !fx || !prefs.sound) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(fx);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A burst of filtered noise: knocks and thuds. */
function noise({ at = 0, dur = 0.12, freq = 800, q = 1, gain = 0.25, type = 'bandpass' as BiquadFilterType } = {}) {
  const a = audio();
  if (!a || !fx || !prefs.sound) return;
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length) ** 2;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(fx);
  src.start(t);
}

export const sfx = {
  /** A button, tab or toggle: a soft, short tick. */
  click: () => { noise({ dur: 0.025, freq: 3200, q: 4, gain: 0.12 }); tone(1500, { dur: 0.04, gain: 0.025, type: 'triangle' }); },
  /** A space was picked on the board. */
  select: () => tone(880, { dur: 0.07, gain: 0.07, type: 'triangle' }),
  /** A disc settles: a woody clack with a light ring. `at` lines it up with the drop animation. */
  disc: (at = 0.45) => { noise({ at, dur: 0.05, freq: 2400, q: 3, gain: 0.25 }); tone(1320, { at, dur: 0.22, gain: 0.07, type: 'triangle' }); },
  /** A cube lands: a heavier, lower knock. */
  cube: (at = 0.45) => { noise({ at, dur: 0.08, freq: 700, q: 2, gain: 0.4 }); tone(150, { at, dur: 0.14, gain: 0.2, slide: -60 }); },
  /** Questioning: a soft rising ping as the beam goes up. */
  ask: () => tone(520, { dur: 0.35, gain: 0.08, slide: 380 }),
  /** A failed search: two falling tones and a low thump. */
  fail: () => { tone(330, { dur: 0.3, gain: 0.14, type: 'triangle', slide: -90 }); tone(247, { at: 0.16, dur: 0.4, gain: 0.12, type: 'triangle', slide: -80 }); noise({ at: 0.05, dur: 0.25, freq: 160, q: 0.7, gain: 0.3, type: 'lowpass' }); },
  /** The habitat is found: a bright rising arpeggio with a shimmer. */
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, { at: k * 0.09, dur: 0.9, gain: 0.12, type: 'triangle' }));
    noise({ at: 0.4, dur: 1.2, freq: 7000, q: 0.5, gain: 0.05, type: 'highpass' });
  },
  /** It is your turn now. */
  turn: () => { tone(660, { dur: 0.12, gain: 0.08 }); tone(990, { at: 0.1, dur: 0.2, gain: 0.08 }); },
  /** A drawer, sheet or dialog opens. */
  open: () => tone(600, { dur: 0.16, gain: 0.05, slide: 240, type: 'triangle' }),
};

// Every enabled button, tab and toggle ticks when pressed, so the interface needs no per-control wiring.
addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest?.('button, [role="tab"], [role="radio"], input[type="checkbox"]');
  if (el && !(el as HTMLButtonElement).disabled) sfx.click();
}, true);

// ---- Music --------------------------------------------------------------------------------------------------------

const TRACKS = ['/sounds/calm-down.mp3', '/sounds/chill-out-theme.mp3'];
const LEVEL = 0.32;
let music: HTMLAudioElement | null = null;
let track = Math.floor(Math.random() * TRACKS.length);
let fade = 0;

/** Ease the element's volume toward `to` over `ms`, then run `done`. */
function ramp(to: number, ms: number, done?: () => void) {
  cancelAnimationFrame(fade);
  const el = music!, from = el.volume, t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    el.volume = from + (to - from) * k;
    if (k < 1) fade = requestAnimationFrame(step);
    else done?.();
  };
  fade = requestAnimationFrame(step);
}

function startMusic() {
  if (!unlocked || !prefs.music || document.hidden) return;
  if (!music) {
    music = new Audio(TRACKS[track]);
    music.preload = 'auto';
    music.volume = 0;
    // When one track ends, the other begins (each file already fades in and out).
    music.addEventListener('ended', () => {
      track = (track + 1) % TRACKS.length;
      music!.src = TRACKS[track];
      void music!.play().catch(() => {});
    });
  }
  void music.play().then(() => ramp(LEVEL, 2500)).catch(() => {});
}

function stopMusic() {
  if (music && !music.paused) ramp(0, 700, () => music!.pause());
}

// Music keeps playing between screens, and rests while the tab is hidden.
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMusic(); else startMusic(); });

// The first tap or key anywhere unlocks audio for the session.
const unlock = () => { unlocked = true; audio(); startMusic(); };
addEventListener('pointerdown', unlock, { once: true });
addEventListener('keydown', unlock, { once: true });
