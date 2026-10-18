import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { type Board, CLUE, COLS, ROWS, SPACES, colOf, rowOf, spaceName } from '../shared/board.ts';
import { type Action, type LogEntry, type PlayerView, actor, allowed, illegal } from '../shared/engine.ts';
import type { Seat } from '../shared/protocol.ts';
import { type BoardLike, createBoard } from './board2d.ts';
import { Glyph, Icon, Piece, StructureIcon, TerrainIcon, TerritoryIcon } from './pieces.tsx';
import { HowTo } from './HowTo.tsx';
import { openHabitats, suspects } from './notes.ts';
import { isOn, onPrefsChange, setPref, sfx } from './sound.ts';

export interface GameProps {
  view: PlayerView;
  seats?: Seat[]; // online only
  label: string; // "Pass and play" or "Room ABCD"
  connected?: boolean;
  act: (a: Action) => Promise<string | null>;
  onLeave: () => void;
  onRestart?: () => void;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;

export function describeSpace(board: Board, i: number) {
  const h = board.hexes[i];
  const parts = [cap(h.terrain)];
  if (h.animal) parts.push(`${cap(h.animal)} territory`);
  if (h.structure) parts.push(`${cap(h.structure.color)} ${h.structure.kind === 'stone' ? 'standing stone' : 'abandoned shack'}`);
  return parts.join(', ');
}

/** Separate switches for sound effects and background music, remembered on this device. */
export function AudioToggles() {
  const [, redraw] = useState(0);
  useEffect(() => onPrefsChange(() => redraw((n) => n + 1)), []);
  const fx = isOn('sound'), music = isOn('music');
  return (
    <>
      <button className="icon-btn" onClick={() => setPref('sound', !fx)} aria-pressed={fx} aria-label={fx ? 'Mute sound effects' : 'Turn sound effects on'} title={fx ? 'Sound effects on' : 'Sound effects off'}><Icon name={fx ? 'sound' : 'mute'} /></button>
      <button className="icon-btn" onClick={() => setPref('music', !music)} aria-pressed={music} aria-label={music ? 'Stop the music' : 'Play the music'} title={music ? 'Music on' : 'Music off'}><Icon name={music ? 'music' : 'music-off'} /></button>
    </>
  );
}

/** A clue's text, with "not" set apart so a negative clue is never misread. */
export function ClueText({ id }: { id: string }) {
  const t = CLUE[id].text;
  return t.startsWith('not ') ? <><em className="not">not</em>{t.slice(3)}</> : <>{t}</>;
}

export function logText(l: LogEntry, who: (p: number, object?: boolean) => string) {
  const s = spaceName(l.t === 'skip' ? 0 : l.space);
  switch (l.t) {
    case 'setup': return `${who(l.p)} placed an opening cube on ${s}.`;
    case 'penalty': return `${who(l.p)} placed a penalty cube on ${s}.`;
    case 'skip': return `${who(l.p)} owed a penalty cube but had no legal space for it.`;
    case 'question': return `${who(l.p)} asked ${who(l.target, true)} about ${s}: ${l.answer === 'disc' ? 'a disc, it could be there' : 'a cube, it is not there'}.`;
    case 'search': {
      const extra = l.extra !== undefined ? ` (extra disc on ${spaceName(l.extra)})` : '';
      const tail = l.found ? 'Every clue agrees: habitat found.' : `${who(l.answers.at(-1)!.p)} placed a cube. Search failed.`;
      return `${who(l.p)} searched ${s}${extra}. ${tail}`;
    }
  }
}

const useNarrow = () => {
  const q = '(max-width: 700px)';
  const [narrow, set] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q), f = () => set(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return narrow;
};

export function Game({ view, seats, label, connected = true, act, onLeave, onRestart }: GameProps) {
  const { board, players, you, phase } = view;
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const bv = useRef<BoardLike | null>(null);
  const nav = useRef<HTMLElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hatch, setHatch] = useState(true);
  const [confirmSearch, setConfirmSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [clueOpen, setClueOpen] = useState(() => !matchMedia('(max-width: 700px)').matches);
  const [toast, setToast] = useState<{ l: LogEntry; key: number } | null>(null);
  const [drawerTab, setDrawerTab] = useState<'log' | 'notes'>('log');
  const [tableFade, setTableFade] = useState(false);
  useEffect(() => { if (logOpen || rules) sfx.open(); }, [logOpen, rules]);
  const narrow = useNarrow();
  const mine = you !== null && actor(view) === you;
  const myAllowed = you !== null ? allowed(view, you) : null;
  const who = (p: number, object = false) => (p === you ? (object ? 'you' : 'You') : players[p]);

  // Board lifetime follows the board itself (a new game means a new scene).
  useEffect(() => {
    const v = createBoard(host.current!, board, { pick: (i) => setSelected(i), hover: () => {} });
    bv.current = v;
    v.setMarks(view.marks, false);
    // Fit the island between the nav pill and the bottom HUD.
    // On wide screens the clue card sits in a corner, so only the prompt row is reserved; phones stack the whole HUD.
    const fit = () => v.setInsets(nav.current!.getBoundingClientRect().bottom + 8, innerWidth > 700 ? 72 : innerHeight - hud.current!.getBoundingClientRect().top + 8);
    fit();
    addEventListener('resize', fit);
    return () => { removeEventListener('resize', fit); v.dispose(); bv.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.seed]);

  useEffect(() => { bv.current?.setMarks(view.marks, true); }, [view.marks]);
  useEffect(() => {
    if (selected !== null) sfx.select();
    bv.current?.setSelected(selected);
    setConfirmSearch(false);
    setError(null);
    // The popover rides on the selected space; on phones it docks as a bottom sheet instead.
    if (anchor.current) bv.current?.follow(anchor.current, narrow ? null : selected);
  }, [selected, narrow]);
  useEffect(() => { bv.current?.setHabitat(view.habitat); if (view.habitat !== null) setSelected(null); }, [view.habitat]);
  // Fade what your clue rules out, and optionally what the table's pieces have ruled out too (the notebook).
  const open = useMemo(() => (tableFade && you !== null && view.clues[you] ? openHabitats(view, you) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableFade, you, view.marks]);
  const hatchMask = useMemo(() => (myAllowed && phase !== 'over' && (hatch || open)
    ? myAllowed.map((ok, i) => (hatch && !ok) || (!!open && !open[i])) : null), [hatch, open, myAllowed, phase]);
  // A chime when the move comes to you.
  const wasMine = useRef(mine);
  useEffect(() => { if (mine && !wasMine.current) sfx.turn(); wasMine.current = mine; }, [mine]);
  useEffect(() => { bv.current?.setHatch(hatchMask); }, [hatchMask]);

  // Each new log entry: a short toast, and the matching effect on the board.
  const logLen = view.log.length;
  const seen = useRef(logLen);
  useEffect(() => {
    if (logLen <= seen.current) { seen.current = logLen; return; }
    seen.current = logLen;
    const l = view.log[logLen - 1];
    if (l.t === 'question') bv.current?.pulse(l.space, 'question');
    if (l.t === 'search' && !l.found) bv.current?.pulse(l.space, 'fail');
    // Sounds line up with the pieces landing (the drop takes about 0.45s).
    if (l.t === 'setup' || l.t === 'penalty') sfx.cube();
    if (l.t === 'question') { sfx.ask(); if (l.answer === 'disc') sfx.disc(); else sfx.cube(); }
    if (l.t === 'search') { if (l.found) sfx.win(); else sfx.fail(); }
    if (phase !== 'over') setToast({ l, key: logLen });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLen]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4800);
    return () => clearTimeout(id);
  }, [toast]);

