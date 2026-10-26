// Flat SVG map: used when WebGL is unavailable. Same interface as the 3D BoardView.
import { type Board, COLS, ROWS, colOf, rowOf } from '../shared/board.ts';
import type { Space } from '../shared/engine.ts';
import { type BoardEvents, BoardView, place } from './board3d.ts';
import { GLYPH_PATHS, PLAYERS, STRUCTURE_COLORS, TERRAIN_COLORS, TERRAIN_ICON, TERRITORY_COLORS, WATER_COLOR } from './pieces.tsx';

export type BoardLike = Pick<BoardView, 'rotated' | 'setMarks' | 'setSelected' | 'setHatch' | 'setHabitat' | 'resetView' | 'focus' | 'follow' | 'pulse' | 'dive' | 'setInsets' | 'dispose'>;

export function createBoard(host: HTMLElement, board: Board, on: BoardEvents, opts: { showcase?: boolean } = {}): BoardLike {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('no WebGL2');
    return new BoardView(host, board, on, opts);
  } catch {
    return new FlatBoard(host, board, on);
  }
}

const NS = 'http://www.w3.org/2000/svg';
export const R = 30;
export const SQ3 = Math.sqrt(3);
export const center = (i: number) => [R * (1.5 * colOf(i) + 1) + 30, R * SQ3 * (rowOf(i) + (colOf(i) & 1) / 2 + 0.5) + 30] as [number, number];
export const hexPoints = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => `${(cx + r * Math.cos((k * Math.PI) / 3)).toFixed(1)},${(cy + r * Math.sin((k * Math.PI) / 3)).toFixed(1)}`).join(' ');

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

class FlatBoard implements BoardLike {
  private svg: SVGSVGElement;
  private pieces: SVGGElement;
  private hatch: SVGGElement;
  private select: SVGPolygonElement;
  private habitat: SVGPolygonElement;
  private host: HTMLElement;
  private followers = new Map<HTMLElement, number>();
  private raf = 0;
  rotated = false;

