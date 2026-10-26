// Public Hunt: everyone in the hunt sees the same board and receives the same clues at the same moment.
// The server judges guesses; this screen only renders what it confirms.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, animate, motion } from 'motion/react';
import { type Board, COLS, ROWS, SPACES, clueMap, colOf, distance, rowOf, spaceName } from '../shared/board.ts';
import {
  type HunterView, type HuntMode, type HuntState, type Hint, type Leaders, type MyGuess, type Stats,
  CRYPTIDS, HINT_TEXT, HUNT_MODES, MODE_RULES, narrowing,
} from '../shared/hunt.ts';
import { type BoardLike, R, SQ3, center, createBoard, hexPoints } from './board2d.ts';
import { AudioToggles, ClueText, EASE, describeSpace } from './Game.tsx';
import { type Hunter, call, loadHunter, saveHunter, socket } from './net.ts';
import { Icon, StructureIcon, TerrainIcon, TerritoryIcon, TERRAIN_COLORS, WATER_COLOR } from './pieces.tsx';
import { sfx } from './sound.ts';

const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const HEAT: Partial<Record<Hint, number>> = { cold: 1, cool: 2, warm: 3, hot: 4, scorching: 5, far: 1, near: 4 };

/** Ticks with the server clock (offset = server minus local). */
function useNow(offset: number) {
  const [t, set] = useState(() => Date.now() + offset);
  useEffect(() => { const id = setInterval(() => set(Date.now() + offset), 250); return () => clearInterval(id); }, [offset]);
  return t;
}

const useNarrow = () => {
  const [narrow, set] = useState(() => matchMedia('(max-width: 700px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 700px)'), f = () => set(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return narrow;
};

/** A number that counts up to its value once, for the reveal. */
function Count({ to, format = String }: { to: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduced()) { ref.current!.textContent = format(to); return; }
    const c = animate(0, to, { duration: 1.1, ease: EASE, onUpdate: (v) => { if (ref.current) ref.current.textContent = format(Math.round(v)); } });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to]);
  return <span ref={ref}>{format(0)}</span>;
}

/** Two eyes in the dark that blink now and then: the creature, before anyone has seen more of it. */
function Eyes({ size = 72 }: { size?: number }) {
  return (
    <svg className="eyes" width={size} height={size * 0.42} viewBox="0 0 100 42" aria-hidden="true">
      <defs>
        <radialGradient id="eye-glow"><stop offset="0" stopColor="#ffe8a8" /><stop offset=".45" stopColor="#ffc857" /><stop offset="1" stopColor="#ffc857" stopOpacity="0" /></radialGradient>
      </defs>
      {[28, 72].map((x, k) => (
        <motion.g key={x} style={{ transformOrigin: `${x}px 21px` }} animate={{ scaleY: [1, 1, 0.08, 1, 1] }}
          transition={{ duration: 5.5, times: [0, 0.9, 0.93, 0.96, 1], repeat: Infinity, delay: k * 0.04 }}>
          <circle cx={x} cy="21" r="20" fill="url(#eye-glow)" opacity=".55" />
          <path d={`M${x - 13} 21 Q${x} 9 ${x + 13} 21 Q${x} 31 ${x - 13} 21Z`} fill="#ffd77a" />
          <ellipse cx={x} cy="21" rx="2.4" ry="7" fill="#1a1100" />
        </motion.g>
      ))}
    </svg>
  );
}

/** Five ticks filling with the heat of a miss; the word beside it carries the meaning. */
function Thermo({ hint }: { hint: Hint }) {
  const n = HEAT[hint];
  if (!n) return null;
  return (
    <span className="thermo" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((k) => <motion.i key={k} className={k <= n ? 'on' : ''} initial={{ scaleY: 0.3, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }} transition={{ delay: 0.05 * k, ...SPRING }} />)}
    </span>
  );
}

// ---- Home sheet ------------------------------------------------------------------------------------

type Lobby = Record<HuntMode, { hunters: number; phase: string | null; startsAt: number | null }>;

