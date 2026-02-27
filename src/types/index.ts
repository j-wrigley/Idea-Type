import type { Font, PathCommand } from 'opentype.js';

export interface EditablePoint {
  commandIndex: number;
  field: 'end' | 'cp1' | 'cp2';
  x: number;
  y: number;
  isOnCurve: boolean;
}

export function pointKey(p: EditablePoint): string {
  return `${p.commandIndex}:${p.field}`;
}

export interface FontState {
  font: Font | null;
  fileName: string;
  selectedGlyphIndex: number | null;
  originalBuffer: ArrayBuffer | null;
  modifiedGlyphs: Set<number>;
}

export interface EditorState {
  zoom: number;
  panX: number;
  panY: number;
  hoveredPoint: EditablePoint | null;
  selectedPoints: EditablePoint[];
  isDragging: boolean;
  isPanning: boolean;
  isMarquee: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeEnd: { x: number; y: number } | null;
  cursorPos: { x: number; y: number } | null;
  isSpacePanning: boolean;
}

export interface GridSettings {
  visible: boolean;
  spacing: number;
  snapToGrid: boolean;
}

export const DEFAULT_GRID: GridSettings = {
  visible: true,
  spacing: 100,
  snapToGrid: false,
};

export interface TransformValues {
  scaleX: number;
  scaleY: number;
  rotation: number;
  shiftX: number;
  shiftY: number;
  skewX: number;
  skewY: number;
}

export const DEFAULT_TRANSFORM: TransformValues = {
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  shiftX: 0,
  shiftY: 0,
  skewX: 0,
  skewY: 0,
};

export function isDefaultTransform(t: TransformValues): boolean {
  return (
    t.scaleX === 1 &&
    t.scaleY === 1 &&
    t.rotation === 0 &&
    t.shiftX === 0 &&
    t.shiftY === 0 &&
    t.skewX === 0 &&
    t.skewY === 0
  );
}

export interface KernPair {
  leftGlyphIndex: number;
  rightGlyphIndex: number;
  leftChar: string;
  rightChar: string;
  value: number;
}

export interface MetricLine {
  id: string;
  label: string;
  value: number;
  visible: boolean;
  editable: boolean;
  builtin: boolean;
}

export function createDefaultMetrics(font: Font): MetricLine[] {
  const os2 = (font.tables as Record<string, unknown>)?.os2 as
    | { sxHeight?: number; sCapHeight?: number }
    | undefined;
  const xHeight = os2?.sxHeight ?? Math.round(font.unitsPerEm * 0.48);
  const capHeight = os2?.sCapHeight ?? Math.round(font.unitsPerEm * 0.7);
  const overshoot = Math.round(font.unitsPerEm * 0.01) || 10;

  return [
    { id: 'baseline', label: 'Baseline', value: 0, visible: true, editable: false, builtin: true },
    { id: 'ascender', label: 'Ascender', value: font.ascender, visible: true, editable: true, builtin: true },
    { id: 'descender', label: 'Descender', value: font.descender, visible: true, editable: true, builtin: true },
    { id: 'xHeight', label: 'x-Height', value: xHeight, visible: true, editable: true, builtin: true },
    { id: 'capHeight', label: 'Cap Height', value: capHeight, visible: true, editable: true, builtin: true },
    { id: 'ascOvershoot', label: 'Asc. Overshoot', value: font.ascender + overshoot, visible: false, editable: true, builtin: true },
    { id: 'descOvershoot', label: 'Desc. Overshoot', value: font.descender - overshoot, visible: false, editable: true, builtin: true },
  ];
}

export interface ComponentDef {
  id: string;
  name: string;
  commands: PathCommand[];
  advanceWidth: number;
}

export interface ComponentInstance {
  componentId: string;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export type GlyphComponents = Record<number, ComponentInstance[]>;

export type EditorTool = 'select' | 'pen' | 'rect' | 'ellipse' | 'shape' | 'slice';
export type SidebarTab = 'transform' | 'kerning';

declare global {
  interface Window {
    electronAPI: {
      openFontFile: () => Promise<{ buffer: ArrayBuffer; fileName: string } | null>;
      saveFontFile: (arrayBuffer: ArrayBuffer, defaultName: string) => Promise<boolean>;
    };
  }
}
