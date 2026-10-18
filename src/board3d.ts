// The living island: one imperative Three.js scene that React feeds with board state.
// Ambient life (wind, water, cloud shadows, birds, fireflies, clouds) runs in the render loop and never touches React.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { type Board, type Terrain, COLS, ROWS, SPACES, colOf, rng, rowOf } from '../shared/board.ts';
import type { Space } from '../shared/engine.ts';
import { GLYPH_PATHS, PLAYERS, STRUCTURE_COLORS, TERRITORY_COLORS } from './pieces.tsx';

const SQ3 = Math.sqrt(3);
const CX = (1.5 * (COLS - 1)) / 2;
const CZ = (SQ3 * (ROWS - 0.5)) / 2;
// Base height per terrain; each tile adds a seeded jitter so the land steps and rolls.
const HEIGHT: Record<Terrain, number> = { water: 0.2, swamp: 0.28, desert: 0.38, forest: 0.46, mountain: 0.74 };
const JITTER: Record<Terrain, number> = { water: 0, swamp: 0.04, desert: 0.08, forest: 0.08, mountain: 0.2 };
const ROUGH: Record<Terrain, number> = { water: 0.7, swamp: 0.5, desert: 0.85, forest: 0.8, mountain: 0.65 };
// Each terrain blends across a ramp by low-frequency noise, so regions shift colour like real land.
const RAMP: Record<Terrain, string[]> = {
  forest: ['#138F55', '#22B865', '#62D25A', '#9BE35A'],
  desert: ['#FF6B57', '#FF8A3D', '#FFB23A', '#FFD25E'],
  water: ['#F7E7B4', '#FFF1C8'],
  mountain: ['#7E86C2', '#A596E6', '#C79BE0', '#E7A2C6'],
  swamp: ['#0F6E66', '#178A6E', '#2A9C70'],
};
const LAKE_RIM = '#33D6E4';
const NIGHT = new THREE.Color('#0B1F33'), CORAL = new THREE.Color('#FF7A59');
const BASE_W = 1.5 * (COLS - 1) + 2 + 3; // island plus a margin for the floating coordinate labels
const BASE_D = SQ3 * ROWS + 3;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Scratch objects reused every frame: the loop allocates nothing.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _col = new THREE.Color();

export function hexCenter(i: number) {
  const c = colOf(i), r = rowOf(i);
  return new THREE.Vector3(1.5 * c - CX, 0, SQ3 * (r + (c & 1) / 2) - CZ);
}