/** Live hunter counts for the home page, polled while it is open. */
export function useLobby(on: boolean) {
  const [lobby, setLobby] = useState<{ modes: Lobby; offset: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const poll = async () => {
      const res = await call('public:lobby');
      if (alive && res.ok) setLobby({ modes: res.modes, offset: res.now - Date.now() });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [on]);
  return lobby;
}

export function PublicSheet({ lobby, name, setName, onStart }: {
  lobby: ReturnType<typeof useLobby>; name: string; setName: (s: string) => void; onStart: (mode: HuntMode, name: string) => void;
}) {
  const [mode, setMode] = useState<HuntMode>(() => loadHunter()?.mode ?? 'classic');
  const [error, setError] = useState<string | null>(null);
  const now = useNow(lobby?.offset ?? 0);
  return (
    <form className="sheet-body" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setError('Write your name first.'); onStart(mode, name.trim()); }}>
      <p className="dim">Everyone gets the same creature, the same board and the same clues at the same moment. The first to find its space wins.</p>
      <label className="field"><span>Your name</span>
        <input value={name} maxLength={20} onChange={(e) => { setName(e.target.value); setError(null); }} autoComplete="nickname" />
      </label>
      <div className="field" role="radiogroup" aria-label="Rules">
        <span>Rules</span>
        <div className="mode-list">
          {HUNT_MODES.map((m) => {
            const live = lobby?.modes[m];
            const status = !live ? '' : live.phase === 'briefing' && live.startsAt ? `starts in ${clock(live.startsAt - now)}`
              : live.hunters ? `${live.hunters} hunting` : 'nobody yet';
            return (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`mode-row ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
                {mode === m && <motion.span layoutId="mode-row" className="mode-ring" transition={SPRING} />}
                <span className="mode-name">{MODE_RULES[m].name}{status && <span className={`mode-live ${live?.hunters ? 'busy' : ''}`}>{status}</span>}</span>
                <span className="mode-pitch">{MODE_RULES[m].pitch}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button className="cta wide">Join the public hunt<span className="cta-icon"><Icon name="arrow" size={18} /></span></button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

// ---- The hunt ----------------------------------------------------------------------------------------

export function PublicGame({ mode, name, resume, onLeave }: { mode: HuntMode; name: string; resume: boolean; onLeave: () => void }) {
  const [hunt, setHunt] = useState<HuntState | null>(null);
  const [me, setMe] = useState<HunterView | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const joined = useRef(false);
  const hunter = useRef<Hunter>({ ...loadHunter(), name, mode, active: true });

  async function join(again: boolean) {
    const h = hunter.current;
    const res = await call('public:join', { mode: h.mode, name: h.name, token: h.token, resume: again });
    if (!res.ok) return setError(res.error);
    hunter.current = { ...h, token: res.token, active: true };
    saveHunter(hunter.current);
    setError(null);
    setOffset(res.state.now - Date.now());
    setHunt(res.state);
    setMe(res.you);
  }

  useEffect(() => {
    const onState = (s: HuntState) => { setOffset(s.now - Date.now()); setHunt((h) => (h && h.id !== s.id ? h : s)); };
    const onPulse = (p: Pick<HuntState, 'hunters' | 'guesses' | 'out'>) => setHunt((h) => (h ? { ...h, ...p } : h));
    // Each socket joins its hunt's broadcast; after a drop the new socket resumes the same hunt and history.
    const onConnect = () => { setConnected(true); if (joined.current) join(true); };
    const onDisconnect = () => setConnected(false);
    socket.on('public:state', onState);
    socket.on('public:pulse', onPulse);
    socket.on('public:you', setMe);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (!joined.current) { joined.current = true; join(resume); }
    return () => {
      socket.off('public:state', onState); socket.off('public:pulse', onPulse); socket.off('public:you', setMe);
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function leave() {
    await call('public:leave');
    saveHunter({ ...hunter.current, active: false });
    onLeave();
  }

  if (!hunt) {
    return (
      <div className="game hunt-wait">
        <div className="bezel wait-card">
          {error ? <><p className="error" role="alert">{error}</p><button className="btn primary" onClick={leave}>Back to the start</button></>
            : <><Eyes size={64} /><p className="dim">Finding the hunt...</p></>}
        </div>
      </div>
    );
  }
  return <Hunt key={hunt.id} hunt={hunt} me={me} setMe={setMe} offset={offset} connected={connected}
    onNext={() => join(false)} onLeave={leave} />;
}

function Hunt({ hunt, me, setMe, offset, connected, onNext, onLeave }: {
  hunt: HuntState; me: HunterView | null; setMe: (v: HunterView) => void; offset: number; connected: boolean;
  onNext: () => void; onLeave: () => void;
}) {
  const { board, phase, result } = hunt;
  const rules = MODE_RULES[hunt.mode];
  const cryptid = CRYPTIDS[hunt.cryptid];
  const now = useNow(offset);
  const narrow = useNarrow();
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const bv = useRef<BoardLike | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [lens, setLens] = useState<number | null>(null);
  const [dropping, setDropping] = useState<number | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ g: MyGuess; key: number } | null>(null);
  const [drawer, setDrawer] = useState<null | 'rules' | 'leaders'>(null);
  const [caseOpen, setCaseOpen] = useState(() => !matchMedia('(max-width: 700px)').matches);

  // The board lives as long as this hunt.
  useEffect(() => {
    const v = createBoard(host.current!, board, { pick: (i) => setSelected(i), hover: () => {} });
    bv.current = v;
    const fit = () => v.setInsets(nav.current!.getBoundingClientRect().bottom + 8, innerWidth > 700 ? 72 : innerHeight - hud.current!.getBoundingClientRect().top + 8);
    fit();
    addEventListener('resize', fit);
    return () => { removeEventListener('resize', fit); v.dispose(); bv.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Your misses stay on the map as "not here" cubes, the same piece the private game uses for it.
  const misses = useMemo(() => (me?.guesses ?? []).filter((g) => g.hint !== 'found'), [me]);
  useEffect(() => {
    bv.current?.setMarks(Array.from({ length: SPACES }, (_, i) => ({ cube: misses.some((g) => g.space === i) ? 0 : null, discs: [] })), true);
  }, [misses]);

  useEffect(() => {
    if (selected !== null) sfx.select();
    bv.current?.setSelected(selected);
    setConfirm(false);
    setError(null);
    if (anchor.current) bv.current?.follow(anchor.current, narrow ? null : selected);
  }, [selected, narrow]);

  // A new clue: a chime, a banner, and the board shows where it allows for a moment before the banner settles into the case file.
  const seen = useRef(hunt.clues.length);
  useEffect(() => {
    const n = hunt.clues.length;
    if (n > seen.current && n - seen.current === 1 && phase === 'live') {
      sfx.turn();
      setDropping(n - 1);
      const id = setTimeout(() => setDropping(null), 3400);
      seen.current = n;
      return () => clearTimeout(id);
    }
    seen.current = n;
  }, [hunt.clues.length, phase]);

  // Lens: one clue at a time mists the spaces it rules out. Combining them is the hunter's job.
  // The reveal's replay narrows clue by clue instead, to show how the answer follows.
  const mask = useMemo(() => {
    if (replay !== null) {
      const live = Array(SPACES).fill(true);
      for (const id of hunt.result!.clues.slice(0, replay + 1)) clueMap(id, board).forEach((ok, i) => { live[i] &&= ok; });
      return live.map((x) => !x);
    }
    const k = dropping ?? lens;
    return k !== null && hunt.clues[k] ? clueMap(hunt.clues[k], board).map((ok) => !ok) : null;
  }, [replay, dropping, lens, hunt.clues, hunt.result, board]);
  useEffect(() => { bv.current?.setHatch(mask); }, [mask]);

  useEffect(() => {
    if (!result) return;
    setSelected(null);
    setLens(null);
    bv.current?.setHabitat(result.habitat);
    if (result.winner?.pid === me?.pid) sfx.win(); else sfx.fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4800); return () => clearTimeout(id); }, [toast]);

  async function guess(space: number) {
    setBusy(true);
    setError(null);
    // One nonce per guess: if the answer is lost and we resend, the server replies with the same result.
    const nonce = crypto.randomUUID();
    let res = await call('public:guess', { space, nonce });
    if (!res.ok && /did not answer/.test(res.error)) res = await call('public:guess', { space, nonce });
    setBusy(false);
    setConfirm(false);
    if (!res.ok) return setError(res.error);
    setMe(res.you);
    setSelected(null);
    const g: MyGuess = res.guess;
    if (g.hint !== 'found') { sfx.fail(); bv.current?.pulse(space, 'fail'); setToast({ g, key: Date.now() }); }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return setSelected(null);
    const d: Record<string, [number, number]> = bv.current?.rotated
      ? { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }
      : { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!d[e.key]) return;
    e.preventDefault();
    const cur = selected ?? Math.floor(SPACES / 2);
    const c = Math.min(COLS - 1, Math.max(0, colOf(cur) + d[e.key][0]));
    const r = Math.min(ROWS - 1, Math.max(0, rowOf(cur) + d[e.key][1]));
    setSelected(r * COLS + c);
    bv.current?.focus(r * COLS + c);
  }

  const shown = dropping ?? lens; // the clue the mist is showing right now
  const wait = me ? me.readyAt - now : 0;
  const out = me?.shotsLeft === 0 && phase !== 'over';
  const tried = selected !== null ? me?.guesses.find((g) => g.space === selected) : undefined;
  const timer = phase === 'briefing' ? { label: 'Starts in', ms: hunt.startsAt - now }
    : phase === 'live' ? hunt.nextClueAt ? { label: 'Next clue', ms: hunt.nextClueAt - now } : { label: 'Time left', ms: (hunt.endsAt ?? now) - now }
    : null;
  const urgent = phase === 'live' && !hunt.nextClueAt && timer!.ms < 15_000;
  const prompt = phase !== 'live' ? null
    : out ? `Your shot missed. Watch who finds ${cryptid.name}.`
    : hunt.clues.length === 1 && !me?.guesses.length ? 'Tap a clue to see where it allows. Tap a space to guess.'
    : rules.shots === 1 ? 'One guess. Wait for more clues, or call it now.' : 'Pick a space and guess when you are sure enough.';

  return (
    <div className={`game hunt ${phase}`}>
      <div ref={host} className="board-host" tabIndex={0} role="application" onKeyDown={onKey}
        aria-label="Map. Use the arrow keys to move between spaces; the selected space opens a panel where you can guess it." />

      <nav ref={nav} className="island-nav" aria-label="Public hunt">
        <span className="wordmark">Hunch</span>
        <span className="hunt-tag">{rules.name} <b>#{hunt.number}</b></span>
        <span className="hunters" title="Hunters connected to this hunt">
          <span className={`conn ${connected ? 'on' : 'off'}`} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.b key={hunt.hunters} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>{hunt.hunters}</motion.b>
          </AnimatePresence> <span className="hide-narrow">hunting</span>
          <span className="sr-only">{connected ? 'Connected' : 'Reconnecting'}</span>
        </span>
        {timer && (
          <span className={`hunt-timer ${urgent ? 'urgent' : ''}`} aria-live="off">
            <span className="hide-narrow">{timer.label}</span> <b>{clock(timer.ms)}</b>
          </span>
        )}
        <div className="nav-actions">
          <button className="icon-btn" onClick={() => setDrawer(drawer === 'leaders' ? null : 'leaders')} aria-expanded={drawer === 'leaders'} aria-label="Leaderboard"><Icon name="trophy" /></button>
          <button className="icon-btn" onClick={() => setDrawer(drawer === 'rules' ? null : 'rules')} aria-expanded={drawer === 'rules'} aria-label="How public hunts work"><Icon name="book" /></button>
          <span className="nav-audio"><AudioToggles /></span>
          <button className="icon-btn hide-narrow" onClick={() => bv.current?.resetView()} aria-label="Reset view"><Icon name="target" /></button>
          <button className="icon-btn" onClick={onLeave} aria-label="Leave the hunt"><Icon name="exit" /></button>
        </div>
      </nav>

      {/* The guess popover rides on the selected space, like the private game's action popover. */}
      <div ref={anchor} className={`anchor ${narrow ? 'docked' : ''}`}>
        <AnimatePresence>
          {selected !== null && phase !== 'over' && (
            <motion.section key={selected} className="popover" aria-label={`Space ${spaceName(selected)}`}
              initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.3, ease: EASE }}>
              <div className="bezel">
                <SpaceBits board={board} i={selected} onClose={() => setSelected(null)} />
                {shown !== null && hunt.clues[shown] && (
                  <p className={`verdict ${clueMap(hunt.clues[shown], board)[selected] ? 'yes' : 'no'}`}>
                    Clue {shown + 1} {clueMap(hunt.clues[shown], board)[selected] ? 'allows this space' : 'rules this space out'}
                  </p>
                )}
                <div className="actions">
                  {tried ? <p className="tried"><Thermo hint={tried.hint} /> You tried {spaceName(selected)}: {HINT_TEXT[tried.hint].toLowerCase()}.</p>
                    : phase === 'briefing' ? <p className="why">Guesses open when the first clue drops.</p>
                    : out ? <p className="why">You have used your one shot.</p>
                    : confirm ? (
                      <div className="confirm" role="group" aria-label="Confirm your shot">
                        <p>This is your only guess. If {spaceName(selected)} is wrong, you are out of the race.</p>
                        <div className="row">
                          <button className="btn search" disabled={busy} onClick={() => guess(selected)} autoFocus>Lock in {spaceName(selected)}</button>
                          <button className="btn ghost" onClick={() => setConfirm(false)}>Back</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn search guess-btn" disabled={busy || wait > 0} onClick={() => (rules.shots === 1 ? setConfirm(true) : guess(selected))}>
                        {wait > 0 && <motion.span className="cooldown" initial={false} animate={{ scaleX: Math.min(1, wait / rules.cooldownMs(Math.max(1, me!.guesses.length))) }} transition={{ duration: 0.25, ease: 'linear' }} />}
                        <Icon name="lens" size={16} /> {wait > 0 ? `Ready in ${Math.ceil(wait / 1000)}s` : `Guess ${spaceName(selected)}`}
                      </button>
                    )}
                </div>
                {error && <p className="error" role="alert">{error}</p>}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <LayoutGroup>
        <AnimatePresence>
          {dropping !== null && (
            <motion.div key={`drop-${dropping}`} className="clue-drop" role="status" initial={{ opacity: 0, y: -24, scale: 0.92, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: EASE }}>
              <motion.div layoutId={`clue-${dropping}`} className="bezel clue-drop-card" transition={SPRING}>
                <span className="clue-num big">{dropping + 1}</span>
                <p className="clue">The habitat is <ClueText id={hunt.clues[dropping]} />.</p>
                <p className="drop-meta">Clue {dropping + 1} of {hunt.total}. The mist shows where it rules out.</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={hud} className="hud-bottom">
          {phase === 'live' && (
            <motion.aside layout className={`case-file ${caseOpen ? 'open' : ''}`} aria-label="Case file" transition={SPRING}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <header className="case-head">
                <motion.h2 layoutId="cryptid-name" className="cryptid-name">{cryptid.name}</motion.h2>
                <span className="case-count">{hunt.clues.length}/{hunt.total}</span>
                <button className="icon-btn small" onClick={() => setCaseOpen((o) => !o)} aria-expanded={caseOpen} aria-label={caseOpen ? 'Fold the case file' : 'Open the case file'}><Icon name={caseOpen ? 'chevron-down' : 'chevron-up'} size={16} /></button>
              </header>
              {caseOpen && (
                <ol className="case-clues" aria-label="Clues so far. Choose one to see where it allows the habitat.">
                  {hunt.clues.map((id, k) => k === dropping ? null : (
                    <motion.li key={k} layoutId={`clue-${k}`} transition={SPRING}>
                      <button className={`case-clue ${lens === k ? 'on' : ''}`} aria-pressed={lens === k} onClick={() => setLens(lens === k ? null : k)}>
                        <span className="clue-num">{k + 1}</span>
                        <span>The habitat is <ClueText id={id} />.</span>
                      </button>
                    </motion.li>
                  ))}
                  {phase === 'live' && hunt.clues.length < hunt.total && (
                    <li className="case-next" aria-live="off">
                      <span className="clue-num ghost">{hunt.clues.length + 1}</span>
                      <span>Next clue in {clock((hunt.nextClueAt ?? now) - now)}</span>
                      <motion.i className="next-bar" key={hunt.clues.length} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }}
                        transition={{ duration: Math.max(0, ((hunt.nextClueAt ?? now) - now) / 1000), ease: 'linear' }} />
                    </li>
                  )}
                </ol>
              )}
              {caseOpen && lens !== null && <p className="lens-note"><Icon name="eye" size={14} /> Showing clue {lens + 1}. Choose it again to clear.</p>}
            </motion.aside>
          )}
          <AnimatePresence mode="wait">
            {prompt && selected === null && (
              <motion.p key={prompt} className={`prompt ${out ? '' : 'mine'}`} aria-live="polite"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: EASE }}>
                {me?.shotsLeft !== null && me?.shotsLeft !== undefined && <span className="shots">{me.shotsLeft} shot{me.shotsLeft === 1 ? '' : 's'}</span>}
                {prompt}
              </motion.p>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {toast && (
              <motion.div key={toast.key} className="toast miss" role="status" initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.45, ease: EASE }}>
                <Thermo hint={toast.g.hint} />
                <span><b>Not {spaceName(toast.g.space)}.</b> {HINT_TEXT[toast.g.hint]}.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>

      <AnimatePresence>
        {phase === 'briefing' && <Briefing hunt={hunt} now={now} />}
      </AnimatePresence>

      <AnimatePresence>
        {result && (
          <motion.aside className="reveal-panel" aria-label="The reveal" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1], delay: reduced() ? 0 : 1.2 }}>
            <Reveal hunt={hunt} me={me} replay={replay} setReplay={setReplay} onNext={onNext} onLeave={onLeave} onLeaders={() => setDrawer('leaders')} />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {drawer && (
          <motion.aside className="log-drawer hunt-drawer" aria-label={drawer === 'rules' ? 'How public hunts work' : 'Leaderboard'}
            initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}>
            <header>
              <h2>{drawer === 'rules' ? 'How it works' : `${rules.name} leaders`}</h2>
              <span className="drawer-audio"><AudioToggles /></span>
              <button className="icon-btn" onClick={() => setDrawer(null)} aria-label="Close the drawer"><Icon name="close" /></button>
            </header>
            {drawer === 'rules' ? <Rules mode={hunt.mode} /> : <LeaderBoard mode={hunt.mode} pid={me?.pid ?? null} />}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function SpaceBits({ board, i, onClose }: { board: Board; i: number; onClose: () => void }) {
  const h = board.hexes[i];
  return (
    <div className="space-info">
      <header className="space-head">
        <span className="space-code">{spaceName(i)}</span>
        <TerrainIcon t={h.terrain} size={18} />
        <h3>{cap(h.terrain)}</h3>
        <button className="icon-btn small" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
      </header>
      {(h.animal || h.structure) && (
        <p className="features">
          {h.animal && <span><TerritoryIcon animal={h.animal} size={16} /> {cap(h.animal)} territory</span>}
          {h.structure && <span><StructureIcon kind={h.structure.kind} color={h.structure.color} size={16} /> {cap(h.structure.color)} {h.structure.kind === 'stone' ? 'standing stone' : 'shack'}</span>}
        </p>
      )}
    </div>
  );
}

/** Before clue 1: the creature, the field report, the rules for this hunt, and the countdown. */
function Briefing({ hunt, now }: { hunt: HuntState; now: number }) {
  const c = CRYPTIDS[hunt.cryptid];
  const left = hunt.startsAt - now;
  return (
    <motion.div className="briefing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5, delay: 0.3 } }}>
      <motion.section className="bezel briefing-card" aria-labelledby="brief-title" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: -16, opacity: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <Eyes />
        <p className="brief-sub">Public hunt #{hunt.number}, {MODE_RULES[hunt.mode].name}</p>
        <motion.h2 layoutId="cryptid-name" id="brief-title" className="cryptid-name big">{c.name}</motion.h2>
        <p className="epithet">{c.epithet}</p>
        <blockquote className="report">{c.report}</blockquote>
        <ul className="brief-rules">
          <li>Everyone here gets the same {hunt.total} clues, at the same moment.</li>
          <li>{MODE_RULES[hunt.mode].rule}</li>
          <li>The first hunter to guess its exact space wins.</li>
        </ul>
        <div className="brief-foot">
          <span className="brief-count"><span className="conn on" /> {hunt.hunters} hunter{hunt.hunters === 1 ? '' : 's'} in</span>
          <span className="brief-clock" aria-live="polite">Clue 1 in <AnimatePresence mode="popLayout" initial={false}>
            <motion.b key={clock(left)} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }}>{clock(left)}</motion.b>
          </AnimatePresence></span>
        </div>
      </motion.section>
    </motion.div>
  );
}

function Rules({ mode }: { mode: HuntMode }) {
  return (
    <div className="notes">
      <p>Hundreds of hunters, one creature, the same clues. Each clue is one true fact about its space, and every new clue narrows the island.</p>
      <ol className="rules">
        <li><h3>Read the clues</h3><p>Choose a clue in the case file to mist the spaces it rules out. You see one clue at a time; putting them together is the hunt.</p></li>
        <li><h3>Guess a space</h3><p>Tap a space, then press Guess. A stray tap never counts. Misses stay on the map as cubes.</p></li>
        <li><h3>{MODE_RULES[mode].name}</h3><p>{MODE_RULES[mode].rule}</p></li>
        <li><h3>First correct guess wins</h3><p>The server takes guesses in the order they arrive; if two land together, the one it reads first wins. Then everyone sees the answer and how the clues led there.</p></li>
      </ol>
    </div>
  );
}

function LeaderBoard({ mode, pid }: { mode: HuntMode; pid: string | null }) {
  const [tab, setTab] = useState<'today' | 'week' | 'all' | 'fastest' | 'sharpest'>('today');
  const [data, setData] = useState<Leaders | null>(null);
  useEffect(() => { call('public:leaders', { mode }).then((r) => { if (r.ok) setData(r.leaders); }); }, [mode]);
  const rows = data?.[tab] ?? [];
  const unit = tab === 'fastest' ? clock : tab === 'sharpest' ? (v: number) => `${v} sp` : (v: number) => `${v} win${v === 1 ? '' : 's'}`;
  return (
    <div className="notes">
      {data?.you && <YourStats s={data.you} />}
      <div className="tabs" role="tablist" aria-label="Board">
        {(['today', 'week', 'all', 'fastest', 'sharpest'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {tab === k && <motion.span layoutId="lb-tab" className="seg-pill" transition={SPRING} />}
            <span>{{ today: 'Today', week: 'Week', all: 'All time', fastest: 'Fastest', sharpest: 'Sharpest' }[k]}</span>
          </button>
        ))}
      </div>
      {tab === 'sharpest' && <p className="dim">Average distance of a miss, over at least five misses. Lower is sharper.</p>}
      {!data ? <p className="dim">Loading...</p> : rows.length === 0 ? <p className="dim">Nobody yet. The first win takes the top spot.</p> : (
        <ol className="board-rows">
          {rows.map((r, k) => (
            <motion.li key={r.pid} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.04, duration: 0.35, ease: EASE }} className={r.pid === pid ? 'me' : ''}>
              <span className="rank">{k + 1}</span><span className="who">{r.name}</span><span className="val">{unit(r.value)}</span>
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}

function YourStats({ s }: { s: Stats }) {
  const items: [string, React.ReactNode][] = [
    ['Hunts', <Count to={s.entered} />],
    ['Wins', <Count to={s.wins} />],
    ['Win rate', <Count to={s.entered ? Math.round((100 * s.wins) / s.entered) : 0} format={(n) => `${n}%`} />],
    ['Best streak', <Count to={s.bestStreak} />],
    ['Fastest', s.fastestMs === null ? 'none' : clock(s.fastestMs)],
    ['Clues at a win', s.wins ? (s.cluesAtWin / s.wins).toFixed(1) : 'none'],
    ['Average miss', s.misses ? `${(s.missSum / s.misses).toFixed(1)} sp` : 'none'],
  ];
  return (
    <section className="your-stats" aria-label="Your record in this mode">
      <h3>{s.name}</h3>
      <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

/** The answer, who found it, how the clues led there, and where the crowd looked. */
function Reveal({ hunt, me, replay, setReplay, onNext, onLeave, onLeaders }: {
  hunt: HuntState; me: HunterView | null; replay: number | null; setReplay: (n: number | null) => void;
  onNext: () => void; onLeave: () => void; onLeaders: () => void;
}) {
  const r = hunt.result!;
  const c = CRYPTIDS[hunt.cryptid];
  const steps = useMemo(() => narrowing(hunt.board, r.clues), [hunt.board, r.clues]);
  const mine = me?.guesses ?? [];
  const best = mine.length ? Math.min(...mine.map((g) => distance(g.space, r.habitat))) : null;
  const won = r.winner && r.winner.pid === me?.pid;
  const fav = r.heat.reduce((b, x, i, a) => (x > a[b] ? i : b), 0);
  const total = r.heat.reduce((a, b) => a + b, 0);
  const [copied, setCopied] = useState(false);

  // Replay: step the mist through each clue, so the board shows the field closing in on the answer.
  useEffect(() => {
    if (replay === null) return;
    const id = setTimeout(() => setReplay(replay + 1 < r.clues.length ? replay + 1 : null), 1300);
    return () => clearTimeout(id);
  }, [replay, r.clues.length, setReplay]);

  const share = () => {
    const how = won ? `I found ${c.name} on clue ${r.winner!.clues} in ${clock(r.winner!.ms)}`
      : best !== null ? `My closest guess was ${best} space${best === 1 ? '' : 's'} off` : 'I watched';
    navigator.clipboard?.writeText(`Hunch public hunt #${hunt.number} (${MODE_RULES[hunt.mode].name}). ${how}. ${mine.length} guess${mine.length === 1 ? '' : 'es'}. ${location.origin}`);
    setCopied(true);
  };

  return (
    <div className="bezel reveal-card">
      <p className={`reveal-title ${r.winner ? '' : 'escaped'}`}>
        {won ? `You found ${c.name}` : r.winner ? `${r.winner.name} found ${c.name}` : `${c.name} slipped away`}
      </p>
      <p className="dim">
        {spaceName(r.habitat)}: {describeSpace(hunt.board, r.habitat).toLowerCase()}.
        {r.winner ? ` Found on clue ${r.winner.clues} of ${r.clues.length}, ${clock(r.winner.ms)} after the first clue.` : ' Nobody found it before the clock ran out.'}
      </p>
      <div className="reveal-stats">
        <div><b>{best === null ? 'none' : best === 0 ? 'found' : <><Count to={best} /> sp</>}</b><span>your closest</span></div>
        <div><b><Count to={mine.length} /></b><span>your guesses</span></div>
        <div><b><Count to={total} /></b><span>guesses in all</span></div>
      </div>

      <section className="reveal-section" aria-label="How the clues led there">
        <header><h3>How the clues led there</h3>
          <button className="text-btn" onClick={() => setReplay(replay === null ? 0 : null)}>{replay === null ? 'Replay on the map' : 'Stop'}</button>
        </header>
        <ol className="narrow-list">
          {r.clues.map((id, k) => (
            <li key={id} className={`${replay === k ? 'on' : ''} ${k >= hunt.clues.length ? 'unseen' : ''}`}>
              <span className="clue-num">{k + 1}</span>
              <span>The habitat is <ClueText id={id} />.{k >= hunt.clues.length && <em className="unseen-tag"> Never dropped.</em>}</span>
              <span className="left">{steps[k + 1]} left</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="reveal-section" aria-label="Where the crowd looked">
        <header><h3>Where the crowd looked</h3></header>
        <CrowdMap board={hunt.board} heat={r.heat} habitat={r.habitat} mine={mine.map((g) => g.space)} fav={total ? fav : null} />
        {total > 0 && <p className="dim">Most guessed: {spaceName(fav)} ({r.heat[fav]} guess{r.heat[fav] === 1 ? '' : 'es'}), {distance(fav, r.habitat) === 0 ? 'the right space' : `${distance(fav, r.habitat)} space${distance(fav, r.habitat) === 1 ? '' : 's'} off`}.</p>}
        {r.closest.length > 0 && (
          <ol className="board-rows compact">
            {r.closest.slice(0, 5).map((x, k) => (
              <li key={x.pid} className={x.pid === me?.pid ? 'me' : ''}><span className="rank">{k + 1}</span><span className="who">{x.name}</span><span className="val">{x.d === 0 ? 'found' : `${x.d} sp`}</span></li>
            ))}
          </ol>
        )}
      </section>

      <div className="row">
        <button className="btn primary grow" onClick={onNext}>Next hunt <Icon name="arrow" size={16} /></button>
        <button className="btn ghost" onClick={share}>{copied ? 'Copied' : 'Copy result'}</button>
        <button className="btn ghost" onClick={onLeaders}>Leaders</button>
        <button className="text-btn" onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}

/** A flat copy of the island tinted by how often each space was guessed, with the answer ringed in gold. */
function CrowdMap({ board, heat, habitat, mine, fav }: { board: Board; heat: number[]; habitat: number; mine: number[]; fav: number | null }) {
  const max = Math.max(1, ...heat);
  const w = R * (1.5 * (COLS - 1) + 2) + 60, h = R * SQ3 * (ROWS + 0.5) + 60;
  return (
    <svg className="crowd-map" viewBox={`20 20 ${w - 40} ${h - 40}`} role="img" aria-label={`Guess density map. The answer, ${spaceName(habitat)}, is ringed in gold.`}>
      {board.hexes.map((x, i) => {
        const [cx, cy] = center(i);
        return (
          <g key={i}>
            <polygon points={hexPoints(cx, cy, R - 1.5)} fill={x.terrain === 'water' ? WATER_COLOR : TERRAIN_COLORS[x.terrain]} opacity={0.32} />
            {heat[i] > 0 && <motion.polygon points={hexPoints(cx, cy, R - 1.5)} fill="#f4f1e8" initial={{ opacity: 0 }} animate={{ opacity: 0.12 + 0.78 * (heat[i] / max) }} transition={{ duration: 0.8, ease: EASE, delay: 0.3 + (i % 12) * 0.03 }} />}
          </g>
        );
      })}
      {fav !== null && fav !== habitat && <polygon points={hexPoints(...center(fav), R - 4)} fill="none" stroke="#f4f1e8" strokeWidth="3" strokeDasharray="6 5" />}
      {mine.map((i) => <circle key={i} cx={center(i)[0]} cy={center(i)[1]} r="5" fill="#ff7a59" stroke="#050d18" strokeWidth="1.5" />)}
      <motion.polygon points={hexPoints(...center(habitat), R + 2)} fill="none" stroke="#ffc857" strokeWidth="6"
        initial={{ scale: 2.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.6 }}
        style={{ transformOrigin: `${center(habitat)[0]}px ${center(habitat)[1]}px` }} />
    </svg>
  );
}
