// Player identity (colour + glyph), the world palette, and the drawn icon set.
// Glyph paths are shared by SVG and the 3D piece decals.
import type { Terrain } from '../shared/board.ts';

export const PLAYERS = [
  { color: '#E5484D', glyph: 'circle' },
  { color: '#3E63DD', glyph: 'triangle' },
  { color: '#F5A524', glyph: 'square' },
  { color: '#8E4EC6', glyph: 'diamond' },
  { color: '#12A594', glyph: 'cross' },
] as const;

export const GLYPH_PATHS: Record<string, string> = {
  circle: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z',
  triangle: 'M12 3.5 21 19.5H3Z',
  square: 'M5 5h14v14H5Z',
  diamond: 'M12 2.5 21.5 12 12 21.5 2.5 12Z',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
};

// Tile colours. Water's tile is its pale shore; the lake surface colour lives in the scene and the flat map.
export const TERRAIN_COLORS: Record<Terrain, string> = {
  forest: '#22B865', desert: '#FFB23A', water: '#F7E7B4', mountain: '#A596E6', swamp: '#178A6E',
};
export const WATER_COLOR = '#22C3D6';
export const STRUCTURE_COLORS: Record<string, string> = { white: '#FFFFFF', green: '#0B7A4B', blue: '#2D6BE0', black: '#1C1F2B' };
export const TERRITORY_COLORS = { bear: '#0B1A2A', cougar: '#C2185B' };

export function Glyph({ p, size = 20, title }: { p: number; size?: number; title?: string }) {
  const { color, glyph } = PLAYERS[p];
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="11.5" fill={color} />
      <path d={GLYPH_PATHS[glyph]} transform="translate(12 12) scale(.56) translate(-12 -12)" fill="#FFF8EA" />
    </svg>
  );
}

/** Small drawn marker shapes for the log and the space popover. */
export function Piece({ kind, p, size = 14 }: { kind: 'cube' | 'disc'; p: number; size?: number }) {
  const fill = PLAYERS[p].color;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="piece">
      {kind === 'cube'
        ? <><path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8Z" fill={fill} /><path d="M2 4.8 8 8l6-3.2M8 8v6.5" stroke="#06101C" strokeOpacity=".4" fill="none" /></>
        : <><ellipse cx="8" cy="10" rx="6.5" ry="3.2" fill={fill} /><ellipse cx="8" cy="8" rx="6.5" ry="3.2" fill={fill} stroke="#FFF8EA" strokeOpacity=".75" /></>}
    </svg>
  );
}

export const TERRAIN_ICON: Record<Terrain, string> = {
  forest: 'M12 2 5 12h4l-4 6h14l-4-6h4Zm-1 16h2v4h-2Z',
  water: 'M2 9c3 0 3-2 5-2s2 2 5 2 3-2 5-2 2 2 5 2v2c-3 0-3-2-5-2s-2 2-5 2-3-2-5-2-2 2-5 2Zm0 6c3 0 3-2 5-2s2 2 5 2 3-2 5-2 2 2 5 2v2c-3 0-3-2-5-2s-2 2-5 2-3-2-5-2-2 2-5 2Z',
  desert: 'M2 19c4-6 8-8 12-8 3 0 6 2 8 4v4Zm14-14a3 3 0 1 1 0 .01Z',
  mountain: 'M1 20 9 6l4 7 3-4 7 11Z',
  swamp: 'M6 20V9m4 11V5m4 15V8m4 12V11M3 20h18',
};
const ICON_TINT: Record<Terrain, string> = { forest: '#5BE39A', desert: '#FFC857', water: '#4FE3F0', mountain: '#B7AEF0', swamp: '#3CC9A8' };

export function TerrainIcon({ t, size = 18 }: { t: Terrain; size?: number }) {
  const stroke = t === 'swamp';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="ticon" style={{ color: ICON_TINT[t] }}>
      <path d={TERRAIN_ICON[t]} fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : 'none'} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function StructureIcon({ kind, color, size = 18 }: { kind: 'stone' | 'shack'; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={kind === 'stone' ? 'M8 2h8l6 6v8l-6 6H8l-6-6V8Z' : 'M12 2 22 20H2Z'}
        fill={STRUCTURE_COLORS[color]} stroke="#F4F1E8" strokeOpacity=".6" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function TerritoryIcon({ animal, size = 18 }: { animal: 'bear' | 'cougar'; size?: number }) {
  const dash = animal === 'cougar' ? '4 3' : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10l5 9-5 9H7l-5-9Z" fill="none" stroke="#FFF6E0" strokeWidth="5" strokeDasharray={dash} />
      <path d="M7 3h10l5 9-5 9H7l-5-9Z" fill="none" stroke={TERRITORY_COLORS[animal]} strokeWidth="2.6" strokeDasharray={dash} />
    </svg>
  );
}

// Fine line icons (1.5 stroke, round joins), drawn for this game.
const ICONS: Record<string, string> = {
  log: 'M5 4h11l3 3v13H5Z M8 9h8 M8 13h8 M8 17h5',
  book: 'M4 5c3-1.5 5.5-1.5 8 0v14c-2.5-1.5-5-1.5-8 0Z M12 5c2.5-1.5 5-1.5 8 0v14c-3-1.5-5.5-1.5-8 0',
  lens: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13Z M15.5 15.5 20 20',
  eye: 'M2.5 12C5 7.5 8.3 5.5 12 5.5s7 2 9.5 6.5C19 16.5 15.7 18.5 12 18.5S5 16.5 2.5 12Z M12 9.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6Z',
  exit: 'M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h10',
  target: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8Z',
  pencil: 'M4 20l1-4L16 5l3 3L8 19Z M14 7l3 3',
  close: 'M6 6l12 12 M18 6 6 18',
  arrow: 'M5 12h13 M13 6l6 6-6 6',
  ask: 'M4 5h16v11H9l-5 4Z M9 10h6',
  sound: 'M4 9h4l5-4v14l-5-4H4Z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4Z M17 9.5l5 5 M22 9.5l-5 5',
  music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0Z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8.5 20h7 M10 17h4',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'music-off': 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z M3 3l18 18',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}