  async function run(a: Action) {
    setBusy(true);
    setError(null);
    const err = await act(a);
    setBusy(false);
    setConfirmSearch(false);
    if (err) setError(err);
    else setSelected(null); // the popover closes and the answer lands on the board
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

  const setupLeft = you !== null ? 2 - view.log.filter((l) => l.t === 'setup' && l.p === you).length : 0;
  const prompt = (() => {
    if (phase === 'over') return null;
    if (!mine) {
      const n = players[view.turn];
      return phase === 'setup' || phase === 'penalty' ? `${n} is placing a cube` : phase === 'disc' ? `${n} is placing an extra disc` : `${n} is choosing a space`;
    }
    if (phase === 'setup') return `Opening cube ${3 - setupLeft} of 2. Pick a space your clue rules out`;
    if (phase === 'penalty') return 'You owe a cube. Pick a space your clue rules out';
    if (phase === 'disc') return 'Place an extra disc on another space your clue allows';
    return 'Your move. Pick a space to question or search';
  })();

  return (
    <div className="game">
      <div ref={host} className="board-host" tabIndex={0} role="application" onKeyDown={onKey}
        aria-label="Map. Use the arrow keys to move between spaces; the selected space opens a panel with its details and actions." />

      <nav ref={nav} className="island-nav" aria-label="Game">
        <span className="wordmark">Hunch</span>
        {board.mode === 'hard' && <span className="mode-badge" title="Hard mode: some clues say where the habitat is not, and black structures are in play">Hard</span>}
        <ol className="turn-strip" aria-label="Turn order">
          {players.map((name, p) => {
            const active = actor(view) === p;
            const offline = seats && !seats[p]?.online;
            return (
              <li key={p} className={`turn ${active ? 'active' : ''} ${view.winner === p ? 'winner' : ''} ${offline ? 'offline' : ''}`} aria-current={active ? 'step' : undefined}>
                {active && <motion.span layoutId="turn-ring" className="turn-ring" transition={SPRING} />}
                <Glyph p={p} size={22} />
                <span className="turn-name">{name}{p === you && <span className="you"> (you)</span>}</span>
              </li>
            );
          })}
        </ol>
        <div className="nav-actions">
          {seats && <span className={`conn ${connected ? 'on' : 'off'}`} title={connected ? 'Connected' : 'Reconnecting'}><span className="sr-only">{connected ? 'Connected' : 'Reconnecting'}</span></span>}
          <span className="room">{label}</span>
          <button className="icon-btn" onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen} aria-label="Field log and notebook"><Icon name="log" /></button>
          <button className="icon-btn" onClick={() => setRules(true)} aria-label="How to play"><Icon name="book" /></button>
          <span className="nav-audio"><AudioToggles /></span>
          <button className="icon-btn hide-narrow" onClick={() => bv.current?.resetView()} aria-label="Reset view"><Icon name="target" /></button>
          <button className="icon-btn" onClick={onLeave} aria-label="Leave game"><Icon name="exit" /></button>
        </div>
      </nav>


      {/* The anchor is positioned by the scene every frame; the panel inside animates. */}
      <div ref={anchor} className={`anchor ${narrow ? 'docked' : ''}`}>
        <AnimatePresence>
          {selected !== null && phase !== 'over' && (
            <motion.section key={selected} className="popover" aria-label={`Space ${spaceName(selected)}`}
              initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.3, ease: EASE }}>
              <div className="bezel">
                <SpaceInfo view={view} i={selected} myAllowed={myAllowed} onClose={() => setSelected(null)} />
                {mine && (
                  <div className="actions">
                    {(phase === 'setup' || phase === 'penalty') && (
                      <ActionButton a={{ type: 'cube', space: selected }} view={view} you={you!} busy={busy} run={run} className="primary">
                        <Piece kind="cube" p={you!} size={16} /> Place a cube here
                      </ActionButton>
                    )}
                    {phase === 'disc' && (
                      <ActionButton a={{ type: 'disc', space: selected }} view={view} you={you!} busy={busy} run={run} className="primary">
                        <Piece kind="disc" p={you!} size={16} /> Place the extra disc
                      </ActionButton>
                    )}
                    {phase === 'play' && !confirmSearch && (
                      <>
                        <p className="act-label">Ask</p>
                        <div className="ask-row" role="group" aria-label="Ask a player about this space">
                          {players.map((name, t) => t === you ? null : (
                            <ActionButton key={t} a={{ type: 'question', space: selected, target: t }} view={view} you={you!} busy={busy} run={run} className="ask">
                              <Glyph p={t} size={22} /> {name}
                            </ActionButton>
                          ))}
                        </div>
                        <button className="btn search" disabled={busy || !!illegal(view, you!, { type: 'search', space: selected })} onClick={() => setConfirmSearch(true)}>
                          <Icon name="lens" size={16} /> Search here
                        </button>
                      </>
                    )}
                    {phase === 'play' && confirmSearch && (
                      <div className="confirm" role="group" aria-label="Confirm search">
                        <p>
                          Everyone answers in turn. A single cube ends the search and costs you a cube.
                          {view.marks[selected].discs.includes(you!) && ' You already have a disc here, so you will place one more elsewhere first.'}
                        </p>
                        <div className="row">
                          <button className="btn search" disabled={busy} onClick={() => run({ type: 'search', space: selected })} autoFocus>Search {spaceName(selected)}</button>
                          <button className="btn ghost" onClick={() => setConfirmSearch(false)}>Back</button>
                        </div>
                      </div>
                    )}
                    <Why view={view} you={you!} selected={selected} />
                  </div>
                )}
                {error && <p className="error" role="alert">{error}</p>}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <div ref={hud} className="hud-bottom">
        {you !== null && view.clues[you] && phase !== 'over' && (
          <motion.aside layout className={`clue-card ${clueOpen ? 'open' : ''}`} aria-label="Your clue" transition={SPRING}>
            {clueOpen
              ? <button className="icon-btn small clue-hide" onClick={() => setClueOpen(false)} aria-expanded aria-label="Hide your clue"><Icon name="eye" size={16} /></button>
              : <button className="clue-show" onClick={() => setClueOpen(true)} aria-expanded={false}><Icon name="eye" size={16} /> Show clue</button>}
            {clueOpen && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: EASE }}>
                <p className="clue">The habitat is <ClueText id={view.clues[you]!} />.</p>
                <label className="hatch-toggle">
                  <input type="checkbox" checked={hatch} onChange={(e) => setHatch(e.target.checked)} />
                  <Icon name="pencil" size={15} /> Fade the spaces it rules out
                </label>
              </motion.div>
            )}
          </motion.aside>
        )}
        <AnimatePresence mode="wait">
          {prompt && selected === null && (
            <motion.p key={prompt} className={`prompt ${mine ? 'mine' : ''}`} aria-live="polite"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: EASE }}>
              <Glyph p={view.turn} size={18} /> {prompt}
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {toast && (
            <motion.div key={toast.key} className="toast" role="status" initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.45, ease: EASE }}>
              <Glyph p={toast.l.p} size={20} />
              <span>{logText(toast.l, who)}</span>
              {toast.l.t !== 'skip' && (
                <button className="coord" onClick={() => setSelected((toast.l as { space: number }).space)} aria-label={`Show ${spaceName(toast.l.space)} on the map`}>{spaceName(toast.l.space)}</button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {phase === 'over' && (
          <motion.div className="reveal" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 1.1 }}>
            <Reveal view={view} onRestart={onRestart} onLeave={onLeave} who={who} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {logOpen && (
          <motion.aside className="log-drawer" aria-label="Field log and notebook" initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}>
            <header>
              <div className="segmented small" role="tablist" aria-label="Drawer">
                {(['log', 'notes'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={drawerTab === k} className={drawerTab === k ? 'on' : ''} onClick={() => setDrawerTab(k)}>
                    {drawerTab === k && <motion.span layoutId="drawer-tab" className="seg-pill" transition={SPRING} />}
                    <span>{k === 'log' ? 'Field log' : 'Notebook'}</span>
                  </button>
                ))}
              </div>
              <span className="drawer-audio"><AudioToggles /></span>
              <button className="icon-btn" onClick={() => setLogOpen(false)} aria-label="Close the drawer"><Icon name="close" /></button>
            </header>
            {drawerTab === 'notes' ? <Notebook view={view} you={you} tableFade={tableFade} setTableFade={setTableFade} /> : view.log.length === 0 ? <p className="dim">Nothing yet. Opening cubes come first.</p> : (
              <ol className="log" reversed>
                {[...view.log].reverse().map((l, k) => (
                  <li key={view.log.length - k}><LogLine l={l} who={who} pick={(i) => { setSelected(i); bv.current?.focus(i); }} /></li>
                ))}
              </ol>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="sr-only" aria-live="polite">{view.log.at(-1) && logText(view.log.at(-1)!, who)}</div>
      <HowTo open={rules} onClose={() => setRules(false)} />
    </div>
  );
}

function ActionButton({ a, view, you, busy, run, children, className = '' }: {
  a: Action; view: PlayerView; you: number; busy: boolean; run: (a: Action) => void; children: React.ReactNode; className?: string;
}) {
  const why = illegal(view, you, a);
  return <button className={`btn ${className}`} disabled={busy || !!why} title={why ?? undefined} onClick={() => run(a)}>{children}</button>;
}

/** One line explaining why the selected space blocks your actions, so a disabled button is never a mystery. */
function Why({ view, you, selected }: { view: PlayerView; you: number; selected: number }) {
  const reasons = view.phase === 'play'
    ? [illegal(view, you, { type: 'search', space: selected }), ...view.players.map((_, t) => t === you ? null : illegal(view, you, { type: 'question', space: selected, target: t }))]
    : [illegal(view, you, { type: view.phase === 'disc' ? 'disc' : 'cube', space: selected })];
  const uniq = [...new Set(reasons.filter(Boolean))];
  return uniq.length ? <p className="why">{uniq.join(' ')}</p> : null;
}

function SpaceInfo({ view, i, myAllowed, onClose }: { view: PlayerView; i: number; myAllowed: boolean[] | null; onClose: () => void }) {
  const h = view.board.hexes[i];
  const m = view.marks[i];
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
      {(m.discs.length > 0 || m.cube !== null) && (
        <p className="pieces">
          {m.discs.map((p) => <span key={p} className="chip"><Piece kind="disc" p={p} /> {view.players[p]}: could be</span>)}
          {m.cube !== null && <span className="chip closed"><Piece kind="cube" p={m.cube} /> {view.players[m.cube]}: not here</span>}
        </p>
      )}
      {myAllowed && <p className={`verdict ${myAllowed[i] ? 'yes' : 'no'}`}>{myAllowed[i] ? 'Your clue allows the habitat here' : 'Your clue rules this space out'}</p>}
    </div>
  );
}

function LogLine({ l, who, pick }: { l: LogEntry; who: (p: number, object?: boolean) => string; pick: (i: number) => void }) {
  const space = l.t === 'skip' ? null : l.space;
  return (
    <div className={`log-line log-${l.t}`}>
      <Glyph p={l.p} size={18} />
      <span>{logText(l, who)}</span>
      {space !== null && (
        <button className="coord" onClick={() => pick(space)} aria-label={`Show ${spaceName(space)} on the map`}>{spaceName(space)}</button>
      )}
    </div>
  );
}

function Reveal({ view, onRestart, onLeave, who }: { view: PlayerView; onRestart?: () => void; onLeave: () => void; who: (p: number) => string }) {
  return (
    <div className="bezel reveal-card">
      <p className="reveal-title"><Glyph p={view.winner!} size={28} /> {who(view.winner!)} found the habitat</p>
      <p className="dim">{spaceName(view.habitat!)}: {describeSpace(view.board, view.habitat!).toLowerCase()}.</p>
      <ul className="reveal-clues">
        {view.players.map((name, p) => (
          <li key={p}><Glyph p={p} size={18} /> <b>{name}</b> <span>the habitat is <ClueText id={view.clues[p]!} /></span></li>
        ))}
      </ul>
      <div className="row">
        {onRestart && <button className="btn primary" onClick={onRestart}>New island, same players</button>}
        <button className="btn ghost" onClick={onLeave}>Back to the start</button>
      </div>
    </div>
  );
}

/** What each player's pieces say about their clue, worked out from the board alone. */
function Notebook({ view, you, tableFade, setTableFade }: { view: PlayerView; you: number | null; tableFade: boolean; setTableFade: (v: boolean) => void }) {
  const open = useMemo(() => (you !== null && view.clues[you] ? openHabitats(view, you) : null), [view, you]);
  return (
    <div className="notes">
      <p className="dim">Every disc and cube narrows down that player's clue. This page only reads pieces everyone can see.</p>
      {open && (
        <label className="hatch-toggle">
          <input type="checkbox" checked={tableFade} onChange={(e) => setTableFade(e.target.checked)} />
          <Icon name="pencil" size={15} /> Also fade spaces the table has ruled out ({open.filter(Boolean).length} left)
        </label>
      )}
      {view.players.map((name, p) => {
        if (p === you) return null;
        const list = suspects(view, p);
        return (
          <section key={p} className="note">
            <h3><Glyph p={p} size={18} /> {name} <span className="dim">{list.length === 1 ? 'one clue fits' : `${list.length} clues fit`}</span></h3>
            {list.length <= 10
              ? <ul>{list.map((id) => <li key={id}>The habitat is <ClueText id={id} /></li>)}</ul>
              : <p className="dim">Too many to list yet. Question them to narrow it down.</p>}
          </section>
        );
      })}
    </div>
  );
}
