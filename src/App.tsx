import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { type Mode, generateBoard, rng } from '../shared/board.ts';
import { type Action, type GameState, actor, apply, illegal, newGame, viewFor } from '../shared/engine.ts';
import { type BoardLike, createBoard } from './board2d.ts';
import { AudioToggles, EASE, Game, logText } from './Game.tsx';
import { HowTo } from './HowTo.tsx';
import { type RoomUpdate, call, clearSeat, loadHunter, loadSeat, saveSeat, socket } from './net.ts';
import type { HuntMode } from '../shared/hunt.ts';
import { PublicGame, PublicSheet, useLobby } from './Public.tsx';
import { Glyph, Icon } from './pieces.tsx';

type Screen = { k: 'home' } | { k: 'local'; names: string[]; mode: Mode } | { k: 'online' }
  | { k: 'public'; mode: HuntMode; name: string; resume: boolean };

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;

// Dev-only review states: ?demo=<seed>&steps=<n> starts a 4-player local game and auto-plays n legal moves.
const demo = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
function demoGame(seed: number, steps: number, mode: Mode) {
  let s = newGame(seed, ['Ana', 'Ben', 'Cy', 'Dee'], seed, mode);
  const r = rng(seed);
  const pick = (ok: (i: number) => boolean) => { const all = [...Array(108).keys()].filter(ok); return all[Math.floor(r() * all.length)]; };
  for (let k = 0; k < steps && s.phase !== 'over'; k++) {
    const p = s.turn;
    const a: Action = s.phase === 'play'
      ? (() => { const target = (p + 1 + Math.floor(r() * 3)) % 4; return { type: 'question', target, space: pick((i) => !illegal(s, p, { type: 'question', space: i, target })) }; })()
      : { type: s.phase === 'disc' ? 'disc' : 'cube', space: pick((i) => !illegal(s, p, { type: s.phase === 'disc' ? 'disc' : 'cube', space: i })) };
    s = apply(s, p, a);
  }
  return s;
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    if (demo?.has('demo')) return { k: 'local', names: [], mode: demo.has('hard') ? 'hard' : 'standard' };
    if (loadSeat()) return { k: 'online' };
    const hunter = loadHunter(); // a refresh mid-hunt goes straight back to it
    return hunter?.active ? { k: 'public', mode: hunter.mode, name: hunter.name, resume: true } : { k: 'home' };
  });
  const home = () => setScreen({ k: 'home' });
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        <motion.div key={screen.k} className="screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}>
          {screen.k === 'public' ? <PublicGame mode={screen.mode} name={screen.name} resume={screen.resume} onLeave={home} />
            : screen.k === 'local' ? <LocalGame names={screen.names} mode={screen.mode} onLeave={home} />
            : screen.k === 'online' ? <OnlineGame onLeave={home} />
            : <Home onLocal={(names, mode) => setScreen({ k: 'local', names, mode })} onOnline={() => setScreen({ k: 'online' })}
                onPublic={(mode, name) => setScreen({ k: 'public', mode, name, resume: false })} />}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}