/** Smooth 2D value noise in [0, 1], deterministic per seed. */
function valueNoise(seed: number) {
  const k = (seed % 997) * 0.731;
  const h = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7 + k) * 43758.5453; return s - Math.floor(s); };
  return (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function ramp(stops: string[], t: number, out: THREE.Color) {
  const x = THREE.MathUtils.clamp(t, 0, 0.9999) * (stops.length - 1), k = Math.floor(x);
  return out.set(stops[k]).lerp(_col.set(stops[Math.min(k + 1, stops.length - 1)]), x - k);
}

// A flat hexagonal band (inset outline), optionally dashed, lying in the XZ plane.
function hexBand(outer: number, width: number, dash = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const corner = (k: number, r: number) => [Math.cos((k * Math.PI) / 3) * r, Math.sin((k * Math.PI) / 3) * r];
  for (let k = 0; k < 6; k++) {
    const [a, b] = dash === 1 ? [0, 1] : [0.18, 0.82];
    const lerp = (r: number, t: number) => {
      const [x0, z0] = corner(k, r), [x1, z1] = corner(k + 1, r);
      return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
    };
    const o0 = lerp(outer, a), o1 = lerp(outer, b), i0 = lerp(outer - width, a), i1 = lerp(outer - width, b);
    pos.push(o0[0], 0, o0[1], i0[0], 0, i0[1], o1[0], 0, o1[1], o1[0], 0, o1[1], i0[0], 0, i0[1], i1[0], 0, i1[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Hex disc in concentric rings, each ring its own colour (deep water in the middle, shallows at the rim). */
function hexRings(radii: number[], colors: string[]) {
  const pos: number[] = [], col: number[] = [];
  const cs = colors.map((c) => new THREE.Color(c));
  const pt = (k: number, r: number) => [Math.cos((k * Math.PI) / 3) * r, 0, Math.sin((k * Math.PI) / 3) * r];
  for (let k = 0; k < 6; k++) {
    pos.push(0, 0, 0, ...pt(k + 1, radii[0]), ...pt(k, radii[0]));
    col.push(...cs[0].toArray(), ...cs[1].toArray(), ...cs[1].toArray());
    for (let j = 1; j < radii.length; j++) {
      const r0 = radii[j - 1], r1 = radii[j], c0 = cs[j].toArray(), c1 = cs[j + 1].toArray();
      pos.push(...pt(k, r0), ...pt(k + 1, r0), ...pt(k, r1), ...pt(k + 1, r0), ...pt(k + 1, r1), ...pt(k, r1));
      col.push(...c0, ...c0, ...c1, ...c0, ...c1, ...c1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const radial = (inner: string, outer: string, size = 64) => canvasTexture(size, size, (ctx) => {
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
});

// A flat vertex colour per part, so several primitives merge into one instanced, flat-shaded prop.
function tint(geo: THREE.BufferGeometry, color: string) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) arr.set([c.r, c.g, c.b], k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
const merge = (...parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

/**
 * Beveled hex platform, base at y=0 and top at `height`. Vertex colours carry the lighting design:
 * a full-colour top, a brighter bevel that catches the sun, and sides that darken toward the base.
 */
function hexTile(height: number) {
  const shape = new THREE.Shape();
  for (let k = 0; k <= 6; k++) {
    const a = (k * Math.PI) / 3;
    if (k === 0) shape.moveTo(Math.cos(a) * 0.86, Math.sin(a) * 0.86);
    else shape.lineTo(Math.cos(a) * 0.86, Math.sin(a) * 0.86);
  }
  const bevel = 0.05;
  const g = new THREE.ExtrudeGeometry(shape, { depth: height - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.07, bevelSegments: 1, curveSegments: 1 })
    .rotateX(-Math.PI / 2).translate(0, bevel, 0);
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k += 3) {
    _a.fromBufferAttribute(p, k); _b.fromBufferAttribute(p, k + 1); _c.fromBufferAttribute(p, k + 2);
    const ny = _v.subVectors(_b, _a).cross(_s.subVectors(_c, _a)).normalize().y;
    for (let j = 0; j < 3; j++) {
      const y = p.getY(k + j) / height;
      const shade = ny > 0.95 ? 1 : ny > 0.15 ? 1.22 : ny < -0.95 ? 0.25 : 0.36 + 0.4 * y;
      col.set([shade, shade, shade], (k + j) * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function glyphTexture(p: number) {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = PLAYERS[p].color;
    ctx.fillRect(0, 0, 128, 128);
    // Cream glyph on a dark disc: players differ by shape at phone size, not by hue alone.
    ctx.translate(64, 64);
    ctx.scale(4.3, 4.3);
    ctx.translate(-12, -12);
    ctx.fillStyle = 'rgba(11,22,34,0.6)';
    ctx.beginPath();
    ctx.arc(12, 12, 13.2, 0, Math.PI * 2);
    ctx.fill();
    const path = new Path2D(GLYPH_PATHS[PLAYERS[p].glyph]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#0B1622';
    ctx.stroke(path);
    ctx.fillStyle = '#FFF8EA';
    ctx.fill(path);
  });
}

/**
 * Shared shader additions for world materials. Every surface gets a world-position varying and drifting
 * cloud shadows; foliage bends in gusts by local height with a per-instance phase; water gets drifting
 * glints. All driven by one time uniform, so nothing is rebuilt per frame.
 */
function living<T extends THREE.MeshStandardMaterial>(mat: T, time: { value: number }, opts: { sway?: number; water?: boolean } = {}) {
  const { sway = 0, water = false } = opts;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\nattribute float aDim;\nvarying float vDim;\nvarying vec3 vWP;\nvarying vec3 vLocal;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDim = aDim;
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        ${sway ? `
        float bend = max(position.y, 0.0) * ${sway.toFixed(3)};
        float gust = sin(uTime * 1.3 + ip.x * 0.9 + ip.z * 1.3) + 0.5 * sin(uTime * 2.9 + ip.z * 2.1 + ip.x) + 0.35 * sin(uTime * 0.37 + ip.x * 0.2);
        transformed.x += gust * bend;
        transformed.z += gust * bend * 0.6;` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWP = (modelMatrix * wp4).xyz;
        vLocal = vWP - ip;`);
    sh.fragmentShader = 'uniform float uTime;\nvarying float vDim;\nvarying vec3 vWP;\nvarying vec3 vLocal;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Cloud shadows drifting across the land.
        float cs = sin(vWP.x * 0.21 + uTime * 0.06 + sin(vWP.z * 0.17 - uTime * 0.03) * 2.0) * sin(vWP.z * 0.19 - uTime * 0.045 + sin(vWP.x * 0.13) * 1.5);
        diffuseColor.rgb *= 1.0 - 0.14 * smoothstep(0.2, 0.8, cs);
        // Ruled-out spaces sit under a pale drifting mist: they keep a hint of their terrain hue, lose their
        // contrast, and never turn grey or brown. Live spaces stay fully saturated by comparison.
        float mistN = 0.5 + 0.5 * sin(vWP.x * 0.9 + uTime * 0.25) * sin(vWP.z * 1.1 - uTime * 0.2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.71, 0.8) * (0.86 + 0.14 * mistN), vDim * 0.55);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.05, 0.07, 0.1) * vDim;
        ${water ? `
        vec2 wp = vWP.xz;
        float w1 = sin(wp.x * 3.1 + uTime * 0.9 + sin(wp.y * 1.9 + uTime * 0.5) * 1.8);
        float w2 = sin(wp.y * 3.7 - uTime * 0.7 + sin(wp.x * 2.2 - uTime * 0.35) * 1.4);
        float glint = smoothstep(0.74, 1.0, w1 * w2);
        totalEmissiveRadiance += (vec3(0.62, 1.0, 1.0) * glint * 0.5 + vec3(0.0, 0.05, 0.08)) * (1.0 - 0.75 * vDim);` : ''}`);
  };
  mat.customProgramCacheKey = () => `living${sway}${water}`;
  return mat;
}

/** Position an overlay anchor, flagging when the panel should open below or shift inward from an edge. */
export function place(el: HTMLElement, p: { x: number; y: number }, host: HTMLElement) {
  el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  el.dataset.below = p.y < 330 ? '1' : '';
  el.dataset.edge = p.x < 190 ? 'l' : p.x > host.clientWidth - 190 ? 'r' : '';
}

export interface BoardEvents {
  pick: (i: number) => void;
  hover: (i: number | null) => void;
}

interface Bird {
  g: THREE.Group;
  wings: [THREE.Object3D, THREE.Object3D];
  rx: number; rz: number; y: number; speed: number; phase: number; angle: number; cx: number; cz: number;
  state: 'fly' | 'land' | 'perch' | 'leave';
  t: number; timer: number; from: THREE.Vector3; to: THREE.Vector3;
}

type PropKind = 'pine' | 'pineLime' | 'broadleaf' | 'bush' | 'grass' | 'flower' | 'peak' | 'boulder' | 'mesa' | 'shard' | 'cactus'
  | 'reeds' | 'pool' | 'lily' | 'mangrove' | 'jetty' | 'ruin' | 'tent';

export class BoardView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  /** The home page's cinematic camera; the game itself always uses the orthographic one. */
  private eye: THREE.PerspectiveCamera | null = null;
  private eyeDist = 1;
  private controls: OrbitControls;
  private tileMeshes: THREE.InstancedMesh[] = [];
  private tileSlot: { mesh: THREE.InstancedMesh; n: number }[] = [];
  private tileColor: THREE.Color[] = [];
  private propSlots: { mesh: THREE.InstancedMesh; n: number }[][] = Array.from({ length: SPACES }, () => []);
  private dim: boolean[] = Array(SPACES).fill(false);
  private hovered: number | null = null;
  private selected: number | null = null;
  private flash = { i: -1, k: 0 };
  private hoverRing: THREE.Object3D;
  private selectRing: THREE.Group;
  private selectGlow: THREE.MeshBasicMaterial;
  private selectBeam: THREE.MeshBasicMaterial;
  private habitatFx = new THREE.Group();
  private pieces = new THREE.Group();
  private placed: { cube: boolean; discs: number }[] = Array.from({ length: SPACES }, () => ({ cube: false, discs: 0 }));
  private discGeo: THREE.CylinderGeometry;
  private cubeGeo: THREE.BoxGeometry;
  private pieceScale: number; // pieces grow on touch screens so their glyphs stay legible
  private playerMats: { side: THREE.Material; face: THREE.Material }[];
  private rimMat = new THREE.MeshBasicMaterial({ color: '#FFF8EA', side: THREE.BackSide });
  private shadowTex = radial('rgba(5,12,20,0.55)', 'rgba(5,12,20,0)');
  private dustTex = radial('rgba(255,250,235,0.9)', 'rgba(255,250,235,0)', 32);
  private maxRatio = 2;
  private beamTex: THREE.Texture;
  private disposers: (() => void)[] = [];
  private top: number[];
  private raf = 0;
  private time = { value: 0 };
  private clock = new THREE.Timer();
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private birds: Bird[] = [];
  private perches: THREE.Vector3[] = [];
  private clouds: { sp: THREE.Sprite; x: number; y: number; z: number; v: number; bob: number }[] = [];
  private flies!: THREE.Points;
  private stars!: THREE.Points;
  private islets: { o: THREE.Object3D; y: number; phase: number }[] = [];
  private ripples: { m: THREE.Mesh; t: number; life: number }[] = [];
  private waterSpots: THREE.Vector3[] = [];
  private falls: THREE.Texture[] = [];
  private followers = new Map<HTMLElement, number>();
  private insets = { top: 0, bottom: 0 };
  private host: HTMLElement;
  private board: Board;
  private on: BoardEvents;
  private showcase: boolean;
  /** Portrait screens turn the board a quarter so its long side runs down the screen (bigger spaces to tap). */
  rotated: boolean;

  constructor(host: HTMLElement, board: Board, on: BoardEvents, opts: { showcase?: boolean } = {}) {
    this.host = host;
    this.board = board;
    this.on = on;
    this.showcase = !!opts.showcase;
    this.rotated = !this.showcase && host.clientHeight > host.clientWidth;
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.maxRatio = Math.min(devicePixelRatio, coarse ? 1.75 : 2);
    this.renderer.setPixelRatio(this.maxRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r186 softens PCF with shadow.radius
    this.renderer.shadowMap.autoUpdate = false; // the island is static; pieces re-flag it when they land
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps hues saturated, unlike ACES
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.className = 'board-canvas';
    host.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.Fog('#0E2E40', this.showcase ? 34 : 40, this.showcase ? 115 : 210);
    if (this.showcase) this.eye = new THREE.PerspectiveCamera(30, 1, 0.5, 400);

    const r = rng(board.seed + 3);
    this.top = board.hexes.map((h) => HEIGHT[h.terrain] + r() * JITTER[h.terrain]);
    this.pieceScale = coarse || this.rotated ? 1.3 : 1;
    this.discGeo = new THREE.CylinderGeometry(0.3 * this.pieceScale, 0.3 * this.pieceScale, 0.09 * this.pieceScale, 28);
    this.cubeGeo = new THREE.BoxGeometry(0.36 * this.pieceScale, 0.36 * this.pieceScale, 0.36 * this.pieceScale);
    this.playerMats = PLAYERS.map((pl, p) => ({
      side: new THREE.MeshStandardMaterial({ color: pl.color, roughness: 0.25, metalness: 0.05 }),
      face: new THREE.MeshStandardMaterial({ map: glyphTexture(p), roughness: 0.25, metalness: 0.05 }),
    }));
    // A soft vertical fade shared by every light column (selection, question beam, habitat pillar).
    this.beamTex = canvasTexture(4, 128, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 128);
    });

    this.lights(coarse);
    this.island();
    this.terrain();
    this.water();
    this.decorate();
    this.waterfalls();
    this.territories();
    this.structures();
    if (!this.showcase) this.labels();
    this.atmosphere();
    if (this.showcase) this.archipelago();
    this.scene.add(this.pieces, this.habitatFx);

    // Hover: a luminous edge and a brighter tile. Selection: a cyan band edged in navy (reads on pale sand too),
    // a breathing glow and a short column of light.
    const band = (outer: number, width: number, color: string, opacity: number, additive = false) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const m = new THREE.Mesh(hexBand(outer, width), mat);
      m.renderOrder = 3;
      return m;
    };
    this.hoverRing = new THREE.Group().add(band(0.95, 0.07, '#CFFBFF', 0.9, true));
    const glow = band(1.14, 0.3, '#5CE1E6', 0.35, true);
    this.selectGlow = glow.material as THREE.MeshBasicMaterial;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 6, 1, true).translate(0, 0.7, 0),
      new THREE.MeshBasicMaterial({ color: '#5CE1E6', alphaMap: this.beamTex, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    beam.rotation.y = Math.PI / 6;
    beam.renderOrder = 3;
    this.selectBeam = beam.material as THREE.MeshBasicMaterial;
    this.selectRing = new THREE.Group().add(band(1.0, 0.045, '#0B1A2A', 0.85), band(0.96, 0.12, '#5CE1E6', 1), glow, beam);
    this.hoverRing.visible = this.selectRing.visible = false;
    this.scene.add(this.hoverRing, this.selectRing);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.12, minPolarAngle: 0.2, maxPolarAngle: 1.05, minZoom: 0.85, maxZoom: 3.2, zoomToCursor: true,
    });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.enabled = !this.showcase;
    this.controls.addEventListener('change', () => {
      const t = this.controls.target;
      const cx = THREE.MathUtils.clamp(t.x, -CX - 6, CX), cz = THREE.MathUtils.clamp(t.z, -CZ, CZ);
      if (cx !== t.x || cz !== t.z || t.y !== 0) {
        this.camera.position.add(_v.set(cx - t.x, -t.y, cz - t.z));
        t.set(cx, 0, cz);
      }
    });
    if (import.meta.env.DEV) (window as unknown as { __board: BoardView }).__board = this; // e2e picking checks
    this.renderer.shadowMap.needsUpdate = true;
    this.resetView();
    if (!this.showcase) this.pointer();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    // Pause the loop while the tab is hidden.
    const vis = () => { cancelAnimationFrame(this.raf); if (!document.hidden) this.loop(); };
    document.addEventListener('visibilitychange', vis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', vis));
    this.resize();
    if (reducedMotion()) {
      this.birds.forEach((b) => { b.g.visible = false; });
      this.tick(0, 6); // a composed still frame
    }
    this.loop();
  }

  // Warm low sun from the north-west, cool sky fill, a blue-green bounce from below the island.
  private lights(coarse: boolean) {
    this.hemi = new THREE.HemisphereLight('#D3ECFF', '#1C5560', 1.2);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#FFE0B0', 3.3);
    sun.position.set(-11, 17, -7);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = coarse ? 0.035 : 0.02;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#8FC8FF', 0.7);
    fill.position.set(10, 8, 12);
    this.scene.add(fill);
  }

  // The rock beneath each tile: deeper under the middle, so the board floats as one jagged island.
  private island() {
    const geo = new THREE.CylinderGeometry(0.97, 0.38, 1, 6, 3).rotateY(Math.PI / 6).translate(0, -0.5, 0).toNonIndexed();
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const topC = new THREE.Color('#5A6AA0'), midC = new THREE.Color('#2B3F6E'), botC = new THREE.Color('#0C1730');
    for (let k = 0; k < pos.count; k++) {
      const y = -pos.getY(k);
      _col.copy(topC).lerp(midC, Math.min(1, y * 3)).lerp(botC, Math.max(0, y - 0.33) * 1.4);
      cols.set(_col.toArray(), k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }), SPACES);
    const r = rng(this.board.seed + 9);
    for (let i = 0; i < SPACES; i++) {
      const p = hexCenter(i);
      const inner = 1 - Math.min(1, Math.hypot(p.x / (CX + 1), p.z / (CZ + 1)));
      mesh.setMatrixAt(i, _m.compose(p, _q.identity(), _s.set(1, 0.8 + inner * 3 + r() * 1.1, 1)));
    }
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // One instanced mesh per terrain; userData.spaces maps instance to space.
  private terrain() {
    const r = rng(this.board.seed + 1);
    const noise = valueNoise(this.board.seed + 4);
    for (const t of Object.keys(HEIGHT) as Terrain[]) {
      const spaces = this.board.hexes.flatMap((h, i) => (h.terrain === t ? [i] : []));
      const mesh = new THREE.InstancedMesh(hexTile(HEIGHT[t]),
        living(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROUGH[t], flatShading: true }), this.time), spaces.length);
      spaces.forEach((i, n) => {
        const p = hexCenter(i);
        mesh.setMatrixAt(n, _m.compose(p, _q.identity(), _s.set(1, this.top[i] / HEIGHT[t], 1)));
        const c = ramp(RAMP[t], noise(p.x * 0.16, p.z * 0.16) * 1.1 - 0.05 + (r() - 0.5) * 0.18, new THREE.Color());
        this.tileColor[i] = c;
        this.tileSlot[i] = { mesh, n };
        mesh.setColorAt(n, c);
      });
      mesh.userData.spaces = spaces;
      mesh.castShadow = mesh.receiveShadow = true;
      this.tileMeshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Neighbour across each edge direction (degrees) of space i: its index, or -1 off the board. */
  private across(i: number) {
    const c = hexCenter(i);
    return [30, 90, 150, 210, 270, 330].map((deg) => {
      const a = (deg * Math.PI) / 180;
      _v.set(c.x + Math.cos(a) * SQ3, 0, c.z + Math.sin(a) * SQ3);
      return { deg, j: this.board.hexes.findIndex((_, j) => hexCenter(j).distanceToSquared(_v) < 0.1) };
    });
  }

  // Lakes: a deep-to-shallow surface inside a sandy shore, joined to neighbouring lakes by short streams.
  private water() {
    const water = this.board.hexes.flatMap((h, i) => (h.terrain === 'water' ? [i] : []));
    const mat = living(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1 }), this.time, { water: true });
    const surface = new THREE.InstancedMesh(hexRings([0.3, 0.6, 0.8], ['#0757C2', '#0E8CD8', '#19B8E0', LAKE_RIM]), mat, water.length);
    const links: { m: THREE.Matrix4; ends: number[] }[] = [];
    water.forEach((i, n) => {
      const p = hexCenter(i).setY(this.top[i] + 0.01);
      surface.setMatrixAt(n, _m.makeTranslation(p));
      this.propSlots[i].push({ mesh: surface, n }); // the lake fades with its space
      this.waterSpots.push(p.clone());
      for (const { deg, j } of this.across(i)) {
        if (j <= i || this.board.hexes[j]?.terrain !== 'water') continue;
        const a = (deg * Math.PI) / 180;
        // Lakes share one water level, so the neck sits flush with both surfaces.
        links.push({ ends: [i, j], m: new THREE.Matrix4().compose(_v.set(p.x + Math.cos(a) * SQ3 / 2, p.y - 0.001, p.z + Math.sin(a) * SQ3 / 2), _q.setFromAxisAngle(_s.set(0, 1, 0), -a), _s.set(1, 1, 1)) });
      }
    });
    surface.receiveShadow = true;
    this.scene.add(surface);
    // Where three lakes meet, a small patch covers the tile corners so the water reads as one body.
    const corners = new Map<string, { at: THREE.Vector3; i: number }>();
    for (const i of water) {
      const near = this.across(i);
      for (let k = 0; k < 6; k++) {
        const a = near[k].j, b = near[(k + 1) % 6].j; // the edges at 30+60k and 90+60k share the corner at 60+60k
        if (a < 0 || b < 0 || this.board.hexes[a].terrain !== 'water' || this.board.hexes[b].terrain !== 'water') continue;
        const ang = ((60 + 60 * k) * Math.PI) / 180, c = hexCenter(i);
        const at = new THREE.Vector3(c.x + Math.cos(ang), this.top[i] + 0.009, c.z + Math.sin(ang));
        corners.set(`${at.x.toFixed(2)},${at.z.toFixed(2)}`, { at, i });
      }
    }
    if (corners.size) {
      const patch = new THREE.InstancedMesh(tint(new THREE.CircleGeometry(0.34, 6).rotateX(-Math.PI / 2), LAKE_RIM), mat, corners.size);
      [...corners.values()].forEach(({ at, i }, k) => {
        patch.setMatrixAt(k, _m.makeTranslation(at));
        this.propSlots[i].push({ mesh: patch, n: k });
      });
      patch.receiveShadow = true;
      this.scene.add(patch);
    }
    if (links.length) {
      // A faint light seam along each shared edge keeps every water space distinguishable inside a merged lake.
      const seam = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#D8FBFF', transparent: true, opacity: 0.5, depthWrite: false, fog: false }), links.length);
      links.forEach(({ m }, k) => seam.setMatrixAt(k, _m.copy(m).multiply(new THREE.Matrix4().makeTranslation(0, 0.006, 0))));
      seam.renderOrder = 2;
      this.scene.add(seam);
      // A neck exactly as wide as a lake edge and the colour of its rim: neighbouring lakes read as one body of water.
      const stream = new THREE.InstancedMesh(tint(new THREE.PlaneGeometry(SQ3 - 2 * 0.8 * Math.cos(Math.PI / 6) + 0.02, 0.8).rotateX(-Math.PI / 2), LAKE_RIM), mat, links.length);
      links.forEach(({ m, ends }, k) => {
        stream.setMatrixAt(k, m);
        this.propSlots[ends[0]].push({ mesh: stream, n: k }); // fades with its first lake
      });
      stream.receiveShadow = true;
      this.scene.add(stream);
    }
    // Rings that spread where a fish rises or a drop lands: a small pool, reused.
    const ringMat = new THREE.MeshBasicMaterial({ color: '#E9FFFF', transparent: true, opacity: 0, depthWrite: false, fog: false });
    const ringGeo = new THREE.RingGeometry(0.14, 0.17, 24).rotateX(-Math.PI / 2);
    for (let k = 0; k < (water.length ? 5 : 0); k++) {
      const m = new THREE.Mesh(ringGeo, ringMat.clone());
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
      this.ripples.push({ m, t: 0, life: -Math.random() * 4 });
    }
  }

  // Terrain props, deterministic per seed. Rim slots only (the centre is kept for pieces); tall props take the
  // slots facing away from the camera, and never stand on a structure's space.
  private decorate() {
    const cone = (r: number, h: number, y: number, c: string, seg = 6) => tint(new THREE.ConeGeometry(r, h, seg).translate(0, y + h / 2, 0), c);
    const trunk = (h: number, c = '#7A4E2D') => tint(new THREE.CylinderGeometry(0.024, 0.036, h, 5).translate(0, h / 2, 0), c);
    const make = (kind: PropKind, c: string): THREE.BufferGeometry => {
      switch (kind) {
        case 'pine': return merge(trunk(0.1), cone(0.18, 0.24, 0.07, '#0B7A50'), cone(0.14, 0.22, 0.2, '#14A35F'), cone(0.09, 0.18, 0.33, '#35C574'));
        case 'pineLime': return merge(trunk(0.1), cone(0.17, 0.22, 0.07, '#3FA44A'), cone(0.13, 0.2, 0.19, '#6CC94A'), cone(0.08, 0.16, 0.31, '#A6E35A'));
        case 'broadleaf': return merge(trunk(0.16, '#8A5A34'),
          tint(new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.27, 0), '#62C94E'), tint(new THREE.IcosahedronGeometry(0.11, 0).translate(0.08, 0.36, 0.03), '#9BE35A'));
        case 'bush': return tint(new THREE.IcosahedronGeometry(0.1, 0).scale(1, 0.75, 1).translate(0, 0.06, 0), '#7FDB55');
        case 'grass': return merge(...[[-0.03, 0, 0.1], [0.02, 0.02, 0.13], [0.01, -0.03, 0.09]].map(([x, z, h]) =>
          tint(new THREE.ConeGeometry(0.018, h, 3).translate(x, h / 2, z), '#86E06A')));
        case 'flower': return merge(
          tint(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 3).translate(0, 0.035, 0), '#3FAF4F'),
          tint(new THREE.OctahedronGeometry(0.032).translate(0, 0.08, 0), c));
        case 'peak': return merge(
          cone(0.3, 0.56, 0, c, 5), cone(0.115, 0.17, 0.39, '#FFFFFF', 5),
          tint(new THREE.ConeGeometry(0.18, 0.34, 5).translate(0.2, 0.17, 0.08), new THREE.Color(c).multiplyScalar(0.86).getStyle()));
        case 'boulder': return tint(new THREE.IcosahedronGeometry(0.1, 0).scale(1.1, 0.8, 1).translate(0, 0.05, 0), c);
        case 'mesa': return merge(
          tint(new THREE.CylinderGeometry(0.2, 0.24, 0.14, 6).translate(0, 0.07, 0), '#FF6B57'),
          tint(new THREE.CylinderGeometry(0.17, 0.2, 0.1, 6).translate(0, 0.19, 0), '#FF9A3D'),
          tint(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 6).translate(0, 0.2525, 0), '#FFD25E'));
        case 'shard': return tint(new THREE.DodecahedronGeometry(0.085, 0).scale(1, 1.4, 0.8).translate(0, 0.06, 0), c);
        case 'cactus': return merge(
          tint(new THREE.BoxGeometry(0.06, 0.26, 0.06).translate(0, 0.13, 0), '#2FA65A'),
          tint(new THREE.BoxGeometry(0.05, 0.1, 0.05).translate(0.07, 0.16, 0), '#2FA65A'),
          tint(new THREE.BoxGeometry(0.05, 0.08, 0.05).translate(-0.07, 0.12, 0), '#2FA65A'),
          tint(new THREE.BoxGeometry(0.1, 0.03, 0.03).translate(0, 0.1, 0), '#2FA65A'),
          tint(new THREE.OctahedronGeometry(0.02).translate(0, 0.27, 0), '#FF8FC0'));
        case 'reeds': return merge(
          ...[[-0.04, 0, 0.3], [0.03, 0.03, 0.36], [0.01, -0.04, 0.26], [0.05, -0.01, 0.22]].flatMap(([x, z, h]) => [
            tint(new THREE.CylinderGeometry(0.01, 0.014, h, 4).translate(x, h / 2, z), '#6BBF3A'),
            tint(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 5).translate(x, h + 0.02, z), '#8A5A34'),
          ]));
        case 'pool': return hexRings([0.08, 0.15], ['#0B5E66', '#178A8A', '#47F0D2']).translate(0, 0.006, 0);
        case 'lily': return merge(
          tint(new THREE.CylinderGeometry(0.1, 0.1, 0.014, 8).translate(0, 0.007, 0), '#5FCB55'),
          tint(new THREE.OctahedronGeometry(0.028).translate(0.02, 0.03, 0), '#FF8FC0'));
        case 'mangrove': return merge(
          trunk(0.18, '#3E4A36'),
          tint(new THREE.CylinderGeometry(0.008, 0.02, 0.1, 3).rotateZ(0.6).translate(0.04, 0.04, 0), '#3E4A36'),
          tint(new THREE.CylinderGeometry(0.008, 0.02, 0.1, 3).rotateZ(-0.6).translate(-0.04, 0.04, 0), '#3E4A36'),
          tint(new THREE.IcosahedronGeometry(0.17, 0).scale(1, 0.55, 1).translate(0, 0.24, 0), '#1E8C5A'),
          tint(new THREE.IcosahedronGeometry(0.11, 0).scale(1, 0.6, 1).translate(0.06, 0.31, 0.02), '#3CB46E'));
        case 'jetty': return merge(
          tint(new THREE.BoxGeometry(0.34, 0.025, 0.14).translate(0.17, 0.04, 0), '#D69A5C'),
          tint(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 4).translate(0.3, 0.0, 0.06), '#8A5A34'),
          tint(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 4).translate(0.3, 0.0, -0.06), '#8A5A34'));
        case 'ruin': return merge(
          tint(new THREE.CylinderGeometry(0.04, 0.045, 0.22, 6).translate(-0.08, 0.11, 0), '#D9D2EA'),
          tint(new THREE.CylinderGeometry(0.04, 0.045, 0.13, 6).translate(0.08, 0.065, 0.02), '#C9C1DE'),
          tint(new THREE.BoxGeometry(0.12, 0.05, 0.07).rotateZ(0.3).translate(0.02, 0.03, 0.12), '#B9B0D2'));
        case 'tent': return merge(
          tint(new THREE.ConeGeometry(0.14, 0.16, 4).rotateY(Math.PI / 4).translate(0, 0.08, 0), '#FF7A59'),
          tint(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 3).translate(0.16, 0.13, 0), '#F4F1E8'),
          tint(new THREE.PlaneGeometry(0.08, 0.05).translate(0.2, 0.235, 0), '#FFC857'));
      }
    };
    const TALL = new Set<PropKind>(['pine', 'pineLime', 'broadleaf', 'peak', 'cactus', 'reeds', 'mesa', 'mangrove', 'tent']);
    const SWAY: Partial<Record<PropKind, number>> = { pine: 0.07, pineLime: 0.07, broadleaf: 0.06, bush: 0.1, grass: 0.35, flower: 0.4, reeds: 0.16, mangrove: 0.05 };
    const FLOWERS = ['#FF8FC0', '#FFE15A', '#FFFFFF', '#C9A2FF', '#FF7A59'];
    const PEAKS = ['#B9A8F0', '#D9A6E6', '#F0A9C9', '#8F9BCB'];
    const ROCKS: Record<string, string[]> = { mountain: ['#C7B8F5', '#F2A6C8', '#9AA6D0'], desert: ['#FF6B4A', '#FF9F1C', '#FFC857'] };
    const r = rng(this.board.seed + 2);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const placed = new Map<string, { kind: PropKind; color: string; list: { m: THREE.Matrix4; i: number }[] }>();
    const contacts: THREE.Matrix4[] = [];
    const cam = this.rotated ? [-1, 0] : [0, 1]; // horizontal direction toward the camera
    const add = (kind: PropKind, color: string, m: THREE.Matrix4, i: number) => {
      const key = `${kind}${color}`;
      if (!placed.has(key)) placed.set(key, { kind, color, list: [] });
      placed.get(key)!.list.push({ m, i });
    };

    this.board.hexes.forEach((h, i) => {
      const slots = [30, 90, 150, 270, 330, 210].filter((a) => !(a === 210 && h.structure));
      const back = (a: number) => -(Math.cos((a * Math.PI) / 180) * cam[0] + Math.sin((a * Math.PI) / 180) * cam[1]);
      const at = (deg: number, rad: number) => {
        const a = (deg * Math.PI) / 180;
        return hexCenter(i).add(_v.set(Math.cos(a) * rad, this.top[i], Math.sin(a) * rad));
      };
      // Small props go anywhere outside the piece circle without taking a slot.
      const scatter = (kind: PropKind, scale: number, color = '') => {
        const pos = at(r() * 360, 0.46 + r() * 0.3);
        add(kind, color, new THREE.Matrix4().compose(pos, _q.setFromAxisAngle(_s.set(0, 1, 0), r() * 6.28), _s.setScalar(scale)), i);
      };
      const put = (kind: PropKind, scale: number, color = '', rad = 0.58 + r() * 0.12, contact = true) => {
        if ((TALL.has(kind) && h.structure) || !slots.length) return;
        const k = TALL.has(kind)
          ? slots.reduce((best, a, j) => (back(a) + r() * 0.3 > back(slots[best]) ? j : best), 0)
          : Math.floor(r() * slots.length);
        const slot = slots.splice(k, 1)[0];
        const pos = at(slot + (r() - 0.5) * 24, rad);
        const m = new THREE.Matrix4().compose(pos, _q.setFromAxisAngle(_s.set(0, 1, 0), r() * Math.PI * 2), _s.set(scale, scale * (0.9 + r() * 0.25), scale));
        add(kind, color, m, i);
        if (contact) contacts.push(new THREE.Matrix4().compose(pos.clone().setY(pos.y + 0.003), _q.identity(), _s.set(scale, 1, scale)));
        if (kind === 'pine' || kind === 'pineLime' || kind === 'peak') this.perches.push(pos.clone().setY(pos.y + (kind === 'peak' ? 0.56 : 0.48) * scale));
      };
      const n = r(); // density roll: not every tile is decorated alike
      switch (h.terrain) {
        case 'forest': {
          const lime = this.tileColor[i].g > 0.75; // lighter glades grow lime pines and broadleaf trees
          for (let k = 0; k < 3 + Math.floor(r() * 2); k++) put(lime && r() > 0.4 ? (r() > 0.5 ? 'broadleaf' : 'pineLime') : 'pine', 0.85 + r() * 0.5);
          if (n > 0.35) put('bush', 0.8 + r() * 0.5);
          for (let k = 0; k < 2; k++) scatter('grass', 0.9 + r() * 0.5);
          if (n > 0.5) scatter('flower', 1.5, pick(FLOWERS));
          if (n > 0.75) scatter('flower', 1.3, pick(FLOWERS));
          if (this.showcase && n < 0.06 && !h.structure) put('tent', 1.4);
          break;
        }
        case 'mountain':
          if (n > 0.25) put('peak', 1.15 + r() * 0.35, pick(PEAKS), 0.6);
          if (n > 0.55) put('peak', 0.8 + r() * 0.3, pick(PEAKS), 0.62);
          if (n < 0.12 && !h.structure) put('ruin', 1.4);
          put('boulder', 0.9 + r() * 0.5, pick(ROCKS.mountain));
          break;
        case 'desert':
          if (n > 0.55) put('mesa', 1 + r() * 0.4);
          put('shard', 1.3 + r() * 0.6, pick(ROCKS.desert));
          if (n < 0.5) put('cactus', 1.2 + r() * 0.3);
          if (n > 0.3) scatter('shard', 0.7 + r() * 0.4, pick(ROCKS.desert));
          if (n < 0.08 && !h.structure) put('ruin', 1.3);
          break;
        case 'swamp':
          put('reeds', 1.3 + r() * 0.4);
          put('pool', 1.5 + r() * 0.5, '', 0.5, false);
          if (n > 0.45) put('mangrove', 1 + r() * 0.35);
          if (n > 0.6) put('reeds', 1 + r() * 0.3);
          if (n < 0.4) scatter('lily', 0.8);
          break;
        case 'water': {
          if (n > 0.55) put('lily', 1.1 + r() * 0.4, '', 0.5, false);
          // A small jetty from the shore toward the middle, on some lakes that touch land.
          const land = this.across(i).filter(({ j }) => j >= 0 && this.board.hexes[j].terrain !== 'water');
          if (land.length && n < 0.25) {
            const a = (land[Math.floor(r() * land.length)].deg * Math.PI) / 180;
            const pos = hexCenter(i).add(_v.set(Math.cos(a) * 0.5, this.top[i], Math.sin(a) * 0.5));
            add('jetty', '', new THREE.Matrix4().compose(pos, _q.setFromAxisAngle(_s.set(0, 1, 0), -a), _s.set(1, 1, 1)), i);
          }
          break;
        }
      }
    });

    const still = living(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 }), this.time);
    const wet = living(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, emissive: '#0A3A3A' }), this.time);
    const windy = new Map<number, THREE.MeshStandardMaterial>();
    const r2 = rng(this.board.seed + 6);
    for (const { kind, color, list } of placed.values()) {
      const s = SWAY[kind];
      if (s && !windy.has(s)) windy.set(s, living(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }), this.time, { sway: s }));
      const mesh = new THREE.InstancedMesh(make(kind, color || '#FFFFFF'), kind === 'pool' ? wet : s ? windy.get(s)! : still, list.length);
      list.forEach(({ m, i }, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, _col.setRGB(1, 1, 1).offsetHSL(0, 0, (r2() - 0.5) * 0.08));
        this.propSlots[i].push({ mesh, n: k });
      });
      mesh.castShadow = !['pool', 'lily', 'flower', 'grass'].includes(kind);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Baked contact pools: the shadow map alone leaves a light seam under small props.
    const contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }), contacts.length);
    contacts.forEach((m, k) => contact.setMatrixAt(k, m));
    contact.renderOrder = 1;
    this.scene.add(contact);
  }

  // Lakes on the rim spill off the island as waterfalls (a scrolling ribbon down the rock) with mist below.
  private waterfalls() {
    const tex = canvasTexture(64, 256, (ctx) => {
      for (let x = 0; x < 64; x += 4) {
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        const a = 0.35 + ((x * 37) % 11) / 20;
        g.addColorStop(0, `rgba(225,255,255,${a})`);
        g.addColorStop(0.5, `rgba(120,230,240,${a * 0.75})`);
        g.addColorStop(1, `rgba(120,230,240,${a * 0.55})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, (x * 53) % 64, 3, 256);
      }
    });
    tex.wrapT = THREE.RepeatWrapping;
    const fade = canvasTexture(4, 64, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.7, '#888');
      g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 64);
    });
    fade.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaMap: fade, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mist = new THREE.SpriteMaterial({ map: radial('rgba(220,255,255,0.7)', 'rgba(220,255,255,0)'), transparent: true, depthWrite: false, opacity: 0.6 });
    this.falls.push(tex);
    // Every lake on the rim spills over each open edge. Curtains are a little wider than an edge, so falls from
    // neighbouring rim lakes overlap into one continuous sheet; a short spillway carries the lake to the lip.
    // The lip: a trapezoid that carries the lake from its surface edge to the tile's outer edge, brightening to
    // foam where it tips over. In local space x points out of the edge.
    const lip = new THREE.BufferGeometry();
    const IN = 0.8 * Math.cos(Math.PI / 6), OUT = 0.93 * Math.cos(Math.PI / 6) + 0.006;
    lip.setAttribute('position', new THREE.Float32BufferAttribute([IN - 0.01, 0, -0.41, IN - 0.01, 0, 0.41, OUT, 0, 0.475, IN - 0.01, 0, -0.41, OUT, 0, 0.475, OUT, 0, -0.475], 3));
    const rim = new THREE.Color(LAKE_RIM), foam = new THREE.Color('#C8FAFF');
    lip.setAttribute('color', new THREE.Float32BufferAttribute([...rim.toArray(), ...rim.toArray(), ...foam.toArray(), ...rim.toArray(), ...foam.toArray(), ...foam.toArray()], 3));
    lip.computeVertexNormals();
    const edges: { i: number; a: number }[] = [];
    for (let i = 0; i < SPACES; i++) {
      if (this.board.hexes[i].terrain !== 'water') continue;
      for (const { deg, j } of this.across(i)) if (j < 0) edges.push({ i, a: (deg * Math.PI) / 180 });
    }
    if (!edges.length) return;
    const spill = new THREE.InstancedMesh(lip, living(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide }), this.time, { water: true }), edges.length);
    // Curtains hang flush from the edge and are a touch wider than it, so neighbouring falls overlap into one sheet.
    const curtain = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.08, 3.2).translate(0, -1.6, 0), mat, edges.length);
    edges.forEach(({ i, a }, k) => {
      const c = hexCenter(i), y = this.top[i] + 0.01;
      spill.setMatrixAt(k, _m.compose(_v.set(c.x, y - 0.001, c.z), _q.setFromAxisAngle(_s.set(0, 1, 0), -a), _s.set(1, 1, 1)));
      this.propSlots[i].push({ mesh: spill, n: k });
      curtain.setMatrixAt(k, _m.compose(_v.set(c.x + Math.cos(a) * (OUT + 0.004), y, c.z + Math.sin(a) * (OUT + 0.004)), _q.setFromAxisAngle(_s.set(0, 1, 0), -a + Math.PI / 2), _s.set(1, 1, 1)));
      const puff = new THREE.Sprite(mist);
      puff.position.set(c.x + Math.cos(a) * 1.2, y - 2.9, c.z + Math.sin(a) * 1.2);
      puff.scale.setScalar(1.8);
      this.scene.add(puff);
    });
    curtain.renderOrder = 1;
    this.scene.add(spill, curtain);
  }

  // Bear: a solid ivory band. Cougar: a dashed rose band. Shape tells them apart without colour; a soft navy
  // underlay keeps both readable on pale sand and bright grass alike.
  private territories() {
    for (const animal of ['bear', 'cougar'] as const) {
      const spaces = this.board.hexes.flatMap((h, i) => (h.animal === animal ? [i] : []));
      const dashed = animal === 'cougar' ? 0 : 1;
      const color = animal === 'bear' ? '#FFF6E0' : TERRITORY_COLORS.cougar;
      for (const [geo, c, opacity, lift] of [[hexBand(0.875, 0.15, dashed), '#0B1A2A', 0.5, 0.004], [hexBand(0.85, 0.085, dashed), color, 1, 0.006]] as const) {
        const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity === 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }), spaces.length);
        spaces.forEach((i, n) => mesh.setMatrixAt(n, _m.makeTranslation(hexCenter(i).setY(this.top[i] + lift))));
        mesh.renderOrder = 1;
        this.scene.add(mesh);
      }
    }
  }

  private structures() {
    const stone = new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8).translate(0, 0.36, 0);
    const hut = new THREE.BoxGeometry(0.32, 0.22, 0.26).translate(0, 0.16, 0);
    // A gabled roof: a triangular prism that overhangs the walls on every side.
    const gable = new THREE.Shape([new THREE.Vector2(-0.21, 0), new THREE.Vector2(0.21, 0), new THREE.Vector2(0, 0.17)]);
    const roof = new THREE.ExtrudeGeometry(gable, { depth: 0.36, bevelEnabled: false }).translate(0, 0.27, -0.18);
    const door = new THREE.BoxGeometry(0.08, 0.12, 0.01).translate(0.06, 0.11, 0.131);
    const chimney = new THREE.BoxGeometry(0.05, 0.12, 0.05).translate(-0.09, 0.4, 0.06);
    const doorMat = new THREE.MeshStandardMaterial({ color: '#2A3550', roughness: 0.8 });
    const plinthMat = new THREE.MeshStandardMaterial({ color: '#FFF4DE', roughness: 0.6, flatShading: true });
    const mats = new Map<string, THREE.Material[]>();
    this.board.hexes.forEach((h, i) => {
      if (!h.structure) return;
      const key = h.structure.color;
      if (!mats.has(key)) {
        mats.set(key, [
          new THREE.MeshStandardMaterial({ color: STRUCTURE_COLORS[key], roughness: key === 'black' ? 0.18 : 0.3, metalness: key === 'black' ? 0.35 : 0, flatShading: true }),
          // The roof carries the structure's colour too, a shade darker: colour is a clue term and must read from above.
          new THREE.MeshStandardMaterial({ color: new THREE.Color(STRUCTURE_COLORS[key]).multiplyScalar(0.8), roughness: 0.45, flatShading: true }),
        ]);
      }
      const [mat, roofMat] = mats.get(key)!;
      const g = new THREE.Group();
      // An ivory plinth lifts every structure off same-coloured ground (a green stone on forest still reads).
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.05, h.structure.kind === 'stone' ? 8 : 4), plinthMat);
      plinth.position.y = 0.025;
      if (h.structure.kind === 'stone') g.add(new THREE.Mesh(stone, mat), plinth);
      else g.add(new THREE.Mesh(hut, mat), new THREE.Mesh(roof, roofMat), new THREE.Mesh(door, doorMat), new THREE.Mesh(chimney, roofMat), plinth);
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      g.scale.setScalar(1.35);
      const a = (210 * Math.PI) / 180;
      g.position.copy(hexCenter(i)).add(_v.set(Math.cos(a) * 0.48, this.top[i], Math.sin(a) * 0.48));
      this.scene.add(g);
    });
  }

  // Column letters and row numbers float beside the island, upright for the current camera.
  private labels() {
    const px = 80;
    const tex = canvasTexture(Math.round(BASE_W * px), Math.round(BASE_D * px), (ctx) => {
      ctx.font = `600 ${px * 0.4}px Figtree, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(243,240,230,0.82)';
      ctx.lineJoin = 'round';
      const put = (s: string, x: number, z: number) => {
        ctx.save();
        ctx.translate((x + BASE_W / 2) * px, (z + BASE_D / 2) * px);
        if (this.rotated) ctx.rotate(Math.PI / 2);
        ctx.lineWidth = px * 0.12; // a dark halo keeps the letters readable over clouds and pale props
        ctx.strokeStyle = 'rgba(5,13,24,0.8)';
        ctx.strokeText(s, 0, 0);
        ctx.fillText(s, 0, 0);
        ctx.restore();
      };
      for (let c = 0; c < COLS; c++) {
        put(String.fromCharCode(65 + c), hexCenter(c).x, -CZ - 1.45);
        put(String.fromCharCode(65 + c), hexCenter(c).x, CZ + 1.45);
      }
      for (let r = 0; r < ROWS; r++) {
        put(String(r + 1), -CX - 1.7, hexCenter(r * COLS).z);
        put(String(r + 1), CX + 1.7, hexCenter(r * COLS + COLS - 1).z);
      }
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(BASE_W, BASE_D).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    plane.position.y = -0.02;
    plane.renderOrder = 4; // drawn last: coordinates stay readable over clouds and rim props
    this.scene.add(plane);
  }

  // Soft clouds below and around the island, a glow beneath it, stars far below, fireflies, and birds.
  private atmosphere() {
    const r = rng(this.board.seed + 11);
    const cloudTex = canvasTexture(256, 128, (ctx) => {
      for (const [x, y, rad, a] of [[128, 78, 50, 1], [80, 84, 38, 0.95], [178, 86, 36, 0.95], [104, 58, 34, 0.9], [150, 60, 30, 0.9], [44, 92, 22, 0.8], [214, 94, 22, 0.8]]) {
        const g = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.6, `rgba(236,246,255,${a * 0.8})`);
        g.addColorStop(1, 'rgba(210,232,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 128);
      }
    });
    const n = this.showcase ? 22 : 14;
    for (let k = 0; k < n; k++) {
      // Most clouds drift below the island's surface: where they overlap it, the island hides them.
      const high = this.showcase && k % 4 === 0;
      const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: !high, opacity: high ? 0.22 + r() * 0.15 : 0.55 + r() * 0.35, color: new THREE.Color('#E6F1FF').lerp(new THREE.Color('#9BC4E8'), r()) });
      const sp = new THREE.Sprite(mat);
      const ang = r() * Math.PI * 2, rad = (high ? 16 : 7) + r() * 16;
      const s = (high ? 4 : 5) + r() * 5;
      sp.scale.set(s * 2, s, 1);
      this.scene.add(sp);
      this.clouds.push({ sp, x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, y: high ? 3 + r() * 3 : -3.5 - r() * 6, v: 0.15 + r() * 0.25, bob: r() * 10 });
    }

    // A pool of light under the island sells the float; stars glitter in the deep below.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(70, 70).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radial('rgba(60,200,190,0.55)', 'rgba(30,80,140,0)', 128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.position.y = -12;
    this.scene.add(glow);
    const sp = new Float32Array(420 * 3), sc = new Float32Array(420 * 3);
    for (let k = 0; k < 420; k++) {
      sp.set([(r() - 0.5) * 160, -16 - r() * 30, (r() - 0.5) * 140], k * 3);
      sc.set([1, 1, 1], k * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.scene.add(this.stars);

    // Fireflies and pollen: drawn toward swamp and forest, flickering out of step.
    const home = this.board.hexes.flatMap((h, i) => (h.terrain === 'swamp' || h.terrain === 'forest' ? [i] : []));
    const fp = new Float32Array(110 * 3), fc = new Float32Array(110 * 3);
    for (let k = 0; k < 110; k++) {
      const i = home.length ? home[Math.floor(r() * home.length)] : Math.floor(r() * SPACES);
      const c = hexCenter(i);
      fp.set([c.x + (r() - 0.5) * 1.6, this.top[i] + 0.25 + r() * 1.2, c.z + (r() - 0.5) * 1.6], k * 3);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    this.flies = new THREE.Points(fg, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32) }));
    this.flies.userData.base = fp.slice();
    this.scene.add(this.flies);

    // Birds: a body and two wings, ivory so they read over both terrain and night sky.
    const mat = new THREE.MeshStandardMaterial({ color: '#FBF7EC', flatShading: true, roughness: 0.6, side: THREE.DoubleSide });
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.05, 0, 0, 0.06, 0.26, 0.02, -0.02], 3));
    wing.computeVertexNormals();
    const body = new THREE.ConeGeometry(0.035, 0.18, 4).rotateX(Math.PI / 2);
    for (let k = 0; k < (this.showcase ? 10 : 7); k++) {
      const g = new THREE.Group();
      const left = new THREE.Mesh(wing, mat), right = new THREE.Mesh(wing, mat);
      right.scale.x = -1;
      g.add(new THREE.Mesh(body, mat), left, right);
      g.scale.setScalar(1.4 + r() * 0.5);
      this.scene.add(g);
      this.birds.push({
        g, wings: [left, right], rx: 4 + r() * 8, rz: 3 + r() * 6, y: 1.6 + r() * 2.6, speed: (0.07 + r() * 0.1) * (r() > 0.5 ? 1 : -1),
        cx: (r() - 0.5) * 6, cz: (r() - 0.5) * 5,
        phase: r() * 10, angle: r() * Math.PI * 2, state: 'fly', t: 0, timer: 5 + r() * 22, from: new THREE.Vector3(), to: new THREE.Vector3(),
      });
    }
  }

  // Home page only: small floating islets at several depths around the main island.
  private archipelago() {
    const rock = new THREE.CylinderGeometry(1, 0.15, 2.4, 6, 2).translate(0, -1.2, 0).toNonIndexed();
    const p = rock.attributes.position, cols = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) cols.set(_col.set('#5A6AA0').lerp(new THREE.Color('#0C1730'), -p.getY(k) / 2.4).toArray(), k * 3);
    rock.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    rock.deleteAttribute('uv');
    const variants = [
      merge(rock, tint(new THREE.CylinderGeometry(1.05, 1.05, 0.22, 6).translate(0, 0.11, 0), '#22B865'),
        tint(new THREE.ConeGeometry(0.28, 0.6, 6).translate(-0.3, 0.52, 0.1), '#0B7A50'), tint(new THREE.ConeGeometry(0.22, 0.5, 6).translate(0.25, 0.47, -0.2), '#35C574'),
        tint(new THREE.ConeGeometry(0.18, 0.4, 6).translate(0.35, 0.42, 0.35), '#14A35F')),
      merge(rock, tint(new THREE.CylinderGeometry(1.05, 1.05, 0.22, 6).translate(0, 0.11, 0), '#A596E6'),
        tint(new THREE.ConeGeometry(0.6, 1.1, 5).translate(0, 0.77, 0), '#D9A6E6'), tint(new THREE.ConeGeometry(0.22, 0.32, 5).translate(0, 1.2, 0), '#FFFFFF')),
      merge(rock, tint(new THREE.CylinderGeometry(1.05, 1.05, 0.22, 6).translate(0, 0.11, 0), '#F7E7B4'),
        tint(new THREE.CylinderGeometry(0.75, 0.75, 0.04, 6).translate(0, 0.23, 0), '#1CC6E4'), tint(new THREE.ConeGeometry(0.15, 0.35, 6).translate(0.6, 0.4, 0.3), '#14A35F')),
      merge(rock, tint(new THREE.CylinderGeometry(1.05, 1.05, 0.22, 6).translate(0, 0.11, 0), '#FFB23A'),
        tint(new THREE.CylinderGeometry(0.4, 0.5, 0.35, 6).translate(0.1, 0.39, 0), '#FF6B57'), tint(new THREE.CylinderGeometry(0.36, 0.4, 0.2, 6).translate(0.1, 0.66, 0), '#FF9A3D')),
    ];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
    const r = rng(this.board.seed + 13);
    const spots = [[-19, -1, -14, 1.5], [17, -2.5, -15, 1.2], [-24, 1.5, 8, 1.1], [21, 0.5, 9, 1.6], [-6, 3, -22, 1], [8, -4, 20, 1.3], [-14, -5, 17, 0.9], [27, 2.5, -4, 0.8]];
    spots.forEach(([x, y, z, s], k) => {
      const o = new THREE.Mesh(variants[k % variants.length], mat);
      o.position.set(x, y, z);
      o.scale.setScalar(s);
      o.rotation.y = r() * 6.28;
      o.castShadow = true;
      this.scene.add(o);
      this.islets.push({ o, y, phase: r() * 10 });
    });
  }

  private flyPos(b: Bird, angle: number, out: THREE.Vector3) {
    return out.set(b.cx + Math.cos(angle) * b.rx, b.y + Math.sin(angle * 2.3 + b.phase) * 0.5, b.cz + Math.sin(angle) * b.rz);
  }

  private tick(dt: number, t: number) {
    // Ambient: wind, water and sky keep moving even while players think.
    this.time.value = t;
    this.sun.intensity = 3.3 + Math.sin(t * 0.07) * 0.25;
    for (const f of this.falls) f.offset.y = t * 0.9; // positive scrolls the ribbon downward
    this.selectGlow.opacity = 0.25 + Math.sin(t * 3) * 0.12;
    this.selectBeam.opacity = 0.28 + Math.sin(t * 3) * 0.08;

    for (const c of this.clouds) {
      // Drift along the screen's horizontal, which is world z on a turned board.
      c.x += c.v * dt;
      if (c.x > 34) c.x = -34;
      const [x, z] = this.rotated ? [c.z, c.x] : [c.x, c.z];
      c.sp.position.set(x, c.y + Math.sin(t * 0.2 + c.bob) * 0.2, z);
    }
    for (const isl of this.islets) {
      isl.o.position.y = isl.y + Math.sin(t * 0.35 + isl.phase) * 0.35;
      isl.o.rotation.y += dt * 0.01;
    }

    const sc = this.stars.geometry.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < sc.count; k += 3) { const v = 0.55 + 0.45 * Math.sin(t * (0.8 + (k % 7) * 0.3) + k); sc.setXYZ(k, v, v, v * 1.05); }
    sc.needsUpdate = true;

    const fp = this.flies.geometry.attributes.position as THREE.BufferAttribute, fc = this.flies.geometry.attributes.color as THREE.BufferAttribute;
    const base = this.flies.userData.base as Float32Array;
    for (let k = 0; k < fp.count; k++) {
      fp.setXYZ(k, base[k * 3] + Math.sin(t * 0.3 + k) * 0.5, base[k * 3 + 1] + Math.sin(t * 0.5 + k * 1.7) * 0.25, base[k * 3 + 2] + Math.cos(t * 0.27 + k * 0.7) * 0.5);
      const glow = Math.max(0, Math.sin(t * (0.9 + (k % 5) * 0.23) + k * 2.1)) ** 3;
      fc.setXYZ(k, glow * 0.85, glow, glow * 0.45);
    }
    fp.needsUpdate = fc.needsUpdate = true;

    for (const rp of this.ripples) {
      rp.life += dt;
      if (rp.life < 0) continue;
      if (!rp.m.visible && this.waterSpots.length) {
        const w = this.waterSpots[Math.floor(Math.random() * this.waterSpots.length)];
        const a = Math.random() * 6.28, d = Math.random() * 0.45;
        rp.m.position.set(w.x + Math.cos(a) * d, w.y + 0.004, w.z + Math.sin(a) * d);
        rp.m.visible = true;
        rp.life = 0;
      }
      const k = rp.life / 2.2;
      rp.m.scale.setScalar(0.6 + k * 2.2);
      (rp.m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
      if (k >= 1) { rp.m.visible = false; rp.life = -2 - Math.random() * 6; }
    }

    const pos = _a, ahead = _b, mid = _c;
    for (const b of this.birds) {
      b.timer -= dt;
      if (b.state === 'fly') {
        b.angle += b.speed * dt * (1 + 0.3 * Math.sin(t * 0.4 + b.phase));
        this.flyPos(b, b.angle, pos);
        this.flyPos(b, b.angle + Math.sign(b.speed) * 0.05, ahead);
        b.g.position.copy(pos);
        b.g.lookAt(ahead);
        // Flap in bursts, glide between them.
        const flap = Math.sin(t * 0.6 + b.phase) > -0.2 ? Math.sin(t * 14 + b.phase) * 0.7 : 0.15;
        b.wings[0].rotation.z = flap;
        b.wings[1].rotation.z = -flap;
        if (b.timer < 0 && this.perches.length) {
          b.state = 'land';
          b.t = 0;
          b.from.copy(pos);
          b.to.copy(this.perches[Math.floor(Math.random() * this.perches.length)]);
        }
      } else if (b.state === 'land' || b.state === 'leave') {
        b.t += dt / 2.4;
        const k = Math.min(1, b.t), e = b.state === 'land' ? 1 - (1 - k) ** 3 : k * k;
        // Quadratic arc, high over the midpoint, so landings swoop rather than slide.
        mid.copy(b.from).lerp(b.to, 0.5).setY(Math.max(b.from.y, b.to.y) + 1.2);
        pos.copy(b.from).lerp(mid, e).lerp(_v.copy(mid).lerp(b.to, e), e);
        b.g.position.copy(pos);
        b.g.lookAt(ahead.copy(b.to).setY(pos.y));
        const flap = Math.sin(t * 16) * (b.state === 'land' ? 0.9 * (1 - k) + 0.1 : 0.8);
        b.wings[0].rotation.z = flap;
        b.wings[1].rotation.z = -flap;
        if (k >= 1) {
          if (b.state === 'land') { b.state = 'perch'; b.timer = 4 + Math.random() * 7; }
          else { b.state = 'fly'; b.timer = 15 + Math.random() * 25; }
        }
      } else {
        b.wings[0].rotation.z = 0.05;
        b.wings[1].rotation.z = -0.05;
        b.g.position.y = b.to.y + Math.abs(Math.sin(t * 2 + b.phase)) * 0.02;
        if (b.timer < 0) {
          b.state = 'leave';
          b.t = 0;
          b.from.copy(b.g.position);
          b.angle += 0.6 * Math.sign(b.speed);
          this.flyPos(b, b.angle, b.to);
        }
      }
    }
  }

  private placeFollowers() {
    for (const [el, i] of this.followers) place(el, this.screenOf(i), this.host);
  }

  private loop() {
    const still = reducedMotion();
    let spent = 0, frames = 0;
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      this.clock.update();
      const raw = this.clock.getDelta(), dt = Math.min(raw, 1 / 20);
      // Adaptive resolution: if frames average slower than 40fps over two seconds, render fewer pixels.
      // shortcut: only ever steps down (no flapping), so a one-off stall costs some sharpness for the session.
      if (raw < 0.25) { spent += raw; frames++; }
      if (spent > 2) {
        const ratio = this.renderer.getPixelRatio();
        if (spent / frames > 1 / 40 && ratio > 1) { this.renderer.setPixelRatio(Math.max(1, ratio - 0.25)); this.resize(); }
        spent = frames = 0;
      }
      const t = this.clock.getElapsed();
      if (!still) this.tick(dt, t);
      if (this.eye) {
        // The home camera drifts slowly around the island.
        const a = still ? 0.2 : 0.2 + Math.sin(t * 0.045) * 0.32;
        const tg = this.controls.target;
        this.eye.position.set(tg.x + Math.sin(a) * this.eyeDist, this.eyeDist * 0.5, tg.z + Math.cos(a) * this.eyeDist);
        this.eye.lookAt(tg);
      } else this.controls.update();
      this.placeFollowers(); // overlay anchors (the action popover) follow their space as the camera moves
      this.renderer.render(this.scene, this.eye ?? this.camera);
    };
    frame();
  }

  private pointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    // Only the tiles are hit-tested: props, pieces and effects never block a pick.
    const hit = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const h = ray.intersectObjects(this.tileMeshes, false)[0];
      return h ? (h.object.userData.spaces as number[])[h.instanceId!] : null;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      // A tap, not a pan: under 7px of travel.
      if (e.isPrimary && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7) {
        const i = hit(e);
        if (i !== null) this.on.pick(i);
      }
      down = null;
    };
    // Hover picking runs at most once per frame, however fast the mouse reports.
    let pending: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || down) return;
      if (!pending) requestAnimationFrame(() => {
        const ev = pending!;
        pending = null;
        const i = hit(ev);
        if (i !== this.hovered) this.setHover(i);
        el.style.cursor = i === null ? 'grab' : 'pointer';
      });
      pending = e;
    };
    const onLeave = () => this.setHover(null);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
  }

  private setHover(i: number | null) {
    const was = this.hovered;
    this.hovered = i;
    this.setRing(this.hoverRing, i);
    if (was !== null) this.paint(was);
    if (i !== null) this.paint(i);
    this.on.hover(i);
  }

  /** Restyle one space: ruled out sinks into dusk (in the shader), hover and selection brighten, a failed search flushes coral. */
  private paint(i: number) {
    const slot = this.tileSlot[i];
    if (!slot) return;
    const lift = (i === this.hovered ? 0.2 : 0) + (i === this.selected ? 0.12 : 0);
    _col.copy(this.tileColor[i]).multiplyScalar(1 + lift);
    if (i === this.flash.i) _col.lerp(CORAL, this.flash.k * 0.7);
    slot.mesh.setColorAt(slot.n, _col);
    slot.mesh.instanceColor!.needsUpdate = true;
    const d = this.dim[i] ? 1 : 0;
    for (const { mesh, n } of [slot, ...this.propSlots[i]]) {
      let a = mesh.geometry.getAttribute('aDim') as THREE.InstancedBufferAttribute | undefined;
      if (!a) mesh.geometry.setAttribute('aDim', a = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count), 1));
      a.setX(n, d);
      a.needsUpdate = true;
    }
  }

  private setRing(ring: THREE.Object3D, i: number | null, lift = 0.014) {
    ring.visible = i !== null;
    if (i !== null) ring.position.copy(hexCenter(i)).setY(this.top[i] + lift);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    if (this.eye) {
      // Home: the camera backs off on narrow screens so the whole island still fits.
      this.eye.aspect = w / h;
      this.eye.updateProjectionMatrix();
      this.eyeDist = w > h * 1.2 ? 40 : 40 * Math.min(1.55, (h / w) * 0.8);
      Object.assign(this.scene.fog!, { near: this.eyeDist * 0.9, far: this.eyeDist * 3 });
      return;
    }
    // Game view leaves room for the floating nav and the bottom HUD.
    const [across, down] = this.rotated ? [BASE_D, BASE_W * 0.95] : [BASE_W, BASE_D * 0.84];
    const band = Math.max(1, h - this.insets.top - this.insets.bottom);
    const half = Math.max((down / 2) * (h / band), across / 2 / (w / h)) * 1.02;
    // Centre the island in the band rather than the whole canvas.
    this.camera.setViewOffset(w, h, 0, (this.insets.bottom - this.insets.top) / 2, w, h);
    Object.assign(this.camera, { left: -half * (w / h), right: half * (w / h), top: half, bottom: -half, near: 0.1, far: 300 });
    this.camera.updateProjectionMatrix();
  }

  resetView() {
    // Home: island set right of centre on wide screens, leaving room for the title; on a portrait screen the
    // camera aims below the island, lifting it into the top half above the title.
    const wide = this.host.clientWidth > this.host.clientHeight * 1.2;
    this.controls.target.set(this.showcase && wide ? -6 : 0, this.showcase ? -1 : 0, this.showcase ? (wide ? 0 : 8) : this.rotated ? 0 : 0.6);
    const az = this.rotated ? -Math.PI / 2 : 0;
    Object.assign(this.controls, { minAzimuthAngle: az - 0.65, maxAzimuthAngle: az + 0.65 });
    if (this.rotated) this.camera.position.set(-16, 38, 0);
    else this.camera.position.set(this.controls.target.x, 30, 31);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Screen space the HUD covers at the top and bottom; the island is fitted into what is left. */
  setInsets(top: number, bottom: number) {
    this.insets = { top, bottom };
    this.resize();
  }

  /** Screen position (CSS px, relative to the canvas) of a point just above space i. */
  screenOf(i: number) {
    const p = hexCenter(i).setY(this.top[i] + 0.35).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.host.clientWidth, y: ((1 - p.y) / 2) * this.host.clientHeight };
  }

  /** Keep an element positioned over space i (null stops following). */
  follow(el: HTMLElement, i: number | null) {
    if (i === null) this.followers.delete(el);
    else this.followers.set(el, i);
  }

  /** Bring a space into view (keyboard navigation). */
  focus(i: number) {
    const p = hexCenter(i);
    const t = this.controls.target;
    const half = (this.camera.top - this.camera.bottom) / 2 / this.camera.zoom;
    if (Math.abs(p.x - t.x) > half * 0.6 || Math.abs(p.z - t.z) > half * 0.6) {
      const d = new THREE.Vector3(p.x - t.x, 0, p.z - t.z);
      t.add(d);
      this.camera.position.add(d);
    }
  }

  setSelected(i: number | null) {
    const was = this.selected;
    this.selected = i;
    if (was !== null) this.paint(was);
    if (i !== null) this.paint(i);
    this.setRing(this.selectRing, i, 0.02);
    gsap.killTweensOf(this.selectRing.scale);
    if (i !== null && !reducedMotion()) {
      gsap.fromTo(this.selectRing.scale, { x: 1.3, y: 0.2, z: 1.3 }, { x: 1, z: 1, duration: 0.4, ease: 'expo.out' });
      gsap.to(this.selectRing.scale, { y: 1, duration: 0.5, ease: 'expo.out', delay: 0.05 });
    }
  }

  /** Spaces your clue rules out sink into dusk; the board stays readable but the live spaces glow by contrast. */
  setHatch(mask: boolean[] | null) {
    for (let i = 0; i < SPACES; i++) {
      const on = !!mask?.[i];
      if (on === this.dim[i]) continue;
      this.dim[i] = on;
      this.paint(i);
    }
  }

  /** Brief board feedback for an event at space i. */
  pulse(i: number, kind: 'question' | 'fail') {
    if (reducedMotion()) return;
    const at = hexCenter(i).setY(this.top[i] + 0.02);
    const cleanup = (o: THREE.Mesh) => () => { this.scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); };
    if (kind === 'question') {
      // Focus: a ring closes on the space, then a cyan column of light rises and fades as the answer lands.
      const ring = new THREE.Mesh(hexBand(1, 0.08), new THREE.MeshBasicMaterial({ color: '#CFFBFF', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending }));
      ring.position.copy(at);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.8, 4, 6, 1, true).translate(0, 2, 0),
        new THREE.MeshBasicMaterial({ color: '#5CE1E6', alphaMap: this.beamTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      beam.position.copy(at);
      this.scene.add(ring, beam);
      gsap.timeline({ onComplete: cleanup(ring) })
        .fromTo(ring.scale, { x: 1.8, z: 1.8 }, { x: 0.9, z: 0.9, duration: 0.35, ease: 'expo.out' })
        .to(ring.material, { opacity: 0, duration: 0.35 }, 0.25);
      gsap.timeline({ onComplete: cleanup(beam) })
        .fromTo(beam.scale, { y: 0.05 }, { y: 1, duration: 0.4, ease: 'expo.out' }, 0.1)
        .to(beam.material, { opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.35);
    } else {
      // Failed search: a coral shockwave, a coral flush through the tile, and a shiver through its pieces.
      const ring = new THREE.Mesh(hexBand(0.95, 0.12), new THREE.MeshBasicMaterial({ color: '#FF7A59', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      ring.position.copy(at);
      this.scene.add(ring);
      gsap.timeline({ onComplete: cleanup(ring) })
        .fromTo(ring.scale, { x: 0.8, z: 0.8 }, { x: 2.6, z: 2.6, duration: 0.9, ease: 'expo.out' }, 0)
        .to(ring.material, { opacity: 0, duration: 0.9, ease: 'power2.out' }, 0);
      gsap.killTweensOf(this.flash);
      this.flash.i = i;
      gsap.fromTo(this.flash, { k: 1 }, { k: 0, duration: 1.1, ease: 'power2.out', onUpdate: () => this.paint(i), onComplete: () => { this.flash.i = -1; this.paint(i); } });
      const c = hexCenter(i);
      for (const piece of this.pieces.children) {
        if (Math.abs(piece.position.x - c.x) < 0.1 && Math.abs(piece.position.z - c.z) < 0.1) {
          gsap.fromTo(piece.rotation, { z: 0.22 }, { z: 0, duration: 0.7, ease: 'elastic.out(1.2, 0.3)' });
        }
      }
    }
  }

  /** Habitat reveal: the world dims, a gold pillar rises, sparks burst, the sun warms and the camera settles on it. */
  setHabitat(i: number | null) {
    this.habitatFx.clear();
    if (i === null) return;
    const at = hexCenter(i).setY(this.top[i] + 0.02);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.86, 8, 6, 1, true).translate(0, 4, 0),
      new THREE.MeshBasicMaterial({ color: '#FFC857', alphaMap: this.beamTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    const ring = new THREE.Mesh(hexBand(1.04, 0.2), new THREE.MeshBasicMaterial({ color: '#FFC857', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const light = new THREE.PointLight('#FFC857', 6, 7, 1.6);
    light.position.copy(at).setY(at.y + 1.2);
    pillar.position.copy(at);
    ring.position.copy(at);
    this.habitatFx.add(pillar, ring, light);
    if (reducedMotion()) return;
    const n = 160, pos = new Float32Array(n * 3), vel: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      pos.set([at.x, at.y + 0.3, at.z], k * 3);
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      vel.push(new THREE.Vector3(Math.cos(a) * sp * 0.6, 2 + Math.random() * 3.5, Math.sin(a) * sp * 0.6));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: '#FFE08A', size: 5, sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.habitatFx.add(sparks);
    const state = { t: 0 };
    gsap.to(state, {
      t: 2, duration: 2, ease: 'none',
      onUpdate: () => {
        for (let k = 0; k < n; k++) {
          const v = vel[k], t = state.t;
          pos.set([at.x + v.x * t, at.y + 0.3 + v.y * t - 2.6 * t * t, at.z + v.z * t], k * 3);
        }
        g.attributes.position.needsUpdate = true;
        (sparks.material as THREE.PointsMaterial).opacity = 1 - state.t / 2;
      },
      onComplete: () => { this.habitatFx.remove(sparks); g.dispose(); (sparks.material as THREE.Material).dispose(); },
    });
    gsap.fromTo(pillar.scale, { x: 0.2, z: 0.2, y: 0 }, { x: 1, z: 1, y: 1, duration: 1.1, ease: 'expo.out' });
    gsap.fromTo(ring.scale, { x: 2.6, z: 2.6 }, { x: 1, z: 1, duration: 1.1, ease: 'expo.out' });
    gsap.fromTo(light, { intensity: 0 }, { intensity: 6, duration: 1.2 });
    gsap.to(this.sun.color, { r: 1, g: 0.72, b: 0.45, duration: 1.5 });
    gsap.to(this.hemi, { intensity: 0.65, duration: 1.5 });
    // The camera settles on the habitat.
    const d = new THREE.Vector3(at.x - this.controls.target.x, 0, at.z - this.controls.target.z);
    gsap.to(this.controls.target, { x: `+=${d.x}`, z: `+=${d.z}`, duration: 1.4, ease: 'power3.inOut' });
    gsap.to(this.camera.position, { x: `+=${d.x}`, z: `+=${d.z}`, duration: 1.4, ease: 'power3.inOut' });
    gsap.to(this.camera, { zoom: 1.6, duration: 1.4, ease: 'power3.inOut', onUpdate: () => this.camera.updateProjectionMatrix() });
  }

  /** Swoop toward the island (the home-to-game transition). */
  dive(duration = 0.8) {
    if (reducedMotion()) return;
    if (this.eye) gsap.to(this, { eyeDist: this.eyeDist * 0.35, duration, ease: 'power3.in' });
    else gsap.to(this.camera, { zoom: 2.4, duration, ease: 'power3.in', onUpdate: () => this.camera.updateProjectionMatrix() });
  }

  /** Add any pieces not yet on the board. Pieces are never removed during a game. */
  setMarks(marks: Space[], animate: boolean) {
    const anim = animate && !reducedMotion();
    marks.forEach((m, i) => {
      const done = this.placed[i];
      const base = hexCenter(i).setY(this.top[i]);
      if ((m.discs.length || m.cube !== null) && !done.discs && !done.cube) {
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
        shadow.position.copy(base).setY(base.y + 0.008);
        shadow.renderOrder = 1;
        this.scene.add(shadow);
      }
      for (let k = done.discs; k < m.discs.length; k++) {
        const mat = this.playerMats[m.discs[k]];
        const disc = new THREE.Mesh(this.discGeo, [mat.side, mat.face, mat.side]);
        disc.position.copy(base).setY(base.y + (0.045 + k * 0.095) * this.pieceScale);
        disc.rotation.y = -Math.PI / 2;
        this.addPiece(disc, anim, i, k * 0.08);
      }
      done.discs = m.discs.length;
      if (m.cube !== null && !done.cube) {
        const cube = new THREE.Mesh(this.cubeGeo, this.playerMats[m.cube].face);
        cube.position.copy(base).setY(base.y + (m.discs.length * 0.095 + 0.18) * this.pieceScale);
        this.addPiece(cube, anim, i, 0);
        done.cube = true;
      }
    });
  }

  private addPiece(mesh: THREE.Mesh, anim: boolean, i: number, delay: number) {
    mesh.castShadow = true;
    // An ivory rim (a back-face hull) keeps every piece legible against every terrain.
    const rim = new THREE.Mesh(mesh.geometry, this.rimMat);
    rim.scale.setScalar(1.12);
    mesh.add(rim);
    this.pieces.add(mesh);
    this.renderer.shadowMap.needsUpdate = true;
    if (!anim) return;
    const y = mesh.position.y;
    // Drop, bounce, then a small squash as it settles.
    gsap.timeline({ delay, onComplete: () => { this.renderer.shadowMap.needsUpdate = true; } })
      .fromTo(mesh.position, { y: y + 2.6 }, { y, duration: 0.6, ease: 'bounce.out' })
      .call(() => this.dust(i), [], 0.4)
      .fromTo(mesh.scale, { y: 0.8, x: 1.08, z: 1.08 }, { y: 1, x: 1, z: 1, duration: 0.35, ease: 'back.out(3)' }, 0.42);
    const ripple = new THREE.Mesh(hexBand(0.9, 0.06), new THREE.MeshBasicMaterial({ color: '#CFFBFF', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ripple.position.copy(hexCenter(i)).setY(this.top[i] + 0.02);
    this.scene.add(ripple);
    gsap.timeline({ delay: delay + 0.32, onComplete: () => { this.scene.remove(ripple); ripple.geometry.dispose(); (ripple.material as THREE.Material).dispose(); } })
      .fromTo(ripple.scale, { x: 0.7, z: 0.7 }, { x: 1.35, z: 1.35, duration: 0.7, ease: 'expo.out' }, 0)
      .to(ripple.material, { opacity: 0, duration: 0.7, ease: 'power2.out' }, 0);
  }

  /** A small puff of dust kicked up where a piece lands. */
  private dust(i: number) {
    const n = 16, at = hexCenter(i).setY(this.top[i] + 0.06);
    const pos = new Float32Array(n * 3), vel: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4, sp = 0.6 + Math.random() * 0.6;
      vel.push(Math.cos(a) * sp, 0.25 + Math.random() * 0.35, Math.sin(a) * sp);
      pos.set([at.x, at.y, at.z], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: this.dustTex, size: 10, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
    const pts = new THREE.Points(g, mat);
    this.scene.add(pts);
    const st = { t: 0 };
    gsap.to(st, {
      t: 1, duration: 0.7, ease: 'power2.out',
      onUpdate: () => {
        for (let k = 0; k < n; k++) pos.set([at.x + vel[k * 3] * st.t * 0.6, at.y + vel[k * 3 + 1] * st.t * (1 - st.t) * 0.8, at.z + vel[k * 3 + 2] * st.t * 0.6], k * 3);
        g.attributes.position.needsUpdate = true;
        mat.opacity = 0.75 * (1 - st.t);
      },
      onComplete: () => { this.scene.remove(pts); g.dispose(); mat.dispose(); },
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.controls.dispose();
    this.followers.clear();
    gsap.killTweensOf([this, this.flash, this.selectRing.scale, this.camera, this.camera.position, this.controls.target, this.sun.color, this.hemi]);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      for (const mat of [mesh.material].flat()) {
        if (!mat) continue;
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        (mat as THREE.MeshStandardMaterial).alphaMap?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