  constructor(host: HTMLElement, board: Board, on: BoardEvents) {
    this.host = host;
    const w = R * (1.5 * (COLS - 1) + 2) + 60, h = R * SQ3 * (ROWS + 0.5) + 60;
    this.svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'board-flat', preserveAspectRatio: 'xMidYMid meet' });
    const defs = el('defs', {}, this.svg);
    const pat = el('pattern', { id: 'hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 3, height: 8, fill: 'rgba(6,16,28,.6)' }, pat);

    for (let c = 0; c < COLS; c++) el('text', { x: center(c)[0], y: 18, class: 'flat-label' }, this.svg).textContent = String.fromCharCode(65 + c);
    for (let r = 0; r < ROWS; r++) el('text', { x: 12, y: center(r * COLS)[1] + 5, class: 'flat-label' }, this.svg).textContent = String(r + 1);

    board.hexes.forEach((hx, i) => {
      const [cx, cy] = center(i);
      const g = el('g', { class: 'flat-hex' }, this.svg);
      el('polygon', { points: hexPoints(cx, cy, R - 1.5), fill: hx.terrain === 'water' ? WATER_COLOR : TERRAIN_COLORS[hx.terrain] }, g);
      el('path', {
        d: TERRAIN_ICON[hx.terrain], transform: `translate(${cx + 4} ${cy - 22}) scale(.55)`,
        fill: hx.terrain === 'swamp' ? 'none' : 'rgba(6,16,28,.4)', stroke: hx.terrain === 'swamp' ? 'rgba(255,255,255,.5)' : 'none', 'stroke-width': 2,
      }, g);
      if (hx.animal) {
        const dash: Record<string, string> = hx.animal === 'cougar' ? { 'stroke-dasharray': '7 5' } : {};
        el('polygon', { points: hexPoints(cx, cy, R - 5), fill: 'none', stroke: '#FFF6E0', 'stroke-width': 5.5, ...dash }, g);
        el('polygon', { points: hexPoints(cx, cy, R - 5), fill: 'none', stroke: TERRITORY_COLORS[hx.animal], 'stroke-width': 3, ...dash }, g);
      }
      if (hx.structure) {
        const [sx, sy] = [cx - 13, cy - 8];
        const shape = hx.structure.kind === 'stone'
          ? el('polygon', { points: Array.from({ length: 8 }, (_, k) => `${sx + 7 * Math.cos(((k + 0.5) * Math.PI) / 4)},${sy + 7 * Math.sin(((k + 0.5) * Math.PI) / 4)}`).join(' ') }, g)
          : el('polygon', { points: `${sx},${sy - 8} ${sx + 8},${sy + 6} ${sx - 8},${sy + 6}` }, g);
        shape.setAttribute('fill', STRUCTURE_COLORS[hx.structure.color]);
        shape.setAttribute('stroke', hx.structure.color === 'black' ? '#F4F1E8' : '#06101C');
        shape.setAttribute('stroke-width', '1.5');
      }
      g.addEventListener('click', () => on.pick(i));
    });

    this.hatch = el('g', { 'pointer-events': 'none' }, this.svg);
    this.pieces = el('g', { 'pointer-events': 'none' }, this.svg);
    this.select = el('polygon', { points: '', fill: 'none', stroke: '#5CE1E6', 'stroke-width': 5, 'pointer-events': 'none' }, this.svg);
    this.habitat = el('polygon', { points: '', fill: 'none', stroke: '#FFC857', 'stroke-width': 7, 'pointer-events': 'none' }, this.svg);
    host.appendChild(this.svg);
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const m = this.svg.getScreenCTM(), hb = this.host.getBoundingClientRect();
      if (!m) return;
      for (const [elx, i] of this.followers) {
        const [x, y] = center(i);
        place(elx, { x: m.a * x + m.e - hb.left, y: m.d * (y - R * 0.6) + m.f - hb.top }, this.host);
      }
    };
    tick();
  }

  setMarks(marks: Space[]) {
    this.pieces.replaceChildren();
    marks.forEach((m, i) => {
      const [cx, cy] = center(i);
      const piece = (p: number, x: number, y: number, cube: boolean) => {
        const g = el('g', { transform: `translate(${x} ${y})` }, this.pieces);
        if (cube) el('rect', { x: -8, y: -8, width: 16, height: 16, rx: 2, fill: PLAYERS[p].color, stroke: '#06101C', 'stroke-width': 1.5 }, g);
        else el('circle', { r: 8, fill: PLAYERS[p].color, stroke: '#FFF8EA', 'stroke-width': 1.5 }, g);
        el('path', { d: GLYPH_PATHS[PLAYERS[p].glyph], transform: 'scale(.45) translate(-12 -12)', fill: '#FFF8EA' }, g);
      };
      m.discs.forEach((p, k) => piece(p, cx - 6 + (k % 3) * 9, cy + 4 + Math.floor(k / 3) * 9, false));
      if (m.cube !== null) piece(m.cube, cx + 12, cy - 4, true);
    });
  }

  setSelected(i: number | null) { this.select.setAttribute('points', i === null ? '' : hexPoints(...center(i), R - 2)); }
  setHatch(mask: boolean[] | null) {
    this.hatch.replaceChildren();
    mask?.forEach((on, i) => { if (on) el('polygon', { points: hexPoints(...center(i), R - 1.5), fill: 'url(#hatch)' }, this.hatch); });
  }
  setHabitat(i: number | null) { this.habitat.setAttribute('points', i === null ? '' : hexPoints(...center(i), R + 1)); }
  follow(elx: HTMLElement, i: number | null) { if (i === null) this.followers.delete(elx); else this.followers.set(elx, i); }
  resetView() {}
  setInsets() {}
  pulse() {}
  dive() {}
  focus(i: number) {
    const [x, y] = center(i);
    const scale = this.svg.getBoundingClientRect().width / this.svg.viewBox.baseVal.width;
    this.host.scrollTo({ left: x * scale - this.host.clientWidth / 2, top: y * scale - this.host.clientHeight / 2 });
  }
  dispose() { cancelAnimationFrame(this.raf); this.svg.remove(); }
}