/** The living island as a full-bleed backdrop (home, lobby, notices). */
function World({ onReady }: { onReady?: (v: BoardLike) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = createBoard(host.current!, generateBoard(randomSeed()), { pick: () => {}, hover: () => {} }, { showcase: true });
    onReady?.(v);
    return () => v.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="world" aria-hidden="true" />;
}

// ---- Home --------------------------------------------------------------------------------------

/** Standard or hard, with one line on what hard changes. */
function ModePicker({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="field">
      <span>Difficulty</span>
      <div className="segmented" role="radiogroup" aria-label="Difficulty">
        {(['standard', 'hard'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
            {mode === k && <motion.span layoutId="mode-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
            <span>{k === 'standard' ? 'Standard' : 'Hard'}</span>
          </button>
        ))}
      </div>
      <span className="mode-note">{mode === 'hard' ? 'Some clues say where the habitat is not, and black structures join the map.' : 'Every clue says where the habitat could be.'}</span>
    </div>
  );
}

function Home({ onLocal, onOnline, onPublic }: { onLocal: (names: string[], mode: Mode) => void; onOnline: () => void; onPublic: (mode: HuntMode, name: string) => void }) {
  const roomFromUrl = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
  const world = useRef<BoardLike | null>(null);
  const [sheet, setSheet] = useState<null | 'local' | 'online' | 'public'>(roomFromUrl ? 'online' : null);
  const [rules, setRules] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [names, setNames] = useState(['', '', '']);
  const [mode, setMode] = useState<Mode>('standard');
  const [name, setName] = useState(() => loadHunter()?.name ?? '');
  const [code, setCode] = useState(roomFromUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lobby = useLobby(!leaving);
  const hunting = lobby ? Object.values(lobby.modes).reduce((n, m) => n + m.hunters, 0) : 0;

  // The transition into play: the camera dives toward the island while the interface falls away.
  function go(then: () => void) {
    setLeaving(true);
    world.current?.dive(0.75);
    setTimeout(then, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700);
  }

  function startLocal(e: React.FormEvent) {
    e.preventDefault();
    const clean = names.map((n, i) => n.trim().slice(0, 20) || `Player ${i + 1}`);
    if (new Set(clean.map((n) => n.toLowerCase())).size !== clean.length) return setError('Give every player a different name.');
    go(() => onLocal(clean, mode));
  }

  async function online(kind: 'create' | 'join') {
    if (!name.trim()) return setError('Write your name first.');
    if (kind === 'join' && !/^[A-Za-z]{4}$/.test(code.trim())) return setError('Room codes are four letters.');
    setBusy(true);
    setError(null);
    const res = await call(kind, kind === 'create' ? { name } : { name, code });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    saveSeat(res.code, res.token);
    history.replaceState(null, '', `?room=${res.code}`);
    go(onOnline);
  }

  return (
    <div className={`home ${leaving ? 'leaving' : ''}`}>
      <World onReady={(v) => { world.current = v; }} />
      <div className="vignette" aria-hidden="true" />
      <div className="audio-toggles"><AudioToggles /></div>

      <AnimatePresence>
        {!leaving && (
          <motion.main key="hero" className="hero" exit={{ opacity: 0, y: 20, filter: 'blur(8px)' }} transition={{ duration: 0.5, ease: EASE }}>
            <h1 aria-label="Hunch">
              {/* Each letter rises out of the mist in turn. */}
              <span className="title" aria-hidden="true">
                {[...'Hunch'].map((ch, k) => (
                  <motion.span key={k} initial={{ opacity: 0, y: '0.5em', filter: 'blur(12px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 1.1, ease: EASE, delay: 0.25 + k * 0.08 }}>{ch}</motion.span>
                ))}
              </span>
              <motion.span className="tagline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.85 }}>
                Follow the clues. Find the creature.
              </motion.span>
            </h1>
            <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.45 }}>
              Something lives on one space of this island. Each of you knows a single thing about where. Ask, watch the answers land, and find it first.
            </motion.p>
            <motion.div className="hero-actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.6 }}>
              <button className="cta" onClick={() => setSheet('local')}>
                Begin the hunt
                <span className="cta-icon"><Icon name="arrow" size={18} /></span>
              </button>
              <button className="btn public-btn" onClick={() => { setSheet('public'); setError(null); }}>
                <span className={`live-dot ${hunting ? 'busy' : ''}`} aria-hidden="true" />
                Public hunt
                <span className="public-count">{hunting ? `${hunting} hunting now` : 'race everyone'}</span>
              </button>
              <button className="text-btn" onClick={() => setRules(true)}>How to play</button>
            </motion.div>
            <p className="meta">
              <span>3 to 5 players</span><i /><span>about 30 minutes</span><i /><span>one device or online</span><i /><span>or everyone at once</span>
            </p>
          </motion.main>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && !leaving && (
          <motion.aside key="sheet" className="sheet" aria-label={sheet === 'public' ? 'Public hunt' : 'Start an expedition'}
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}>
            <div className="bezel">
              {sheet === 'public' ? <>
                <header className="sheet-head">
                  <h2>Public hunt</h2>
                  <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close"><Icon name="close" /></button>
                </header>
                <PublicSheet lobby={lobby} name={name} setName={setName} onStart={(m, n) => go(() => onPublic(m, n))} />
              </> : <>
              <header className="sheet-head">
                <h2>Start an expedition</h2>
                <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close"><Icon name="close" /></button>
              </header>
              <div className="segmented" role="tablist">
                {(['local', 'online'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={sheet === k} className={sheet === k ? 'on' : ''} onClick={() => { setSheet(k); setError(null); }}>
                    {sheet === k && <motion.span layoutId="seg" className="seg-pill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                    <span>{k === 'local' ? 'One device' : 'Online'}</span>
                  </button>
                ))}
              </div>
              {sheet === 'local' ? (
                <form className="sheet-body" onSubmit={startLocal}>
                  <p className="dim">Pass the device around. Each clue stays hidden until its owner says it is them.</p>
                  <div className="name-list">
                    {names.map((n, i) => (
                      <label key={i} className="name-row">
                        <Glyph p={i} size={26} />
                        <span className="sr-only">Player {i + 1} name</span>
                        <input value={n} maxLength={20} placeholder={`Player ${i + 1}`} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
                        {names.length > 3 && <button type="button" className="icon-btn small" onClick={() => setNames(names.filter((_, j) => j !== i))} aria-label={`Remove player ${i + 1}`}><Icon name="close" size={14} /></button>}
                      </label>
                    ))}
                  </div>
                  <ModePicker mode={mode} setMode={setMode} />
                  <div className="row">
                    {names.length < 5 && <button type="button" className="btn ghost" onClick={() => setNames([...names, ''])}>Add a player</button>}
                    <button className="btn primary grow">Start <Icon name="arrow" size={16} /></button>
                  </div>
                </form>
              ) : (
                <div className="sheet-body">
                  <p className="dim">Everyone on their own device. Host a room and share its code.</p>
                  <label className="field"><span>Your name</span>
                    <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
                  </label>
                  <button className="btn primary" disabled={busy} onClick={() => online('create')}>Host a room <Icon name="arrow" size={16} /></button>
                  <div className="join-row">
                    <label className="field"><span>Room code</span>
                      <input value={code} maxLength={4} placeholder="ABCD" className="code-input" onChange={(e) => setCode(e.target.value.toUpperCase())} />
                    </label>
                    <button className="btn ghost" disabled={busy} onClick={() => online('join')}>Join</button>
                  </div>
                </div>
              )}
              {error && <p className="error" role="alert">{error}</p>}
              </>}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <div className="veil" aria-hidden="true" />
      <HowTo open={rules} onClose={() => setRules(false)} />
    </div>
  );
}

// ---- Pass and play -------------------------------------------------------------------------------

function LocalGame({ names: start, mode, onLeave }: { names: string[]; mode: Mode; onLeave: () => void }) {
  const [state, setState] = useState<GameState>(() =>
    demo?.has('demo') ? demoGame(Number(demo.get('demo')), Number(demo.get('steps') ?? 0), mode) : newGame(randomSeed(), start, randomSeed(), mode));
  const [revealedFor, setRevealedFor] = useState<number | null>(() => (demo?.has('demo') ? actor(state) : null));
  const who = actor(state);
  const viewer = who ?? revealedFor ?? 0;
  const curtain = who !== null && revealedFor !== who;
  const names = state.players;

  async function act(a: Action) {
    const err = illegal(state, viewer, a);
    if (err) return err;
    setState(apply(state, viewer, a));
    return null;
  }

  const last = state.log.at(-1);
  return (
    <>
      <Game view={viewFor(state, curtain ? null : viewer)} label="Pass and play" act={act} onLeave={onLeave}
        onRestart={() => { setState(newGame(randomSeed(), state.players, randomSeed(), state.board.mode)); setRevealedFor(null); }} />
      <AnimatePresence>
        {curtain && (
          <motion.div key={who} className="curtain" role="dialog" aria-modal="true" aria-labelledby="curtain-title"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }}>
            <motion.div className="curtain-card" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} transition={{ duration: 0.6, ease: EASE }}>
              <Glyph p={who} size={56} />
              <h2 id="curtain-title">Pass to {names[who]}</h2>
              {last && <p className="curtain-last">{logText(last, (p) => names[p])}</p>}
              <p className="dim">Everyone else, look away. The next screen shows {names[who]}'s clue.</p>
              <button className="cta" onClick={() => setRevealedFor(who)} autoFocus>
                I am {names[who]}
                <span className="cta-icon"><Icon name="eye" size={18} /></span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ---- Online ----------------------------------------------------------------------------------------

function OnlineGame({ onLeave }: { onLeave: () => void }) {
  const [update, setUpdate] = useState<RoomUpdate | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<Mode>('standard');

  useEffect(() => {
    const resume = async () => {
      const seat = loadSeat();
      if (!seat) return;
      const res = await call('resume', seat);
      if (!res.ok) { clearSeat(); setError(res.error); }
    };
    const onConnect = () => { setConnected(true); resume(); };
    const onDisconnect = () => setConnected(false);
    socket.on('room', setUpdate);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) resume(); else socket.connect();
    return () => { socket.off('room', setUpdate); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, []);

  async function leave() {
    await call('leave');
    clearSeat();
    history.replaceState(null, '', location.pathname);
    socket.disconnect();
    onLeave();
  }

  async function start(m: Mode = mode) {
    const res = await call('start', { mode: m });
    setError(res.ok ? null : res.error);
  }

  if (update?.view) {
    return (
      <Game view={update.view} seats={update.seats} label={`Room ${update.code}`} connected={connected}
        act={async (a) => { const r = await call('act', a); return r.ok ? null : r.error; }}
        onLeave={leave} onRestart={update.you === 0 ? () => start(update.view!.board.mode) : undefined} />
    );
  }

  const link = update ? `${location.origin}${location.pathname}?room=${update.code}` : '';
  const host = update?.you === 0;
  return (
    <div className="home">
      <World />
      <div className="vignette" aria-hidden="true" />
      <motion.section className="sheet lobby" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <div className="bezel">
          {!update ? (
            error ? <><p className="error" role="alert">{error}</p><button className="btn primary" onClick={onLeave}>Back to the start</button></>
              : <p className="dim">Finding your room...</p>
          ) : (
            <>
              <header className="sheet-head">
                <h2>Room <span className="code">{update.code}</span></h2>
                <button className="icon-btn" onClick={leave} aria-label="Leave room"><Icon name="exit" /></button>
              </header>
              <p className="dim">Share the code or the link. The host starts once 3 to 5 people are in.</p>
              <div className="join-row">
                <input className="link-input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
                <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              <ol className="seats">
                <AnimatePresence initial={false}>
                  {update.seats.map((s, p) => (
                    <motion.li key={p} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE }}>
                      <Glyph p={p} size={28} />
                      <span className="seat-name">{s.name}{p === update.you && <span className="dim"> (you)</span>}</span>
                      <span className={`seat-state ${s.online ? 'on' : ''}`}>{p === 0 ? 'Host' : s.online ? 'Here' : 'Offline'}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
              {host && <ModePicker mode={mode} setMode={setMode} />}
              {host
                ? <button className="cta wide" disabled={update.seats.length < 3} onClick={() => start()}>
                    {update.seats.length < 3 ? `Waiting for ${3 - update.seats.length} more` : 'Start the hunt'}
                    <span className="cta-icon"><Icon name="arrow" size={18} /></span>
                  </button>
                : <p className="dim">Waiting for {update.seats[0].name} to start.</p>}
              {!connected && <p className="error">Reconnecting...</p>}
              {error && <p className="error" role="alert">{error}</p>}
            </>
          )}
        </div>
      </motion.section>
    </div>
  );
}
