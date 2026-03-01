import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { PathCommand, Font, Glyph } from 'opentype.js';
import type { EditablePoint, EditorState, GridSettings, EditorTool, MetricLine } from '../types';
import { pointKey } from '../types';
import type { Theme } from '../App';
import { createCoordMapper } from '../utils/coordMapping';
import {
  getEditablePoints,
  findPointAtScreenPos,
  findPointsInRect,
  findSegmentAtScreenPos,
  splitSegmentAtT,
  deletePoints,
} from '../utils/hitTesting';
import {
  getContourRanges,
  getContourBounds,
  translateContourCommands,
  scaleContourCommands,
  extractContours,
  skewContourCommands,
  rotateContourCommands,
  isContourClockwise,
} from '../utils/pathTransforms';

interface GlyphEditorProps {
  commands: PathCommand[];
  font: Font;
  glyph: Glyph;
  onCommandsChange: (commands: PathCommand[]) => void;
  onDragStart: () => void;
  zoom: number;
  panX: number;
  panY: number;
  onZoomChange: (zoom: number) => void;
  onPanChange: (x: number, y: number) => void;
  theme: Theme;
  gridSettings: GridSettings;
  showRulers: boolean;
  showPathDirection: boolean;
  selectedPoints: EditablePoint[];
  onSelectedPointsChange: (pts: EditablePoint[]) => void;
  onDeletePoints: () => void;
  onAddPoint: (commandIndex: number, t: number) => void;
  onBreakSegment?: (commandIndex: number) => void;
  onSlice?: (x1: number, y1: number, x2: number, y2: number) => void;
  activeTool: EditorTool;
  cornerPoints: Set<number>;
  onCornerPointsChange: (index: number) => void;
  onSetCornerPoints: (indices: number[]) => void;
  showFill: boolean;
  contextGlyphs?: number[];
  onSwitchActiveGlyph?: (index: number) => void;
  metricLines?: MetricLine[];
  selectedContours: number[];
  onSelectedContoursChange: (contours: number[]) => void;
  onCreateComponentFromSelection?: (contourIndices: number[]) => void;
  onInsertComponentById?: (componentId: string, x: number, y: number) => void;
  availableComponents?: { id: string; name: string }[];
  componentInstances?: { componentId: string; name: string; offsetX: number; offsetY: number; bounds: { minX: number; minY: number; maxX: number; maxY: number }; resolvedCommands: PathCommand[] }[];
  onDecomposeInstance?: (instanceIndex: number) => void;
  onMoveInstance?: (instanceIndex: number, newOffsetX: number, newOffsetY: number) => void;
  onReverseContour?: () => void;
  onMakeCutout?: () => void;
  onMakeFill?: () => void;
  onMakeIndent?: () => void;
}

const DARK_COLORS = {
  background: '#0a0a0a',
  gridLine: 'rgba(255, 255, 255, 0.04)',
  gridLineSub: 'rgba(255, 255, 255, 0.02)',
  gridLabel: 'rgba(255, 255, 255, 0.15)',
  baseline: 'rgba(255, 255, 255, 0.35)',
  ascender: 'rgba(255, 255, 255, 0.2)',
  descender: 'rgba(255, 255, 255, 0.2)',
  advanceWidth: 'rgba(255, 255, 255, 0.15)',
  glyphFill: 'rgba(255, 255, 255, 0.06)',
  glyphStroke: '#ffffff',
  cornerPoint: '#ffffff',
  smoothPoint: '#4ec9b0',
  cubicControlPoint: '#c586c0',
  quadControlPoint: '#dcdcaa',
  handleLine: 'rgba(255, 255, 255, 0.3)',
  handleLineCubic: 'rgba(197, 134, 192, 0.35)',
  handleLineQuad: 'rgba(220, 220, 170, 0.35)',
  hoverHighlight: '#60d0ff',
  selectHighlight: '#ffffff',
  originMarker: 'rgba(255, 255, 255, 0.3)',
  pointInfoText: 'rgba(224, 224, 224, 0.8)',
  marquee: 'rgba(255, 255, 255, 0.15)',
  marqueeBorder: 'rgba(255, 255, 255, 0.5)',
  rulerBg: 'rgba(17, 17, 17, 0.9)',
  rulerText: 'rgba(255, 255, 255, 0.4)',
  rulerLine: 'rgba(255, 255, 255, 0.1)',
  crosshair: 'rgba(255, 255, 255, 0.15)',
  directionArrow: 'rgba(100, 200, 255, 0.5)',
  penPreview: 'rgba(100, 200, 255, 0.6)',
  penPreviewHandle: 'rgba(100, 200, 255, 0.8)',
  penPreviewFill: 'rgba(100, 200, 255, 0.15)',
  metricXHeight: 'rgba(100, 200, 100, 0.3)',
  metricCapHeight: 'rgba(200, 150, 50, 0.3)',
  metricOvershoot: 'rgba(255, 100, 100, 0.2)',
  metricCustom: 'rgba(150, 100, 255, 0.3)',
  snapGuide: 'rgba(255, 70, 70, 0.85)',
  snapGuideDim: 'rgba(255, 70, 70, 0.3)',
};

const LIGHT_COLORS = {
  background: '#f5f5f5',
  gridLine: 'rgba(0, 0, 0, 0.06)',
  gridLineSub: 'rgba(0, 0, 0, 0.03)',
  gridLabel: 'rgba(0, 0, 0, 0.15)',
  baseline: 'rgba(0, 0, 0, 0.35)',
  ascender: 'rgba(0, 0, 0, 0.2)',
  descender: 'rgba(0, 0, 0, 0.2)',
  advanceWidth: 'rgba(0, 0, 0, 0.12)',
  glyphFill: 'rgba(0, 0, 0, 0.06)',
  glyphStroke: '#111111',
  cornerPoint: '#222222',
  smoothPoint: '#2a8a78',
  cubicControlPoint: '#9b4d96',
  quadControlPoint: '#8a8530',
  handleLine: 'rgba(0, 0, 0, 0.25)',
  handleLineCubic: 'rgba(155, 77, 150, 0.3)',
  handleLineQuad: 'rgba(138, 133, 48, 0.3)',
  hoverHighlight: '#0088cc',
  selectHighlight: '#000000',
  originMarker: 'rgba(0, 0, 0, 0.25)',
  pointInfoText: 'rgba(30, 30, 30, 0.8)',
  marquee: 'rgba(0, 0, 0, 0.08)',
  marqueeBorder: 'rgba(0, 0, 0, 0.4)',
  rulerBg: 'rgba(240, 240, 240, 0.9)',
  rulerText: 'rgba(0, 0, 0, 0.4)',
  rulerLine: 'rgba(0, 0, 0, 0.1)',
  crosshair: 'rgba(0, 0, 0, 0.1)',
  directionArrow: 'rgba(0, 100, 200, 0.5)',
  metricXHeight: 'rgba(50, 150, 50, 0.35)',
  metricCapHeight: 'rgba(180, 120, 30, 0.35)',
  metricOvershoot: 'rgba(220, 60, 60, 0.25)',
  metricCustom: 'rgba(120, 60, 220, 0.35)',
  penPreview: 'rgba(0, 100, 200, 0.5)',
  penPreviewHandle: 'rgba(0, 100, 200, 0.7)',
  penPreviewFill: 'rgba(0, 100, 200, 0.1)',
  snapGuide: 'rgba(220, 40, 40, 0.85)',
  snapGuideDim: 'rgba(220, 40, 40, 0.3)',
};

type SnapGuide = {
  axis: 'h' | 'v';
  position: number;
  from: number;
  to: number;
};

const SNAP_THRESHOLD_PX = 8;

const RULER_SIZE = 24;

export const GlyphEditor: React.FC<GlyphEditorProps> = ({
  commands,
  font,
  glyph,
  onCommandsChange,
  onDragStart,
  zoom,
  panX,
  panY,
  onZoomChange,
  onPanChange,
  theme,
  gridSettings,
  showRulers,
  showPathDirection,
  selectedPoints,
  onSelectedPointsChange,
  onDeletePoints,
  onAddPoint,
  onBreakSegment,
  onSlice,
  activeTool,
  cornerPoints,
  onCornerPointsChange,
  onSetCornerPoints,
  showFill,
  contextGlyphs = [],
  onSwitchActiveGlyph,
  metricLines = [],
  selectedContours,
  onSelectedContoursChange,
  onCreateComponentFromSelection,
  onInsertComponentById,
  availableComponents = [],
  componentInstances = [],
  onDecomposeInstance,
  onMoveInstance,
  onReverseContour,
  onMakeCutout,
  onMakeFill,
  onMakeIndent,
}) => {
  const COLORS = useMemo(() => theme === 'dark' ? DARK_COLORS : LIGHT_COLORS, [theme]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [hoveredPoint, setHoveredPoint] = useState<EditablePoint | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isMarquee, setIsMarquee] = useState(false);
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dragStartGlyphRef = useRef<{ x: number; y: number } | null>(null);
  const penStateRef = useRef<{
    contourStartIdx: number;
    outgoingHandle: { x: number; y: number } | null;
  } | null>(null);
  const penDragRef = useRef<{ screen: { x: number; y: number }; glyph: { x: number; y: number } } | null>(null);
  const brokenLinksRef = useRef<Set<number>>(new Set());
  const [penCursorGlyph, setPenCursorGlyph] = useState<{ x: number; y: number } | null>(null);
  const [penSegmentSnap, setPenSegmentSnap] = useState<{ x: number; y: number } | null>(null);
  const [penDragState, setPenDragState] = useState<{
    downGlyph: { x: number; y: number };
    currentGlyph: { x: number; y: number };
  } | null>(null);

  const [shapeDragStart, setShapeDragStart] = useState<{ x: number; y: number } | null>(null);
  const [shapeDragCurrent, setShapeDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const shapeDragShiftRef = useRef(false);
  const [sliceDragStart, setSliceDragStart] = useState<{ x: number; y: number } | null>(null);
  const [sliceDragCurrent, setSliceDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    glyphX: number;
    glyphY: number;
    hasSelection: boolean;
    instanceIndex: number | null;
    segmentCommandIndex: number | null;
  } | null>(null);

  const [shapeToolDrag, setShapeToolDrag] = useState<{
    startGlyph: { x: number; y: number };
    currentGlyph: { x: number; y: number };
    altDuplicated: boolean;
    handle: string | null;
  } | null>(null);
  const shapeToolDragRef = useRef(shapeToolDrag);
  shapeToolDragRef.current = shapeToolDrag;

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  const [instanceDrag, setInstanceDrag] = useState<{
    instanceIndex: number;
    startOffsetX: number;
    startOffsetY: number;
    startGlyph: { x: number; y: number };
  } | null>(null);
  const instanceDragRef = useRef(instanceDrag);
  instanceDragRef.current = instanceDrag;

  useEffect(() => {
    if (activeTool !== 'pen') {
      setPenCursorGlyph(null);
      setPenSegmentSnap(null);
      setPenDragState(null);
      penStateRef.current = null;
    }
    if (activeTool !== 'rect' && activeTool !== 'ellipse') {
      setShapeDragStart(null);
      setShapeDragCurrent(null);
    }
    if (activeTool !== 'slice') {
      setSliceDragStart(null);
      setSliceDragCurrent(null);
    }
    if (activeTool !== 'shape') {
      setShapeToolDrag(null);
      setSnapGuides([]);
      onSelectedContoursChange([]);
    }
  }, [activeTool, onSelectedContoursChange]);

  const constrainToAxis = useCallback(
    (origin: { x: number; y: number }, free: { x: number; y: number }): { x: number; y: number } => {
      const dx = free.x - origin.x;
      const dy = free.y - origin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return free;
      const angle = Math.atan2(dy, dx);
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      return {
        x: origin.x + Math.cos(snappedAngle) * dist,
        y: origin.y + Math.sin(snappedAngle) * dist,
      };
    },
    [],
  );

  const selectedSet = useMemo(() => {
    const s = new Set<string>();
    for (const pt of selectedPoints) s.add(pointKey(pt));
    return s;
  }, [selectedPoints]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setCanvasSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ' && !isSpacePanning) {
        e.preventDefault();
        setIsSpacePanning(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsSpacePanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpacePanning]);

  const getMapper = useCallback(() => {
    return createCoordMapper(
      canvasSize.width,
      canvasSize.height,
      font.unitsPerEm,
      zoom,
      panX,
      panY,
      font.ascender,
    );
  }, [canvasSize, font, zoom, panX, panY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    const { width, height } = canvasSize;
    const mapper = getMapper();

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // Font-unit grid
    if (gridSettings.visible && gridSettings.spacing > 0) {
      const spacing = gridSettings.spacing;
      const topLeft = mapper.screenToGlyph(0, 0);
      const bottomRight = mapper.screenToGlyph(width, height);
      const minGX = Math.floor(Math.min(topLeft.x, bottomRight.x) / spacing) * spacing;
      const maxGX = Math.ceil(Math.max(topLeft.x, bottomRight.x) / spacing) * spacing;
      const minGY = Math.floor(Math.min(topLeft.y, bottomRight.y) / spacing) * spacing;
      const maxGY = Math.ceil(Math.max(topLeft.y, bottomRight.y) / spacing) * spacing;

      // Sub-grid (half spacing)
      const subSpacing = spacing / 2;
      ctx.strokeStyle = COLORS.gridLineSub;
      ctx.lineWidth = 0.5;
      for (let gx = minGX; gx <= maxGX; gx += subSpacing) {
        if (gx % spacing === 0) continue;
        const s = mapper.glyphToScreen(gx, 0);
        ctx.beginPath();
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, height);
        ctx.stroke();
      }
      for (let gy = minGY; gy <= maxGY; gy += subSpacing) {
        if (gy % spacing === 0) continue;
        const s = mapper.glyphToScreen(0, gy);
        ctx.beginPath();
        ctx.moveTo(0, s.y);
        ctx.lineTo(width, s.y);
        ctx.stroke();
      }

      // Main grid
      ctx.strokeStyle = COLORS.gridLine;
      ctx.lineWidth = 1;
      for (let gx = minGX; gx <= maxGX; gx += spacing) {
        const s = mapper.glyphToScreen(gx, 0);
        ctx.beginPath();
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, height);
        ctx.stroke();
      }
      for (let gy = minGY; gy <= maxGY; gy += spacing) {
        const s = mapper.glyphToScreen(0, gy);
        ctx.beginPath();
        ctx.moveTo(0, s.y);
        ctx.lineTo(width, s.y);
        ctx.stroke();
      }
    }

    // Guidelines
    const drawHLine = (glyphY: number, color: string, label: string) => {
      const screen = mapper.glyphToScreen(0, glyphY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(label, 8, screen.y - 4);
    };

    const metricColor = (id: string): string => {
      switch (id) {
        case 'baseline': return COLORS.baseline;
        case 'ascender': return COLORS.ascender;
        case 'descender': return COLORS.descender;
        case 'xHeight': return COLORS.metricXHeight;
        case 'capHeight': return COLORS.metricCapHeight;
        case 'ascOvershoot':
        case 'descOvershoot': return COLORS.metricOvershoot;
        default: return COLORS.metricCustom;
      }
    };

    for (const ml of metricLines) {
      if (!ml.visible) continue;
      drawHLine(ml.value, metricColor(ml.id), `${ml.label} (${ml.value})`);
    }

    // Advance width vertical lines
    const advW = glyph.advanceWidth || 0;
    if (advW > 0) {
      const left = mapper.glyphToScreen(0, 0);
      const right = mapper.glyphToScreen(advW, 0);
      ctx.strokeStyle = COLORS.advanceWidth;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(left.x, 0);
      ctx.lineTo(left.x, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(right.x, 0);
      ctx.lineTo(right.x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Context glyphs (non-active glyphs shown as filled shapes)
    let activeGlyphIndex = -1;
    for (const idx of contextGlyphs) {
      if (idx < font.glyphs.length && font.glyphs.get(idx) === glyph) {
        activeGlyphIndex = idx;
        break;
      }
    }
    if (contextGlyphs.length > 1 && activeGlyphIndex >= 0) {
      // Compute x-offset for each glyph in the sequence
      const activePos = contextGlyphs.indexOf(activeGlyphIndex);
      // Sum advance widths before the active glyph to find its origin offset
      let activeOriginX = 0;
      for (let i = 0; i < activePos; i++) {
        const g = font.glyphs.get(contextGlyphs[i]);
        activeOriginX += g.advanceWidth || font.unitsPerEm;
      }

      let runningX = 0;
      const contextFill = theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)';
      for (let ci = 0; ci < contextGlyphs.length; ci++) {
        const cIdx = contextGlyphs[ci];
        if (cIdx >= font.glyphs.length) continue;
        const cGlyph = font.glyphs.get(cIdx);
        const xOffset = runningX - activeOriginX;

        if (cIdx !== activeGlyphIndex && cGlyph.path && cGlyph.path.commands.length > 0) {
          ctx.beginPath();
          for (const cmd of cGlyph.path.commands) {
            if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
              const p = mapper.glyphToScreen(cmd.x + xOffset, cmd.y);
              ctx.moveTo(p.x, p.y);
            } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
              const p = mapper.glyphToScreen(cmd.x + xOffset, cmd.y);
              ctx.lineTo(p.x, p.y);
            } else if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
              const cp = mapper.glyphToScreen(cmd.x1 + xOffset, cmd.y1);
              const ep = mapper.glyphToScreen(cmd.x + xOffset, cmd.y);
              ctx.quadraticCurveTo(cp.x, cp.y, ep.x, ep.y);
            } else if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
              const cp1 = mapper.glyphToScreen(cmd.x1 + xOffset, cmd.y1);
              const cp2 = mapper.glyphToScreen(cmd.x2 + xOffset, cmd.y2);
              const ep = mapper.glyphToScreen(cmd.x + xOffset, cmd.y);
              ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
            } else if (cmd.type === 'Z') {
              ctx.closePath();
            }
          }
          ctx.fillStyle = contextFill;
          ctx.fill('evenodd');
        }

        // Draw advance width separator for context glyphs
        if (ci < contextGlyphs.length - 1) {
          const nextX = runningX + (cGlyph.advanceWidth || font.unitsPerEm);
          const sepScreen = mapper.glyphToScreen(nextX - activeOriginX, 0);
          ctx.strokeStyle = COLORS.advanceWidth;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(sepScreen.x, 0);
          ctx.lineTo(sepScreen.x, height);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        runningX += cGlyph.advanceWidth || font.unitsPerEm;
      }
    }

    // Origin marker
    const origin = mapper.glyphToScreen(0, 0);
    ctx.strokeStyle = COLORS.originMarker;
    ctx.lineWidth = 1;
    const crossSize = 8;
    ctx.beginPath();
    ctx.moveTo(origin.x - crossSize, origin.y);
    ctx.lineTo(origin.x + crossSize, origin.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y - crossSize);
    ctx.lineTo(origin.x, origin.y + crossSize);
    ctx.stroke();

    if (commands.length > 0) {
      // Glyph fill
      ctx.beginPath();
      for (const cmd of commands) {
        if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
          const p = mapper.glyphToScreen(cmd.x, cmd.y);
          ctx.moveTo(p.x, p.y);
        } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
          const p = mapper.glyphToScreen(cmd.x, cmd.y);
          ctx.lineTo(p.x, p.y);
        } else if (
          cmd.type === 'Q' &&
          cmd.x1 !== undefined && cmd.y1 !== undefined &&
          cmd.x !== undefined && cmd.y !== undefined
        ) {
          const cp = mapper.glyphToScreen(cmd.x1, cmd.y1);
          const ep = mapper.glyphToScreen(cmd.x, cmd.y);
          ctx.quadraticCurveTo(cp.x, cp.y, ep.x, ep.y);
        } else if (
          cmd.type === 'C' &&
          cmd.x1 !== undefined && cmd.y1 !== undefined &&
          cmd.x2 !== undefined && cmd.y2 !== undefined &&
          cmd.x !== undefined && cmd.y !== undefined
        ) {
          const cp1 = mapper.glyphToScreen(cmd.x1, cmd.y1);
          const cp2 = mapper.glyphToScreen(cmd.x2, cmd.y2);
          const ep = mapper.glyphToScreen(cmd.x, cmd.y);
          ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, ep.x, ep.y);
        } else if (cmd.type === 'Z') {
          ctx.closePath();
        }
      }
      if (showFill) {
        ctx.fillStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.85)';
        ctx.fill('evenodd');
        ctx.strokeStyle = COLORS.glyphStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = COLORS.glyphFill;
        ctx.fill('evenodd');
        ctx.strokeStyle = COLORS.glyphStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Path direction arrows
      if (showPathDirection) {
        let pX = 0;
        let pY = 0;
        for (const cmd of commands) {
          if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
            pX = cmd.x;
            pY = cmd.y;
            continue;
          }
          let midX = pX;
          let midY = pY;
          let angle = 0;
          if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
            midX = (pX + cmd.x) / 2;
            midY = (pY + cmd.y) / 2;
            const s1 = mapper.glyphToScreen(pX, pY);
            const s2 = mapper.glyphToScreen(cmd.x, cmd.y);
            angle = Math.atan2(s2.y - s1.y, s2.x - s1.x);
            pX = cmd.x;
            pY = cmd.y;
          } else if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
            const t = 0.5;
            const u = 1 - t;
            midX = u * u * pX + 2 * u * t * cmd.x1 + t * t * cmd.x;
            midY = u * u * pY + 2 * u * t * cmd.y1 + t * t * cmd.y;
            const tangentX = 2 * (1 - t) * (cmd.x1 - pX) + 2 * t * (cmd.x - cmd.x1);
            const tangentY = 2 * (1 - t) * (cmd.y1 - pY) + 2 * t * (cmd.y - cmd.y1);
            const s1 = mapper.glyphToScreen(0, 0);
            const s2 = mapper.glyphToScreen(tangentX, tangentY);
            const s0 = mapper.glyphToScreen(0, 0);
            angle = Math.atan2(s0.y - (s2.y - s1.y + s0.y), s2.x - s1.x + s0.x - s0.x);
            angle = Math.atan2(-(s2.y - s0.y - (s1.y - s0.y)), s2.x - s0.x - (s1.x - s0.x));
            pX = cmd.x;
            pY = cmd.y;
          } else if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
            const t = 0.5;
            const u = 1 - t;
            midX = u * u * u * pX + 3 * u * u * t * cmd.x1 + 3 * u * t * t * cmd.x2 + t * t * t * cmd.x;
            midY = u * u * u * pY + 3 * u * u * t * cmd.y1 + 3 * u * t * t * cmd.y2 + t * t * t * cmd.y;
            const tangentX = 3 * u * u * (cmd.x1 - pX) + 6 * u * t * (cmd.x2 - cmd.x1) + 3 * t * t * (cmd.x - cmd.x2);
            const tangentY = 3 * u * u * (cmd.y1 - pY) + 6 * u * t * (cmd.y2 - cmd.y1) + 3 * t * t * (cmd.y - cmd.y2);
            const ts = mapper.glyphToScreen(midX + tangentX, midY + tangentY);
            const ms = mapper.glyphToScreen(midX, midY);
            angle = Math.atan2(ts.y - ms.y, ts.x - ms.x);
            pX = cmd.x;
            pY = cmd.y;
          } else if (cmd.type === 'Z') {
            pX = 0;
            pY = 0;
            continue;
          } else {
            continue;
          }

          const mid = mapper.glyphToScreen(midX, midY);
          const arrowLen = 8;
          ctx.save();
          ctx.translate(mid.x, mid.y);
          ctx.rotate(angle);
          ctx.fillStyle = COLORS.directionArrow;
          ctx.beginPath();
          ctx.moveTo(arrowLen, 0);
          ctx.lineTo(-arrowLen * 0.5, -arrowLen * 0.5);
          ctx.lineTo(-arrowLen * 0.5, arrowLen * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // Contour fill/hole badges (always shown when shape tool active)
      if (activeTool === 'shape') {
        const contourRanges = getContourRanges(commands);
        for (let ci = 0; ci < contourRanges.length; ci++) {
          const r = contourRanges[ci];
          const firstCmd = commands[r.start];
          if (!firstCmd || firstCmd.x === undefined || firstCmd.y === undefined) continue;
          const pos = mapper.glyphToScreen(firstCmd.x, firstCmd.y);
          const cw = isContourClockwise(commands, ci);
          const isSelected = selectedContours.includes(ci);
          const label = cw ? 'FILL' : 'HOLE';
          const bgColor = cw
            ? (theme === 'dark' ? 'rgba(60,180,80,0.8)' : 'rgba(30,140,50,0.8)')
            : (theme === 'dark' ? 'rgba(220,80,80,0.8)' : 'rgba(200,50,50,0.8)');
          ctx.font = `bold 9px -apple-system, BlinkMacSystemFont, monospace`;
          const metrics = ctx.measureText(label);
          const bw = metrics.width + 8;
          const bh = 14;
          const bx = pos.x + 8;
          const by = pos.y - bh - 4;
          ctx.fillStyle = bgColor;
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 3);
          ctx.fill();
          if (isSelected) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, bx + 4, by + bh / 2);
        }
      }

      // Handle lines
      const editablePoints = getEditablePoints(commands);
      let prevEndpoint: { x: number; y: number } | null = null;
      for (const cmd of commands) {
        if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined) {
          const cp = mapper.glyphToScreen(cmd.x1, cmd.y1);
          if (prevEndpoint) {
            const pe = mapper.glyphToScreen(prevEndpoint.x, prevEndpoint.y);
            ctx.strokeStyle = COLORS.handleLineQuad;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pe.x, pe.y);
            ctx.lineTo(cp.x, cp.y);
            ctx.stroke();
          }
          if (cmd.x !== undefined && cmd.y !== undefined) {
            const ep = mapper.glyphToScreen(cmd.x, cmd.y);
            ctx.beginPath();
            ctx.moveTo(cp.x, cp.y);
            ctx.lineTo(ep.x, ep.y);
            ctx.stroke();
          }
        }

        if (
          cmd.type === 'C' &&
          cmd.x1 !== undefined && cmd.y1 !== undefined &&
          cmd.x2 !== undefined && cmd.y2 !== undefined
        ) {
          const cp1 = mapper.glyphToScreen(cmd.x1, cmd.y1);
          const cp2 = mapper.glyphToScreen(cmd.x2, cmd.y2);
          if (prevEndpoint) {
            const pe = mapper.glyphToScreen(prevEndpoint.x, prevEndpoint.y);
            ctx.strokeStyle = COLORS.handleLineCubic;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pe.x, pe.y);
            ctx.lineTo(cp1.x, cp1.y);
            ctx.stroke();
          }
          if (cmd.x !== undefined && cmd.y !== undefined) {
            const ep = mapper.glyphToScreen(cmd.x, cmd.y);
            ctx.beginPath();
            ctx.moveTo(cp2.x, cp2.y);
            ctx.lineTo(ep.x, ep.y);
            ctx.stroke();
          }
        }

        if (cmd.x !== undefined && cmd.y !== undefined) {
          prevEndpoint = { x: cmd.x, y: cmd.y };
        }
        if (cmd.type === 'Z') {
          prevEndpoint = null;
        }
      }

      // Draw points with distinct colors per type:
      //   Corner (on-curve, sharp)    = square, cornerPoint color
      //   Smooth (on-curve, tangent)   = circle, smoothPoint color
      //   Cubic control (C: cp1/cp2)   = diamond, cubicControlPoint color
      //   Quadratic control (Q: cp1)   = triangle, quadControlPoint color
      for (const pt of editablePoints) {
        const screen = mapper.glyphToScreen(pt.x, pt.y);
        const isHovered =
          hoveredPoint?.commandIndex === pt.commandIndex &&
          hoveredPoint?.field === pt.field;
        const isSelected = selectedSet.has(pointKey(pt));

        const cmd = commands[pt.commandIndex];
        const nextCmd = pt.commandIndex + 1 < commands.length ? commands[pt.commandIndex + 1] : null;
        const hasCurveIn = cmd?.type === 'Q' || cmd?.type === 'C';
        const hasCurveOut = nextCmd && (nextCmd.type === 'Q' || nextCmd.type === 'C');
        const isSmooth = pt.isOnCurve && pt.field === 'end' && !cornerPoints.has(pt.commandIndex) && (hasCurveIn || hasCurveOut);

        // Determine point category
        const isCubicCP = !pt.isOnCurve && cmd?.type === 'C';
        const isQuadCP = !pt.isOnCurve && cmd?.type === 'Q';
        const isCorner = pt.isOnCurve && !isSmooth;

        // Pick color by point type
        let pointColor: string;
        if (isSelected) {
          pointColor = COLORS.selectHighlight;
        } else if (isHovered) {
          pointColor = COLORS.hoverHighlight;
        } else if (isCorner) {
          pointColor = COLORS.cornerPoint;
        } else if (isSmooth) {
          pointColor = COLORS.smoothPoint;
        } else if (isQuadCP) {
          pointColor = COLORS.quadControlPoint;
        } else if (isCubicCP) {
          pointColor = COLORS.cubicControlPoint;
        } else {
          pointColor = COLORS.cornerPoint;
        }

        ctx.fillStyle = pointColor;
        ctx.strokeStyle = pointColor;

        const size = pt.isOnCurve ? 5 : 4;

        if (isCorner) {
          // Square for corner points
          ctx.fillRect(screen.x - size, screen.y - size, size * 2, size * 2);
        } else if (isSmooth) {
          // Circle for smooth on-curve points
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, size, 0, Math.PI * 2);
          ctx.fill();
        } else if (isCubicCP) {
          // Diamond for cubic control points
          ctx.beginPath();
          ctx.moveTo(screen.x, screen.y - size - 1);
          ctx.lineTo(screen.x + size + 1, screen.y);
          ctx.lineTo(screen.x, screen.y + size + 1);
          ctx.lineTo(screen.x - size - 1, screen.y);
          ctx.closePath();
          ctx.fill();
        } else if (isQuadCP) {
          // Triangle for quadratic control points
          const r = size + 1;
          ctx.beginPath();
          ctx.moveTo(screen.x, screen.y - r);
          ctx.lineTo(screen.x + r, screen.y + r * 0.7);
          ctx.lineTo(screen.x - r, screen.y + r * 0.7);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, size, 0, Math.PI * 2);
          ctx.fill();
        }

        // Selection/hover ring
        if (isSelected || isHovered) {
          ctx.lineWidth = 2;
          if (isCorner) {
            ctx.strokeRect(
              screen.x - size - 2,
              screen.y - size - 2,
              (size + 2) * 2,
              (size + 2) * 2,
            );
          } else if (isCubicCP) {
            ctx.beginPath();
            ctx.moveTo(screen.x, screen.y - size - 4);
            ctx.lineTo(screen.x + size + 4, screen.y);
            ctx.lineTo(screen.x, screen.y + size + 4);
            ctx.lineTo(screen.x - size - 4, screen.y);
            ctx.closePath();
            ctx.stroke();
          } else if (isQuadCP) {
            const r = size + 4;
            ctx.beginPath();
            ctx.moveTo(screen.x, screen.y - r);
            ctx.lineTo(screen.x + r, screen.y + r * 0.7);
            ctx.lineTo(screen.x - r, screen.y + r * 0.7);
            ctx.closePath();
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, size + 3, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }

    // Pen tool live preview
    if (activeTool === 'pen' && penCursorGlyph) {
      const getLastEndpoint = (): { x: number; y: number } | null => {
        for (let i = commands.length - 1; i >= 0; i--) {
          const c = commands[i];
          if (c.type !== 'Z' && c.x !== undefined && c.y !== undefined) {
            return { x: c.x, y: c.y };
          }
        }
        return null;
      };

      const lastPt = getLastEndpoint();

      if (penStateRef.current && lastPt) {
        const sLast = mapper.glyphToScreen(lastPt.x, lastPt.y);
        const sCursor = mapper.glyphToScreen(penCursorGlyph.x, penCursorGlyph.y);

        if (penDragState) {
          // Actively dragging — show curve preview with handles
          const downPt = penDragState.downGlyph;
          const dragPt = penDragState.currentGlyph;
          const mirrorPt = { x: 2 * downPt.x - dragPt.x, y: 2 * downPt.y - dragPt.y };
          const dragDist = Math.sqrt((dragPt.x - downPt.x) ** 2 + (dragPt.y - downPt.y) ** 2);
          const isDrag = dragDist > 5;

          const cp1 = penStateRef.current.outgoingHandle ?? {
            x: lastPt.x,
            y: lastPt.y,
          };
          const cp2 = isDrag
            ? mirrorPt
            : { x: downPt.x, y: downPt.y };

          const sCp1 = mapper.glyphToScreen(cp1.x, cp1.y);
          const sCp2 = mapper.glyphToScreen(cp2.x, cp2.y);
          const sDown = mapper.glyphToScreen(downPt.x, downPt.y);

          // Preview curve
          ctx.strokeStyle = COLORS.penPreview;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(sLast.x, sLast.y);
          if (penStateRef.current.outgoingHandle || isDrag) {
            ctx.bezierCurveTo(sCp1.x, sCp1.y, sCp2.x, sCp2.y, sDown.x, sDown.y);
          } else {
            ctx.lineTo(sDown.x, sDown.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          if (isDrag) {
            const sDrag = mapper.glyphToScreen(dragPt.x, dragPt.y);
            const sMirror = mapper.glyphToScreen(mirrorPt.x, mirrorPt.y);

            // Handle lines
            ctx.strokeStyle = COLORS.penPreviewHandle;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sDrag.x, sDrag.y);
            ctx.lineTo(sDown.x, sDown.y);
            ctx.lineTo(sMirror.x, sMirror.y);
            ctx.stroke();

            // Handle dots
            ctx.fillStyle = COLORS.penPreviewHandle;
            ctx.beginPath();
            ctx.arc(sDrag.x, sDrag.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(sMirror.x, sMirror.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // Anchor preview
          ctx.fillStyle = COLORS.penPreview;
          ctx.fillRect(sDown.x - 4, sDown.y - 4, 8, 8);
        } else {
          // Hovering — rubber band from last point to cursor
          if (penStateRef.current.outgoingHandle) {
            const cp1 = penStateRef.current.outgoingHandle;
            const cp2 = {
              x: penCursorGlyph.x,
              y: penCursorGlyph.y,
            };
            const sCp1 = mapper.glyphToScreen(cp1.x, cp1.y);
            const sCp2 = mapper.glyphToScreen(cp2.x, cp2.y);

            ctx.strokeStyle = COLORS.penPreview;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(sLast.x, sLast.y);
            ctx.bezierCurveTo(sCp1.x, sCp1.y, sCp2.x, sCp2.y, sCursor.x, sCursor.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Show outgoing handle from previous point
            const sHandle = mapper.glyphToScreen(cp1.x, cp1.y);
            ctx.strokeStyle = COLORS.penPreviewHandle;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sLast.x, sLast.y);
            ctx.lineTo(sHandle.x, sHandle.y);
            ctx.stroke();
            ctx.fillStyle = COLORS.penPreviewHandle;
            ctx.beginPath();
            ctx.arc(sHandle.x, sHandle.y, 3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = COLORS.penPreview;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(sLast.x, sLast.y);
            ctx.lineTo(sCursor.x, sCursor.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Preview dot at cursor
          ctx.fillStyle = COLORS.penPreview;
          ctx.beginPath();
          ctx.arc(sCursor.x, sCursor.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Close-path indicator when hovering near the start of the contour
        const startCmd = commands[penStateRef.current.contourStartIdx];
        if (startCmd?.x !== undefined && startCmd?.y !== undefined) {
          const sStart = mapper.glyphToScreen(startCmd.x, startCmd.y);
          const cursorScreen = penDragState
            ? mapper.glyphToScreen(penDragState.downGlyph.x, penDragState.downGlyph.y)
            : mapper.glyphToScreen(penCursorGlyph.x, penCursorGlyph.y);
          const dist = Math.sqrt((sStart.x - cursorScreen.x) ** 2 + (sStart.y - cursorScreen.y) ** 2);
          if (dist < 15 && commands.length > penStateRef.current.contourStartIdx + 1) {
            ctx.strokeStyle = COLORS.penPreview;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sStart.x, sStart.y, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      } else if (!penStateRef.current) {
        // No contour yet — preview dot at cursor; show attach indicator if near open endpoint
        const sCursor = mapper.glyphToScreen(penCursorGlyph.x, penCursorGlyph.y);
        ctx.fillStyle = COLORS.penPreview;
        ctx.beginPath();
        ctx.arc(sCursor.x, sCursor.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Attach indicator: circle around open contour endpoint when cursor is near
        if (commands.length > 0) {
          const ranges = getContourRanges(commands);
          const ATTACH_INDICATOR_THRESHOLD = 18;
          for (const r of ranges) {
            const lastCmd = commands[r.end];
            const isOpen = lastCmd?.type !== 'Z' && lastCmd?.x !== undefined && lastCmd?.y !== undefined;
            if (isOpen && lastCmd.x !== undefined && lastCmd.y !== undefined) {
              const sEnd = mapper.glyphToScreen(lastCmd.x, lastCmd.y);
              const dist = Math.sqrt((sCursor.x - sEnd.x) ** 2 + (sCursor.y - sEnd.y) ** 2);
              if (dist < ATTACH_INDICATOR_THRESHOLD) {
                ctx.strokeStyle = COLORS.penPreview;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(sEnd.x, sEnd.y, 9, 0, Math.PI * 2);
                ctx.stroke();
                break;
              }
            }
          }
        }
      }

      // Snap-to-segment indicator: shows a dot + ring on the path when hovering
      if (penSegmentSnap && !penStateRef.current) {
        const sSnap = mapper.glyphToScreen(penSegmentSnap.x, penSegmentSnap.y);

        // Outer ring
        ctx.strokeStyle = COLORS.penPreview;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sSnap.x, sSnap.y, 8, 0, Math.PI * 2);
        ctx.stroke();

        // Inner filled dot
        ctx.fillStyle = COLORS.penPreviewHandle;
        ctx.beginPath();
        ctx.arc(sSnap.x, sSnap.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // "+" indicator
        ctx.strokeStyle = COLORS.penPreviewHandle;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sSnap.x + 12, sSnap.y - 5);
        ctx.lineTo(sSnap.x + 12, sSnap.y + 5);
        ctx.moveTo(sSnap.x + 7, sSnap.y);
        ctx.lineTo(sSnap.x + 17, sSnap.y);
        ctx.stroke();
      }
    }

    // Slice tool preview
    if (activeTool === 'slice' && sliceDragStart && sliceDragCurrent) {
      const s1 = mapper.glyphToScreen(sliceDragStart.x, sliceDragStart.y);
      const s2 = mapper.glyphToScreen(sliceDragCurrent.x, sliceDragCurrent.y);
      ctx.strokeStyle = COLORS.penPreview;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Shape tool preview
    if ((activeTool === 'rect' || activeTool === 'ellipse') && shapeDragStart && shapeDragCurrent) {
      const s1 = mapper.glyphToScreen(shapeDragStart.x, shapeDragStart.y);
      const s2 = mapper.glyphToScreen(shapeDragCurrent.x, shapeDragCurrent.y);
      ctx.strokeStyle = COLORS.penPreview;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      if (activeTool === 'rect') {
        const rx = Math.min(s1.x, s2.x);
        const ry = Math.min(s1.y, s2.y);
        const rw = Math.abs(s2.x - s1.x);
        const rh = Math.abs(s2.y - s1.y);
        ctx.strokeRect(rx, ry, rw, rh);
      } else {
        const cx = (s1.x + s2.x) / 2;
        const cy = (s1.y + s2.y) / 2;
        const rx = Math.abs(s2.x - s1.x) / 2;
        const ry = Math.abs(s2.y - s1.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Shape tool: selected contour bounding boxes + scale handles + drag preview
    if (activeTool === 'shape' && selectedContours.length > 0) {
      const ranges = getContourRanges(commands);

      const dragDx = shapeToolDrag ? shapeToolDrag.currentGlyph.x - shapeToolDrag.startGlyph.x : 0;
      const dragDy = shapeToolDrag ? shapeToolDrag.currentGlyph.y - shapeToolDrag.startGlyph.y : 0;
      const handleId = shapeToolDrag?.handle ?? null;
      const isMoveDrag = shapeToolDrag && !handleId && (Math.abs(dragDx) > 0.5 || Math.abs(dragDy) > 0.5);
      const isScaleDrag = handleId && !handleId.startsWith('skew_') && handleId !== 'rotate';
      const isRotateDrag = handleId === 'rotate';
      const isSkewDrag = handleId?.startsWith('skew_');

      // Compute original (untransformed) bounding box of all selected contours
      let origMinX = Infinity, origMinY = Infinity, origMaxX = -Infinity, origMaxY = -Infinity;
      for (const ci of selectedContours) {
        if (ci < 0 || ci >= ranges.length) continue;
        const b = getContourBounds(commands, ci);
        if (b.minX < origMinX) origMinX = b.minX;
        if (b.minY < origMinY) origMinY = b.minY;
        if (b.maxX > origMaxX) origMaxX = b.maxX;
        if (b.maxY > origMaxY) origMaxY = b.maxY;
      }
      const origCx = (origMinX + origMaxX) / 2;
      const origCy = (origMinY + origMaxY) / 2;

      // Compute live scale factors when dragging a scale handle
      let liveSx = 1, liveSy = 1, anchorX = origMinX, anchorY = origMinY;
      if (isScaleDrag && isFinite(origMinX)) {
        const bw = origMaxX - origMinX || 1;
        const bh = origMaxY - origMinY || 1;
        const h = handleId!;
        if (h.includes('r')) { anchorX = origMinX; liveSx = (bw + dragDx) / bw; }
        else if (h.includes('l')) { anchorX = origMaxX; liveSx = (bw - dragDx) / bw; }
        if (h.includes('b')) { anchorY = origMaxY; liveSy = (bh - dragDy) / bh; }
        else if (h.includes('t')) { anchorY = origMinY; liveSy = (bh + dragDy) / bh; }
        if (h === 'tc' || h === 'bc') liveSx = 1;
        if (h === 'ml' || h === 'mr') liveSy = 1;
      }

      // Compute live rotation angle
      let liveRotDeg = 0;
      if (isRotateDrag && shapeToolDrag && isFinite(origCx)) {
        const startAngle = Math.atan2(
          shapeToolDrag.startGlyph.y - origCy,
          shapeToolDrag.startGlyph.x - origCx,
        );
        const curAngle = Math.atan2(
          shapeToolDrag.currentGlyph.y - origCy,
          shapeToolDrag.currentGlyph.x - origCx,
        );
        liveRotDeg = ((curAngle - startAngle) * 180) / Math.PI;
      }

      // Compute live skew
      let liveSkewXDeg = 0, liveSkewYDeg = 0;
      if (isSkewDrag && isFinite(origMinX)) {
        const bw = origMaxX - origMinX || 1;
        const bh = origMaxY - origMinY || 1;
        const skewId = handleId!.replace('skew_', '');
        if (skewId === 'tc' || skewId === 'bc') {
          liveSkewXDeg = Math.atan2(dragDx, bh) * (180 / Math.PI);
        } else if (skewId === 'ml' || skewId === 'mr') {
          liveSkewYDeg = Math.atan2(dragDy, bw) * (180 / Math.PI);
        }
      }

      // Transform a glyph coordinate for preview
      const xformPt = (gx: number, gy: number): { x: number; y: number } => {
        let px = gx, py = gy;
        if (isScaleDrag) {
          px = anchorX + (px - anchorX) * liveSx;
          py = anchorY + (py - anchorY) * liveSy;
        } else if (isRotateDrag && liveRotDeg !== 0) {
          const rad = (liveRotDeg * Math.PI) / 180;
          const cos = Math.cos(rad), sin = Math.sin(rad);
          const dx = px - origCx, dy = py - origCy;
          px = origCx + dx * cos - dy * sin;
          py = origCy + dx * sin + dy * cos;
        } else if (isSkewDrag && (liveSkewXDeg !== 0 || liveSkewYDeg !== 0)) {
          const tanX = Math.tan((liveSkewXDeg * Math.PI) / 180);
          const tanY = Math.tan((liveSkewYDeg * Math.PI) / 180);
          px = px + (py - origCy) * tanX;
          py = py + (gx - origCx) * tanY;
        } else if (isMoveDrag) {
          px += dragDx;
          py += dragDy;
        }
        return mapper.glyphToScreen(px, py);
      };

      // Compute transformed bounding box (in screen coords for accuracy with rotation/skew)
      let screenMinX = Infinity, screenMinY = Infinity, screenMaxX = -Infinity, screenMaxY = -Infinity;
      let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
      for (const ci of selectedContours) {
        if (ci < 0 || ci >= ranges.length) continue;
        const b = getContourBounds(commands, ci);
        const corners = [
          { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
          { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY },
        ];
        for (const c of corners) {
          const screenPt = xformPt(c.x, c.y);
          if (screenPt.x < screenMinX) screenMinX = screenPt.x;
          if (screenPt.y < screenMinY) screenMinY = screenPt.y;
          if (screenPt.x > screenMaxX) screenMaxX = screenPt.x;
          if (screenPt.y > screenMaxY) screenMaxY = screenPt.y;

          let px = c.x, py = c.y;
          if (isScaleDrag) { px = anchorX + (px - anchorX) * liveSx; py = anchorY + (py - anchorY) * liveSy; }
          else if (isMoveDrag) { px += dragDx; py += dragDy; }
          if (px < allMinX) allMinX = px;
          if (py < allMinY) allMinY = py;
          if (px > allMaxX) allMaxX = px;
          if (py > allMaxY) allMaxY = py;
        }

        // Draw contour with live transform
        const { start, end: cEnd } = ranges[ci];
        const contourCmds = commands.slice(start, cEnd + 1);
        const drawContourPath = () => {
          ctx.beginPath();
          for (const cmd of contourCmds) {
            if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
              const s = xformPt(cmd.x, cmd.y);
              ctx.moveTo(s.x, s.y);
            } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
              const s = xformPt(cmd.x, cmd.y);
              ctx.lineTo(s.x, s.y);
            } else if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
              const s1 = xformPt(cmd.x1, cmd.y1);
              const se = xformPt(cmd.x, cmd.y);
              ctx.quadraticCurveTo(s1.x, s1.y, se.x, se.y);
            } else if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
              const s1 = xformPt(cmd.x1, cmd.y1);
              const s2 = xformPt(cmd.x2, cmd.y2);
              const se = xformPt(cmd.x, cmd.y);
              ctx.bezierCurveTo(s1.x, s1.y, s2.x, s2.y, se.x, se.y);
            } else if (cmd.type === 'Z') {
              ctx.closePath();
            }
          }
        };

        ctx.fillStyle = theme === 'dark' ? 'rgba(100, 200, 255, 0.15)' : 'rgba(0, 100, 200, 0.15)';
        drawContourPath();
        ctx.fill();

        ctx.strokeStyle = theme === 'dark' ? 'rgba(100, 200, 255, 0.6)' : 'rgba(0, 100, 200, 0.6)';
        ctx.lineWidth = 2;
        drawContourPath();
        ctx.stroke();
      }

      if (isFinite(allMinX)) {
        const useScreenBounds = isRotateDrag || isSkewDrag;
        const bx = useScreenBounds ? screenMinX : mapper.glyphToScreen(allMinX, allMaxY).x;
        const by = useScreenBounds ? screenMinY : mapper.glyphToScreen(allMinX, allMaxY).y;
        const bw = useScreenBounds ? screenMaxX - screenMinX : mapper.glyphToScreen(allMaxX, allMinY).x - bx;
        const bh = useScreenBounds ? screenMaxY - screenMinY : mapper.glyphToScreen(allMaxX, allMinY).y - by;

        ctx.strokeStyle = theme === 'dark' ? 'rgba(100, 200, 255, 0.7)' : 'rgba(0, 100, 200, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);

        const HANDLE_SIZE = 6;
        const ROTATE_DIST = 28;
        const handleColor = theme === 'dark' ? '#64c8ff' : '#0064c8';
        const handles = [
          { x: bx, y: by }, { x: bx + bw / 2, y: by }, { x: bx + bw, y: by },
          { x: bx, y: by + bh / 2 }, { x: bx + bw, y: by + bh / 2 },
          { x: bx, y: by + bh }, { x: bx + bw / 2, y: by + bh }, { x: bx + bw, y: by + bh },
        ];
        for (const h of handles) {
          ctx.fillStyle = handleColor;
          ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          ctx.strokeStyle = theme === 'dark' ? '#fff' : '#000';
          ctx.lineWidth = 1;
          ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }

        // Rotation handle (circle above top-center with connecting line)
        const rotHx = bx + bw / 2;
        const rotHy = by - ROTATE_DIST;
        ctx.strokeStyle = handleColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(bx + bw / 2, by);
        ctx.lineTo(rotHx, rotHy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(rotHx, rotHy, 5, 0, Math.PI * 2);
        ctx.fillStyle = handleColor;
        ctx.fill();
        ctx.strokeStyle = theme === 'dark' ? '#fff' : '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Dimension labels
        const origW = Math.round(origMaxX - origMinX);
        const origH = Math.round(origMaxY - origMinY);
        const labelFont = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        const labelBg = theme === 'dark' ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.85)';
        const labelColor = theme === 'dark' ? '#64c8ff' : '#0064c8';
        const labelBorder = theme === 'dark' ? 'rgba(100, 200, 255, 0.4)' : 'rgba(0, 100, 200, 0.3)';

        const drawLabel = (text: string, x: number, y: number) => {
          ctx.font = labelFont;
          const metrics = ctx.measureText(text);
          const pw = 5, ph = 3;
          const tw = metrics.width + pw * 2;
          const th = 16 + ph * 2;
          ctx.fillStyle = labelBg;
          ctx.strokeStyle = labelBorder;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          const rx = x - tw / 2, ry = y - th / 2;
          ctx.beginPath();
          ctx.roundRect(rx, ry, tw, th, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = labelColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x, y);
        };

        // Use original bounding box positions for stable label placement
        const origSMin = mapper.glyphToScreen(origMinX, origMaxY);
        const origSMax = mapper.glyphToScreen(origMaxX, origMinY);
        const origBx = origSMin.x, origBy = origSMin.y;
        const origBw = origSMax.x - origSMin.x, origBh = origSMax.y - origSMin.y;

        if (isScaleDrag) {
          // During scale: show updated dimensions + scale percentage
          const scaledW = Math.round(origW * Math.abs(liveSx));
          const scaledH = Math.round(origH * Math.abs(liveSy));
          drawLabel(`W: ${scaledW}`, bx + bw / 2, by - ROTATE_DIST - 18);
          drawLabel(`H: ${scaledH}`, bx + bw + 28, by + bh / 2);
          const pctX = Math.round(liveSx * 100);
          const pctY = Math.round(liveSy * 100);
          const scaleText = liveSx !== 1 && liveSy !== 1
            ? `${pctX}% × ${pctY}%`
            : liveSx !== 1 ? `${pctX}%` : `${pctY}%`;
          drawLabel(scaleText, bx + bw / 2, by + bh + 16);
        } else if (isRotateDrag) {
          // During rotate: show fixed W/H at original position + angle
          drawLabel(`${origW} × ${origH}`, origBx + origBw / 2, origBy - ROTATE_DIST - 18);
          drawLabel(`${liveRotDeg >= 0 ? '+' : ''}${liveRotDeg.toFixed(1)}°`, bx + bw / 2, by + bh + 16);
        } else if (isSkewDrag) {
          // During skew: show fixed W/H at original position + skew angle
          drawLabel(`${origW} × ${origH}`, origBx + origBw / 2, origBy - ROTATE_DIST - 18);
          const skewVal = liveSkewXDeg !== 0 ? liveSkewXDeg : liveSkewYDeg;
          const skewAxis = liveSkewXDeg !== 0 ? 'Skew X' : 'Skew Y';
          drawLabel(`${skewAxis}: ${skewVal >= 0 ? '+' : ''}${skewVal.toFixed(1)}°`, bx + bw / 2, by + bh + 16);
        } else if (isMoveDrag) {
          // During move: show fixed W/H + move delta
          drawLabel(`W: ${origW}`, bx + bw / 2, by - ROTATE_DIST - 18);
          drawLabel(`H: ${origH}`, bx + bw + 28, by + bh / 2);
          drawLabel(`Δ ${Math.round(dragDx)}, ${Math.round(dragDy)}`, bx + bw / 2, by + bh + 16);
        } else {
          // Idle: show W/H at stable original positions + position coords
          drawLabel(`W: ${origW}`, origBx + origBw / 2, origBy - ROTATE_DIST - 18);
          drawLabel(`H: ${origH}`, origBx + origBw + 28, origBy + origBh / 2);
          drawLabel(`X: ${Math.round(origMinX)}  Y: ${Math.round(origMinY)}`, origBx + origBw / 2, origBy + origBh + 16);
        }
      }
    }

    // Component instances - draw filled paths with a tinted style
    if (componentInstances.length > 0) {
      const compFill = theme === 'dark' ? 'rgba(80, 160, 255, 0.25)' : 'rgba(0, 90, 180, 0.18)';
      const compStroke = theme === 'dark' ? 'rgba(100, 180, 255, 0.7)' : 'rgba(0, 100, 200, 0.6)';
      const compBorder = theme === 'dark' ? 'rgba(100, 180, 255, 0.3)' : 'rgba(0, 100, 200, 0.25)';
      const labelColor = theme === 'dark' ? 'rgba(100, 180, 255, 0.9)' : 'rgba(0, 80, 180, 0.8)';

      for (const inst of componentInstances) {
        // Draw the actual component paths filled
        if (inst.resolvedCommands && inst.resolvedCommands.length > 0) {
          ctx.beginPath();
          for (const cmd of inst.resolvedCommands) {
            if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
              const s = mapper.glyphToScreen(cmd.x, cmd.y);
              ctx.moveTo(s.x, s.y);
            } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
              const s = mapper.glyphToScreen(cmd.x, cmd.y);
              ctx.lineTo(s.x, s.y);
            } else if (cmd.type === 'C') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const c = cmd as any;
              const s1 = mapper.glyphToScreen(c.x1, c.y1);
              const s2 = mapper.glyphToScreen(c.x2, c.y2);
              const se = mapper.glyphToScreen(c.x, c.y);
              ctx.bezierCurveTo(s1.x, s1.y, s2.x, s2.y, se.x, se.y);
            } else if (cmd.type === 'Q') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const c = cmd as any;
              const s1 = mapper.glyphToScreen(c.x1, c.y1);
              const se = mapper.glyphToScreen(c.x, c.y);
              ctx.quadraticCurveTo(s1.x, s1.y, se.x, se.y);
            } else if (cmd.type === 'Z') {
              ctx.closePath();
            }
          }
          ctx.fillStyle = compFill;
          ctx.fill();
          ctx.strokeStyle = compStroke;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Draw bounding box outline and label
        const b = inst.bounds;
        if (!isFinite(b.minX)) continue;

        const tl = mapper.glyphToScreen(b.minX, b.maxY);
        const br = mapper.glyphToScreen(b.maxX, b.minY);
        const bx = tl.x, by = tl.y, bw = br.x - tl.x, bh = br.y - tl.y;

        ctx.strokeStyle = compBorder;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);

        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = labelColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(inst.name, bx + 4, by + 4);
      }
    }

    // Snap guide lines
    if (snapGuides.length > 0) {
      ctx.save();
      ctx.strokeStyle = COLORS.snapGuide;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (const guide of snapGuides) {
        if (guide.axis === 'v') {
          const top = mapper.glyphToScreen(guide.position, guide.to);
          const bot = mapper.glyphToScreen(guide.position, guide.from);
          ctx.beginPath();
          ctx.moveTo(Math.round(top.x) + 0.5, top.y);
          ctx.lineTo(Math.round(bot.x) + 0.5, bot.y);
          ctx.stroke();
          // Diamond markers at snap points
          for (const sy of [top.y, bot.y]) {
            ctx.fillStyle = COLORS.snapGuide;
            ctx.beginPath();
            ctx.moveTo(top.x, sy - 3);
            ctx.lineTo(top.x + 3, sy);
            ctx.lineTo(top.x, sy + 3);
            ctx.lineTo(top.x - 3, sy);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          const left = mapper.glyphToScreen(guide.from, guide.position);
          const right = mapper.glyphToScreen(guide.to, guide.position);
          ctx.beginPath();
          ctx.moveTo(left.x, Math.round(left.y) + 0.5);
          ctx.lineTo(right.x, Math.round(right.y) + 0.5);
          ctx.stroke();
          for (const sx of [left.x, right.x]) {
            ctx.fillStyle = COLORS.snapGuide;
            ctx.beginPath();
            ctx.moveTo(sx - 3, left.y);
            ctx.lineTo(sx, left.y - 3);
            ctx.lineTo(sx + 3, left.y);
            ctx.lineTo(sx, left.y + 3);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    // Marquee selection rectangle
    if (isMarquee && marqueeStart && marqueeEnd) {
      const mx = Math.min(marqueeStart.x, marqueeEnd.x);
      const my = Math.min(marqueeStart.y, marqueeEnd.y);
      const mw = Math.abs(marqueeEnd.x - marqueeStart.x);
      const mh = Math.abs(marqueeEnd.y - marqueeStart.y);
      ctx.fillStyle = COLORS.marquee;
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = COLORS.marqueeBorder;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    // Cursor crosshair
    if (showRulers && cursorPos) {
      ctx.strokeStyle = COLORS.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cursorPos.x, 0);
      ctx.lineTo(cursorPos.x, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, cursorPos.y);
      ctx.lineTo(width, cursorPos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Rulers
    if (showRulers) {
      const rulerSpacing = gridSettings.spacing > 0 ? gridSettings.spacing : 100;
      const topLeft = mapper.screenToGlyph(0, 0);
      const bottomRight = mapper.screenToGlyph(width, height);

      // Horizontal ruler (top)
      ctx.fillStyle = COLORS.rulerBg;
      ctx.fillRect(0, 0, width, RULER_SIZE);
      const minRX = Math.floor(Math.min(topLeft.x, bottomRight.x) / rulerSpacing) * rulerSpacing;
      const maxRX = Math.ceil(Math.max(topLeft.x, bottomRight.x) / rulerSpacing) * rulerSpacing;
      ctx.fillStyle = COLORS.rulerText;
      ctx.font = '9px -apple-system, BlinkMacSystemFont, monospace';
      ctx.textAlign = 'center';
      for (let gx = minRX; gx <= maxRX; gx += rulerSpacing) {
        const sx = mapper.glyphToScreen(gx, 0).x;
        if (sx < 0 || sx > width) continue;
        ctx.strokeStyle = COLORS.rulerLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, RULER_SIZE - 6);
        ctx.lineTo(sx, RULER_SIZE);
        ctx.stroke();
        ctx.fillText(String(gx), sx, RULER_SIZE - 8);
      }

      // Vertical ruler (left)
      ctx.fillStyle = COLORS.rulerBg;
      ctx.fillRect(0, RULER_SIZE, RULER_SIZE, height - RULER_SIZE);
      const minRY = Math.floor(Math.min(topLeft.y, bottomRight.y) / rulerSpacing) * rulerSpacing;
      const maxRY = Math.ceil(Math.max(topLeft.y, bottomRight.y) / rulerSpacing) * rulerSpacing;
      ctx.textAlign = 'right';
      for (let gy = minRY; gy <= maxRY; gy += rulerSpacing) {
        const sy = mapper.glyphToScreen(0, gy).y;
        if (sy < RULER_SIZE || sy > height) continue;
        ctx.strokeStyle = COLORS.rulerLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(RULER_SIZE - 6, sy);
        ctx.lineTo(RULER_SIZE, sy);
        ctx.stroke();
        ctx.save();
        ctx.translate(RULER_SIZE - 8, sy);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.rulerText;
        ctx.fillText(String(gy), 0, 0);
        ctx.restore();
      }

      // Corner
      ctx.fillStyle = COLORS.rulerBg;
      ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);

      // Cursor position in rulers
      if (cursorPos) {
        const glyph = mapper.screenToGlyph(cursorPos.x, cursorPos.y);
        ctx.fillStyle = COLORS.rulerBg;
        ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
        ctx.fillStyle = COLORS.pointInfoText;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(glyph.x).toString(), RULER_SIZE / 2, RULER_SIZE / 2 - 1);
        ctx.fillText(Math.round(glyph.y).toString(), RULER_SIZE / 2, RULER_SIZE / 2 + 8);
      }
    }

    // Selected point info
    if (selectedPoints.length > 0) {
      ctx.fillStyle = COLORS.pointInfoText;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, monospace';
      ctx.textAlign = 'left';
      if (selectedPoints.length === 1) {
        const sp = selectedPoints[0];
        ctx.fillText(
          `Point ${sp.commandIndex} (${sp.field}): x=${Math.round(sp.x)}, y=${Math.round(sp.y)}`,
          12,
          height - 12,
        );
      } else {
        const onCurveCount = selectedPoints.filter(p => p.field === 'end' && p.isOnCurve).length;
        const hint = onCurveCount >= 2 ? '  ·  ⌥+drag to mirror' : '';
        ctx.fillText(`${selectedPoints.length} points selected${hint}`, 12, height - 12);
      }
    }
  }, [commands, canvasSize, font, glyph, zoom, panX, panY, hoveredPoint, selectedSet, selectedPoints, getMapper, COLORS, gridSettings, showRulers, showPathDirection, isMarquee, marqueeStart, marqueeEnd, cursorPos, cornerPoints, activeTool, penCursorGlyph, penSegmentSnap, penDragState, showFill, theme, contextGlyphs, metricLines, shapeDragStart, shapeDragCurrent, sliceDragStart, sliceDragCurrent, selectedContours, shapeToolDrag, componentInstances, snapGuides]);

  const getCanvasPos = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      // Scale to canvas logical coords when displayed size differs (zoom, DPR, CSS scaling)
      const scaleX = rect.width > 0 ? canvasSize.width / rect.width : 1;
      const scaleY = rect.height > 0 ? canvasSize.height / rect.height : 1;
      return {
        x: rawX * scaleX,
        y: rawY * scaleY,
      };
    },
    [canvasSize.width, canvasSize.height],
  );

  const snapToGrid = useCallback(
    (gx: number, gy: number): { x: number; y: number } => {
      if (!gridSettings.snapToGrid || gridSettings.spacing <= 0) return { x: gx, y: gy };
      const s = gridSettings.spacing;
      return {
        x: Math.round(gx / s) * s,
        y: Math.round(gy / s) * s,
      };
    },
    [gridSettings],
  );

  const computeSnapGuides = useCallback(
    (
      draggedBounds: { minX: number; minY: number; maxX: number; maxY: number },
      allCommands: PathCommand[],
      draggedContourIndices: number[],
      advW: number,
    ): { snapDx: number; snapDy: number; guides: SnapGuide[] } => {
      const mapper = getMapper();
      const thresh = SNAP_THRESHOLD_PX / mapper.scale;

      const ranges = getContourRanges(allCommands);
      const guides: SnapGuide[] = [];

      const dragCx = (draggedBounds.minX + draggedBounds.maxX) / 2;
      const dragCy = (draggedBounds.minY + draggedBounds.maxY) / 2;

      // Source edges/centers from the dragged contour
      const srcX = [draggedBounds.minX, dragCx, draggedBounds.maxX];
      const srcY = [draggedBounds.minY, dragCy, draggedBounds.maxY];

      // Collect candidate snap positions
      const candX: { pos: number; extMin: number; extMax: number }[] = [];
      const candY: { pos: number; extMin: number; extMax: number }[] = [];
      const draggedSet = new Set(draggedContourIndices);

      // Other contour edges and centers
      for (let ci = 0; ci < ranges.length; ci++) {
        if (draggedSet.has(ci)) continue;
        const b = getContourBounds(allCommands, ci);
        if (!isFinite(b.minX)) continue;
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        candX.push({ pos: b.minX, extMin: b.minY, extMax: b.maxY });
        candX.push({ pos: cx, extMin: b.minY, extMax: b.maxY });
        candX.push({ pos: b.maxX, extMin: b.minY, extMax: b.maxY });
        candY.push({ pos: b.minY, extMin: b.minX, extMax: b.maxX });
        candY.push({ pos: cy, extMin: b.minX, extMax: b.maxX });
        candY.push({ pos: b.maxY, extMin: b.minX, extMax: b.maxX });
      }

      // Advance width lines (x=0 and x=advW)
      const bigY = 2000;
      candX.push({ pos: 0, extMin: -bigY, extMax: bigY });
      if (advW > 0) candX.push({ pos: advW, extMin: -bigY, extMax: bigY });

      // Font metric lines
      for (const ml of metricLines) {
        if (!ml.visible) continue;
        candY.push({ pos: ml.value, extMin: -bigY, extMax: bigY });
      }
      // Baseline always
      candY.push({ pos: 0, extMin: -bigY, extMax: bigY });

      // Grid lines (if snap-to-grid enabled)
      if (gridSettings.snapToGrid && gridSettings.spacing > 0) {
        const s = gridSettings.spacing;
        const gMinX = Math.floor((draggedBounds.minX - thresh * 2) / s) * s;
        const gMaxX = Math.ceil((draggedBounds.maxX + thresh * 2) / s) * s;
        const gMinY = Math.floor((draggedBounds.minY - thresh * 2) / s) * s;
        const gMaxY = Math.ceil((draggedBounds.maxY + thresh * 2) / s) * s;
        for (let gx = gMinX; gx <= gMaxX; gx += s) {
          candX.push({ pos: gx, extMin: -bigY, extMax: bigY });
        }
        for (let gy = gMinY; gy <= gMaxY; gy += s) {
          candY.push({ pos: gy, extMin: -bigY, extMax: bigY });
        }
      }

      // Find best snap on each axis
      let bestSnapX = 0;
      let bestDistX = thresh;
      let bestGuideX: SnapGuide | null = null;

      for (const s of srcX) {
        for (const c of candX) {
          const dist = Math.abs(s - c.pos);
          if (dist < bestDistX) {
            bestDistX = dist;
            bestSnapX = c.pos - s;
            const extMin = Math.min(c.extMin, draggedBounds.minY, draggedBounds.maxY);
            const extMax = Math.max(c.extMax, draggedBounds.minY, draggedBounds.maxY);
            bestGuideX = { axis: 'v', position: c.pos, from: extMin, to: extMax };
          }
        }
      }

      let bestSnapY = 0;
      let bestDistY = thresh;
      let bestGuideY: SnapGuide | null = null;

      for (const s of srcY) {
        for (const c of candY) {
          const dist = Math.abs(s - c.pos);
          if (dist < bestDistY) {
            bestDistY = dist;
            bestSnapY = c.pos - s;
            const extMin = Math.min(c.extMin, draggedBounds.minX, draggedBounds.maxX);
            const extMax = Math.max(c.extMax, draggedBounds.minX, draggedBounds.maxX);
            bestGuideY = { axis: 'h', position: c.pos, from: extMin, to: extMax };
          }
        }
      }

      if (bestGuideX) guides.push(bestGuideX);
      if (bestGuideY) guides.push(bestGuideY);

      return { snapDx: bestSnapX, snapDy: bestSnapY, guides };
    },
    [getMapper, gridSettings, metricLines],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (contextMenu) setContextMenu(null);
      if (e.button === 2) return;

      const pos = getCanvasPos(e);

      if (e.button === 1 || isSpacePanning) {
        panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
        setIsPanning(true);
        return;
      }

      // Hit-test component instances for drag-to-move (works with any tool)
      if (componentInstances.length > 0) {
        const mapper = getMapper();
        const clickGlyph = mapper.screenToGlyph(pos.x, pos.y);
        for (let i = componentInstances.length - 1; i >= 0; i--) {
          const inst = componentInstances[i];
          const b = inst.bounds;
          if (isFinite(b.minX) && clickGlyph.x >= b.minX && clickGlyph.x <= b.maxX &&
              clickGlyph.y >= b.minY && clickGlyph.y <= b.maxY) {
            setInstanceDrag({
              instanceIndex: i,
              startOffsetX: inst.offsetX,
              startOffsetY: inst.offsetY,
              startGlyph: { x: clickGlyph.x, y: clickGlyph.y },
            });
            onSelectedPointsChange([]);
            return;
          }
        }
      }

      // Slice tool mode
      if (activeTool === 'slice') {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const snapped = snapToGrid(glyphPos.x, glyphPos.y);
        const gx = Math.round(snapped.x);
        const gy = Math.round(snapped.y);
        setSliceDragStart({ x: gx, y: gy });
        setSliceDragCurrent({ x: gx, y: gy });
        return;
      }

      // Shape tool mode (rect/ellipse)
      if (activeTool === 'rect' || activeTool === 'ellipse') {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const snapped = snapToGrid(glyphPos.x, glyphPos.y);
        setShapeDragStart({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
        setShapeDragCurrent({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
        shapeDragShiftRef.current = e.shiftKey;
        return;
      }

      // Shape select tool (contour mode)
      if (activeTool === 'shape') {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const ranges = getContourRanges(commands);

        // Check if clicking a handle (scale, rotate, skew)
        if (selectedContours.length > 0) {
          let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
          for (const ci of selectedContours) {
            const b = getContourBounds(commands, ci);
            if (b.minX < allMinX) allMinX = b.minX;
            if (b.minY < allMinY) allMinY = b.minY;
            if (b.maxX > allMaxX) allMaxX = b.maxX;
            if (b.maxY > allMaxY) allMaxY = b.maxY;
          }
          if (isFinite(allMinX)) {
            const sMin = mapper.glyphToScreen(allMinX, allMaxY);
            const sMax = mapper.glyphToScreen(allMaxX, allMinY);
            const bx = sMin.x, by = sMin.y, bw = sMax.x - sMin.x, bh = sMax.y - sMin.y;
            const HANDLE_SIZE = 8;
            const ROTATE_DIST = 28;

            // Rotation handle (circle above top-center)
            const rotHandleX = bx + bw / 2;
            const rotHandleY = by - ROTATE_DIST;
            if (Math.sqrt((pos.x - rotHandleX) ** 2 + (pos.y - rotHandleY) ** 2) < 8) {
              setShapeToolDrag({
                startGlyph: { x: glyphPos.x, y: glyphPos.y },
                currentGlyph: { x: glyphPos.x, y: glyphPos.y },
                altDuplicated: false,
                handle: 'rotate',
              });
              return;
            }

            // Alt+edge midpoints = skew handles
            const handleDefs = [
              { id: 'tl', x: bx, y: by }, { id: 'tc', x: bx + bw / 2, y: by }, { id: 'tr', x: bx + bw, y: by },
              { id: 'ml', x: bx, y: by + bh / 2 }, { id: 'mr', x: bx + bw, y: by + bh / 2 },
              { id: 'bl', x: bx, y: by + bh }, { id: 'bc', x: bx + bw / 2, y: by + bh }, { id: 'br', x: bx + bw, y: by + bh },
            ];
            for (const h of handleDefs) {
              if (Math.abs(pos.x - h.x) < HANDLE_SIZE && Math.abs(pos.y - h.y) < HANDLE_SIZE) {
                const isEdgeMid = h.id === 'tc' || h.id === 'bc' || h.id === 'ml' || h.id === 'mr';
                setShapeToolDrag({
                  startGlyph: { x: glyphPos.x, y: glyphPos.y },
                  currentGlyph: { x: glyphPos.x, y: glyphPos.y },
                  altDuplicated: false,
                  handle: (e.altKey && isEdgeMid) ? `skew_${h.id}` : h.id,
                });
                return;
              }
            }
          }
        }

        // Hit test contours using Path2D
        const canvas = canvasRef.current;
        if (canvas) {
          const tempCtx = canvas.getContext('2d');
          if (tempCtx) {
            let hitContour = -1;

            const buildPath2D = (ci: number): Path2D | null => {
              if (ci < 0 || ci >= ranges.length) return null;
              const { start, end: cEnd } = ranges[ci];
              const contourCmds = commands.slice(start, cEnd + 1);
              const path2d = new Path2D();
              for (const cmd of contourCmds) {
                if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
                  const s = mapper.glyphToScreen(cmd.x, cmd.y);
                  path2d.moveTo(s.x, s.y);
                } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
                  const s = mapper.glyphToScreen(cmd.x, cmd.y);
                  path2d.lineTo(s.x, s.y);
                } else if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
                  const s1 = mapper.glyphToScreen(cmd.x1, cmd.y1);
                  const se = mapper.glyphToScreen(cmd.x, cmd.y);
                  path2d.quadraticCurveTo(s1.x, s1.y, se.x, se.y);
                } else if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
                  const s1 = mapper.glyphToScreen(cmd.x1, cmd.y1);
                  const s2 = mapper.glyphToScreen(cmd.x2, cmd.y2);
                  const se = mapper.glyphToScreen(cmd.x, cmd.y);
                  path2d.bezierCurveTo(s1.x, s1.y, s2.x, s2.y, se.x, se.y);
                } else if (cmd.type === 'Z') {
                  path2d.closePath();
                }
              }
              return path2d;
            };

            // Collect ALL contours under the cursor (topmost first) for cycle-through selection
            const hitContours: number[] = [];

            // First pass: try isPointInPath (click inside filled area)
            for (let ci = ranges.length - 1; ci >= 0; ci--) {
              const path2d = buildPath2D(ci);
              if (path2d && tempCtx.isPointInPath(path2d, pos.x, pos.y)) {
                hitContours.push(ci);
              }
            }

            // Second pass: try isPointInStroke with a generous width (click near the outline)
            if (hitContours.length === 0) {
              const savedLW = tempCtx.lineWidth;
              tempCtx.lineWidth = 12;
              for (let ci = ranges.length - 1; ci >= 0; ci--) {
                const path2d = buildPath2D(ci);
                if (path2d && tempCtx.isPointInStroke(path2d, pos.x, pos.y)) {
                  hitContours.push(ci);
                }
              }
              tempCtx.lineWidth = savedLW;
            }

            // Third pass: check proximity to any point in the contour (bounding box + margin)
            if (hitContours.length === 0) {
              const MARGIN = 15;
              for (let ci = ranges.length - 1; ci >= 0; ci--) {
                if (ci >= ranges.length) continue;
                const b = getContourBounds(commands, ci);
                const sMin = mapper.glyphToScreen(b.minX, b.maxY);
                const sMax = mapper.glyphToScreen(b.maxX, b.minY);
                if (pos.x >= sMin.x - MARGIN && pos.x <= sMax.x + MARGIN &&
                    pos.y >= sMin.y - MARGIN && pos.y <= sMax.y + MARGIN) {
                  hitContours.push(ci);
                }
              }
            }

            if (hitContours.length > 0) {
              const hitContour = hitContours[0];
              if (e.shiftKey) {
                const next = selectedContours.includes(hitContour)
                  ? selectedContours.filter(c => c !== hitContour)
                  : [...selectedContours, hitContour];
                onSelectedContoursChange(next);
              } else if (e.detail === 2) {
                // Double-click: cycle through overlapping contours
                const currentSelection = selectedContours.length === 1 ? selectedContours[0] : -1;
                const idx = hitContours.indexOf(currentSelection);
                if (idx >= 0 && hitContours.length > 1) {
                  const nextIdx = (idx + 1) % hitContours.length;
                  onSelectedContoursChange([hitContours[nextIdx]]);
                } else {
                  onSelectedContoursChange([hitContour]);
                }
              } else {
                // Single click: select topmost shape (no cycle; allows drag without re-selecting)
                onSelectedContoursChange([hitContour]);
              }
              setShapeToolDrag({
                startGlyph: { x: glyphPos.x, y: glyphPos.y },
                currentGlyph: { x: glyphPos.x, y: glyphPos.y },
                altDuplicated: false,
                handle: null,
              });
            } else {
              onSelectedContoursChange([]);
              setShapeToolDrag(null);
              setSnapGuides([]);
            }
          }
        }
        return;
      }

      // Pen tool mode
      if (activeTool === 'pen') {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);

        if (penStateRef.current) {
          const startCmd = commands[penStateRef.current.contourStartIdx];
          if (startCmd && startCmd.x !== undefined && startCmd.y !== undefined) {
            const startScreen = mapper.glyphToScreen(startCmd.x, startCmd.y);
            const dist = Math.sqrt((pos.x - startScreen.x) ** 2 + (pos.y - startScreen.y) ** 2);
            if (dist < 10 && commands.length > penStateRef.current.contourStartIdx + 1) {
              onDragStart();
              const lastCmd = commands[commands.length - 1];
              const lastX = lastCmd?.x ?? 0;
              const lastY = lastCmd?.y ?? 0;
              const alreadyAtStart =
                Math.abs(lastX - startCmd.x) < 1 && Math.abs(lastY - startCmd.y) < 1;
              if (alreadyAtStart) {
                onCommandsChange([...commands, { type: 'Z' }]);
              } else if (penStateRef.current.outgoingHandle) {
                const cp1 = penStateRef.current.outgoingHandle;
                const cp2 = {
                  x: Math.round(startCmd.x - (startCmd.x - lastX) / 3),
                  y: Math.round(startCmd.y - (startCmd.y - lastY) / 3),
                };
                onCommandsChange([
                  ...commands,
                  { type: 'C', x1: cp1.x, y1: cp1.y, x2: cp2.x, y2: cp2.y, x: startCmd.x, y: startCmd.y },
                  { type: 'Z' },
                ]);
              } else {
                onCommandsChange([
                  ...commands,
                  { type: 'L', x: startCmd.x, y: startCmd.y },
                  { type: 'Z' },
                ]);
              }
              penStateRef.current = null;
              return;
            }
          }
        }

        // When not actively drawing, clicking on a segment adds a point to it
        // (but skip if an existing point is directly under the cursor)
        if (!penStateRef.current && commands.length > 0) {
          const editPts = getEditablePoints(commands);
          const hitPoint = findPointAtScreenPos(editPts, pos.x, pos.y, mapper.glyphToScreen.bind(mapper));
          if (!hitPoint) {
            const segHit = findSegmentAtScreenPos(commands, pos.x, pos.y, mapper.glyphToScreen.bind(mapper));
            if (segHit) {
              onAddPoint(segHit.commandIndex, segHit.t);
              return;
            }
          }
        }

        // Attach to open contour endpoint: if no active contour, check if click is near any open path's end
        if (!penStateRef.current && commands.length > 0) {
          const ranges = getContourRanges(commands);
          const ATTACH_THRESHOLD = 18;
          let bestDist = ATTACH_THRESHOLD;
          let bestRange: { start: number; end: number } | null = null;
          for (const r of ranges) {
            const lastCmd = commands[r.end];
            const isOpen = lastCmd?.type !== 'Z' && lastCmd?.x !== undefined && lastCmd?.y !== undefined;
            if (isOpen && lastCmd.x !== undefined && lastCmd.y !== undefined) {
              const endScreen = mapper.glyphToScreen(lastCmd.x, lastCmd.y);
              const dist = Math.sqrt((pos.x - endScreen.x) ** 2 + (pos.y - endScreen.y) ** 2);
              if (dist < bestDist) {
                bestDist = dist;
                bestRange = r;
              }
            }
          }
          if (bestRange) {
            penStateRef.current = {
              contourStartIdx: bestRange.start,
              outgoingHandle: null,
            };
            const ON_ENDPOINT_THRESHOLD = 5;
            if (bestDist < ON_ENDPOINT_THRESHOLD) {
              return;
            }
          }
        }

        const snappedPen = snapToGrid(glyphPos.x, glyphPos.y);
        const snappedPenRound = { x: Math.round(snappedPen.x), y: Math.round(snappedPen.y) };
        penDragRef.current = { screen: pos, glyph: snappedPenRound };
        setPenDragState({
          downGlyph: snappedPenRound,
          currentGlyph: snappedPenRound,
        });
        return;
      }

      const mapper = getMapper();

      // Check if click landed on a context glyph — switch to it
      if (onSwitchActiveGlyph && contextGlyphs.length > 1) {
        let ctxActiveIdx = -1;
        for (const idx of contextGlyphs) {
          if (idx < font.glyphs.length && font.glyphs.get(idx) === glyph) {
            ctxActiveIdx = idx;
            break;
          }
        }
        if (ctxActiveIdx >= 0) {
          const activePos = contextGlyphs.indexOf(ctxActiveIdx);
          let ctxActiveOriginX = 0;
          for (let i = 0; i < activePos; i++) {
            ctxActiveOriginX += font.glyphs.get(contextGlyphs[i]).advanceWidth || font.unitsPerEm;
          }
          const clickGlyph = mapper.screenToGlyph(pos.x, pos.y);
          let runX = 0;
          for (let ci = 0; ci < contextGlyphs.length; ci++) {
            const cIdx = contextGlyphs[ci];
            if (cIdx >= font.glyphs.length) continue;
            const cGlyph = font.glyphs.get(cIdx);
            const cAdvW = cGlyph.advanceWidth || font.unitsPerEm;
            const localX = clickGlyph.x - (runX - ctxActiveOriginX);
            if (cIdx !== ctxActiveIdx && localX >= 0 && localX <= cAdvW && clickGlyph.y >= font.descender && clickGlyph.y <= font.ascender) {
              onSwitchActiveGlyph(cIdx);
              return;
            }
            runX += cAdvW;
          }
        }
      }

      const points = getEditablePoints(commands);
      const hit = findPointAtScreenPos(points, pos.x, pos.y, mapper.glyphToScreen);

      if (hit) {
        // Double-click on-curve point: toggle smooth/corner
        if (e.detail === 2 && hit.field === 'end') {
          onCornerPointsChange(hit.commandIndex);
          return;
        }

        const isAlreadySelected = selectedSet.has(pointKey(hit));

        if (e.shiftKey) {
          if (isAlreadySelected) {
            onSelectedPointsChange(selectedPoints.filter((p) => pointKey(p) !== pointKey(hit)));
          } else {
            onSelectedPointsChange([...selectedPoints, hit]);
          }
        } else {
          if (!isAlreadySelected) {
            onSelectedPointsChange([hit]);
          }
          onDragStart();
          const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
          dragStartGlyphRef.current = glyphPos;
          setIsDragging(true);
        }
      } else {
        const segHit = findSegmentAtScreenPos(commands, pos.x, pos.y, mapper.glyphToScreen);
        if (segHit && e.detail === 2) {
          if (e.shiftKey && onBreakSegment) {
            onBreakSegment(segHit.commandIndex);
          } else {
            onAddPoint(segHit.commandIndex, segHit.t);
          }
          return;
        }
        if (!e.shiftKey) {
          onSelectedPointsChange([]);
        }
        setIsMarquee(true);
        setMarqueeStart(pos);
        setMarqueeEnd(pos);
      }
    },
    [getCanvasPos, getMapper, commands, onDragStart, panX, panY, selectedPoints, selectedSet, onSelectedPointsChange, isSpacePanning, onAddPoint, onBreakSegment, activeTool, onCommandsChange, onCornerPointsChange, contextGlyphs, onSwitchActiveGlyph, font, glyph, selectedContours, onSelectedContoursChange, snapToGrid, componentInstances],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      setCursorPos(pos);

      // Component instance drag
      if (instanceDragRef.current && onMoveInstance) {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const dx = glyphPos.x - instanceDragRef.current.startGlyph.x;
        const dy = glyphPos.y - instanceDragRef.current.startGlyph.y;
        onMoveInstance(
          instanceDragRef.current.instanceIndex,
          instanceDragRef.current.startOffsetX + dx,
          instanceDragRef.current.startOffsetY + dy,
        );
        return;
      }

      // Slice tool drag
      if (activeTool === 'slice' && sliceDragStart) {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const snapped = snapToGrid(glyphPos.x, glyphPos.y);
        setSliceDragCurrent({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
        return;
      }

      // Shape tool drag
      if ((activeTool === 'rect' || activeTool === 'ellipse') && shapeDragStart) {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const snapped = snapToGrid(glyphPos.x, glyphPos.y);
        let gx = Math.round(snapped.x);
        let gy = Math.round(snapped.y);
        shapeDragShiftRef.current = e.shiftKey;
        if (e.shiftKey) {
          const dx = gx - shapeDragStart.x;
          const dy = gy - shapeDragStart.y;
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          gx = shapeDragStart.x + side * Math.sign(dx);
          gy = shapeDragStart.y + side * Math.sign(dy);
        }
        setShapeDragCurrent({ x: gx, y: gy });
        return;
      }

      // Shape select tool drag (move/scale contours)
      if (activeTool === 'shape' && shapeToolDragRef.current && selectedContours.length > 0) {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);

        // Alt+drag: duplicate contours on first significant move
        if (e.altKey && !shapeToolDragRef.current.altDuplicated && !shapeToolDragRef.current.handle) {
          const dx = glyphPos.x - shapeToolDragRef.current.startGlyph.x;
          const dy = glyphPos.y - shapeToolDragRef.current.startGlyph.y;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            onDragStart();
            const duped = extractContours(commands, selectedContours);
            const newCommands = [...commands, ...duped];
            const newRanges = getContourRanges(newCommands);
            const oldRangeCount = getContourRanges(commands).length;
            const dupedIndices = Array.from({ length: newRanges.length - oldRangeCount }, (_, i) => oldRangeCount + i);
            onCommandsChange(newCommands);
            onSelectedContoursChange(dupedIndices);
            setShapeToolDrag(prev => prev ? {
              ...prev,
              currentGlyph: { x: glyphPos.x, y: glyphPos.y },
              altDuplicated: true,
            } : null);
            return;
          }
        }

        // Snap guides for move operations (no handle = pure translation)
        if (!shapeToolDragRef.current.handle) {
          const rawDx = glyphPos.x - shapeToolDragRef.current.startGlyph.x;
          const rawDy = glyphPos.y - shapeToolDragRef.current.startGlyph.y;

          const ranges = getContourRanges(commands);
          let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
          for (const ci of selectedContours) {
            if (ci < 0 || ci >= ranges.length) continue;
            const b = getContourBounds(commands, ci);
            if (b.minX < bMinX) bMinX = b.minX;
            if (b.minY < bMinY) bMinY = b.minY;
            if (b.maxX > bMaxX) bMaxX = b.maxX;
            if (b.maxY > bMaxY) bMaxY = b.maxY;
          }

          const movedBounds = {
            minX: bMinX + rawDx,
            minY: bMinY + rawDy,
            maxX: bMaxX + rawDx,
            maxY: bMaxY + rawDy,
          };

          const advW = glyph.advanceWidth || 0;
          const snap = computeSnapGuides(movedBounds, commands, selectedContours, advW);
          setSnapGuides(snap.guides);

          const snappedX = glyphPos.x + snap.snapDx;
          const snappedY = glyphPos.y + snap.snapDy;
          setShapeToolDrag(prev => prev ? { ...prev, currentGlyph: { x: snappedX, y: snappedY } } : null);
        } else {
          const handleId = shapeToolDragRef.current.handle!;
          const isScale = !handleId.startsWith('skew_') && handleId !== 'rotate';

          if (isScale) {
            const ranges = getContourRanges(commands);
            let origMinX = Infinity, origMinY = Infinity, origMaxX = -Infinity, origMaxY = -Infinity;
            for (const ci of selectedContours) {
              if (ci < 0 || ci >= ranges.length) continue;
              const b = getContourBounds(commands, ci);
              if (b.minX < origMinX) origMinX = b.minX;
              if (b.minY < origMinY) origMinY = b.minY;
              if (b.maxX > origMaxX) origMaxX = b.maxX;
              if (b.maxY > origMaxY) origMaxY = b.maxY;
            }

            if (isFinite(origMinX)) {
              const rawDx = glyphPos.x - shapeToolDragRef.current.startGlyph.x;
              const rawDy = glyphPos.y - shapeToolDragRef.current.startGlyph.y;

              const movingEdgesX: number[] = [];
              if (handleId.includes('r')) movingEdgesX.push(origMaxX + rawDx);
              if (handleId.includes('l')) movingEdgesX.push(origMinX + rawDx);

              const movingEdgesY: number[] = [];
              if (handleId.includes('t')) movingEdgesY.push(origMaxY + rawDy);
              if (handleId.includes('b')) movingEdgesY.push(origMinY + rawDy);

              const mapper = getMapper();
              const thresh = SNAP_THRESHOLD_PX / mapper.scale;
              const advW = glyph.advanceWidth || 0;

              const candX: { pos: number; extMin: number; extMax: number }[] = [];
              const candY: { pos: number; extMin: number; extMax: number }[] = [];
              const draggedSet = new Set(selectedContours);

              for (let ci = 0; ci < ranges.length; ci++) {
                if (draggedSet.has(ci)) continue;
                const b = getContourBounds(commands, ci);
                if (!isFinite(b.minX)) continue;
                const cx = (b.minX + b.maxX) / 2;
                const cy = (b.minY + b.maxY) / 2;
                candX.push({ pos: b.minX, extMin: b.minY, extMax: b.maxY });
                candX.push({ pos: cx, extMin: b.minY, extMax: b.maxY });
                candX.push({ pos: b.maxX, extMin: b.minY, extMax: b.maxY });
                candY.push({ pos: b.minY, extMin: b.minX, extMax: b.maxX });
                candY.push({ pos: cy, extMin: b.minX, extMax: b.maxX });
                candY.push({ pos: b.maxY, extMin: b.minX, extMax: b.maxX });
              }

              const bigY = 2000;
              candX.push({ pos: 0, extMin: -bigY, extMax: bigY });
              if (advW > 0) candX.push({ pos: advW, extMin: -bigY, extMax: bigY });

              for (const ml of metricLines) {
                if (!ml.visible) continue;
                candY.push({ pos: ml.value, extMin: -bigY, extMax: bigY });
              }
              candY.push({ pos: 0, extMin: -bigY, extMax: bigY });

              if (gridSettings.snapToGrid && gridSettings.spacing > 0) {
                const s = gridSettings.spacing;
                for (const edgeX of movingEdgesX) {
                  const gMin = Math.floor((edgeX - thresh * 2) / s) * s;
                  const gMax = Math.ceil((edgeX + thresh * 2) / s) * s;
                  for (let gx = gMin; gx <= gMax; gx += s) {
                    candX.push({ pos: gx, extMin: -bigY, extMax: bigY });
                  }
                }
                for (const edgeY of movingEdgesY) {
                  const gMin = Math.floor((edgeY - thresh * 2) / s) * s;
                  const gMax = Math.ceil((edgeY + thresh * 2) / s) * s;
                  for (let gy = gMin; gy <= gMax; gy += s) {
                    candY.push({ pos: gy, extMin: -bigY, extMax: bigY });
                  }
                }
              }

              let bestSnapDx = 0, bestDistX = thresh;
              let bestGuideX: SnapGuide | null = null;
              for (const edgeX of movingEdgesX) {
                for (const c of candX) {
                  const dist = Math.abs(edgeX - c.pos);
                  if (dist < bestDistX) {
                    bestDistX = dist;
                    bestSnapDx = c.pos - edgeX;
                    bestGuideX = { axis: 'v', position: c.pos, from: Math.min(c.extMin, origMinY, origMaxY), to: Math.max(c.extMax, origMinY, origMaxY) };
                  }
                }
              }

              let bestSnapDy = 0, bestDistY = thresh;
              let bestGuideY: SnapGuide | null = null;
              for (const edgeY of movingEdgesY) {
                for (const c of candY) {
                  const dist = Math.abs(edgeY - c.pos);
                  if (dist < bestDistY) {
                    bestDistY = dist;
                    bestSnapDy = c.pos - edgeY;
                    bestGuideY = { axis: 'h', position: c.pos, from: Math.min(c.extMin, origMinX, origMaxX), to: Math.max(c.extMax, origMinX, origMaxX) };
                  }
                }
              }

              const guides: SnapGuide[] = [];
              if (bestGuideX) guides.push(bestGuideX);
              if (bestGuideY) guides.push(bestGuideY);
              setSnapGuides(guides);

              const snappedX = glyphPos.x + bestSnapDx;
              const snappedY = glyphPos.y + bestSnapDy;
              setShapeToolDrag(prev => prev ? { ...prev, currentGlyph: { x: snappedX, y: snappedY } } : null);
            } else {
              setSnapGuides([]);
              setShapeToolDrag(prev => prev ? { ...prev, currentGlyph: { x: glyphPos.x, y: glyphPos.y } } : null);
            }
          } else {
            setSnapGuides([]);
            setShapeToolDrag(prev => prev ? { ...prev, currentGlyph: { x: glyphPos.x, y: glyphPos.y } } : null);
          }
        }
        return;
      }

      if (activeTool === 'pen') {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        let snapped = snapToGrid(glyphPos.x, glyphPos.y);

        if (penDragRef.current) {
          const downPt = penDragRef.current.glyph;
          let dragTarget = { x: Math.round(glyphPos.x), y: Math.round(glyphPos.y) };
          if (e.shiftKey) {
            dragTarget = constrainToAxis(downPt, dragTarget);
            dragTarget = { x: Math.round(dragTarget.x), y: Math.round(dragTarget.y) };
          }
          setPenDragState({ downGlyph: downPt, currentGlyph: dragTarget });
          setPenCursorGlyph(dragTarget);
          setPenSegmentSnap(null);
        } else {
          if (e.shiftKey && penStateRef.current) {
            let lastPt: { x: number; y: number } | null = null;
            for (let i = commands.length - 1; i >= 0; i--) {
              const c = commands[i];
              if (c.type !== 'Z' && c.x !== undefined && c.y !== undefined) {
                lastPt = { x: c.x, y: c.y };
                break;
              }
            }
            if (lastPt) {
              snapped = constrainToAxis(lastPt, snapped);
            }
          }
          setPenCursorGlyph({ x: snapped.x, y: snapped.y });

          // Show snap indicator when hovering over an existing segment (not actively drawing)
          if (!penStateRef.current && commands.length > 0) {
            const editPts = getEditablePoints(commands);
            const hitPt = findPointAtScreenPos(editPts, pos.x, pos.y, mapper.glyphToScreen.bind(mapper));
            if (!hitPt) {
              const segHit = findSegmentAtScreenPos(commands, pos.x, pos.y, mapper.glyphToScreen.bind(mapper));
              if (segHit) {
                const cmd = commands[segHit.commandIndex];
                let prevX = 0, prevY = 0;
                for (let si = segHit.commandIndex - 1; si >= 0; si--) {
                  const sc = commands[si];
                  if (sc.x !== undefined && sc.y !== undefined) { prevX = sc.x; prevY = sc.y; break; }
                }
                let snapX: number, snapY: number;
                const t = segHit.t;
                if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
                  snapX = prevX + t * (cmd.x - prevX);
                  snapY = prevY + t * (cmd.y - prevY);
                } else if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
                  const u = 1 - t;
                  snapX = u * u * prevX + 2 * u * t * cmd.x1 + t * t * cmd.x;
                  snapY = u * u * prevY + 2 * u * t * cmd.y1 + t * t * cmd.y;
                } else if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
                  const u = 1 - t;
                  snapX = u * u * u * prevX + 3 * u * u * t * cmd.x1 + 3 * u * t * t * cmd.x2 + t * t * t * cmd.x;
                  snapY = u * u * u * prevY + 3 * u * u * t * cmd.y1 + 3 * u * t * t * cmd.y2 + t * t * t * cmd.y;
                } else {
                  snapX = glyphPos.x; snapY = glyphPos.y;
                }
                setPenSegmentSnap({ x: snapX, y: snapY });
              } else {
                setPenSegmentSnap(null);
              }
            } else {
              setPenSegmentSnap(null);
            }
          } else {
            setPenSegmentSnap(null);
          }
        }
      }

      if (isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        onPanChange(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
        return;
      }

      if (isMarquee && marqueeStart) {
        setMarqueeEnd(pos);
        return;
      }

      if (isDragging && selectedPoints.length > 0 && dragStartGlyphRef.current) {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(pos.x, pos.y);
        const snapped = snapToGrid(glyphPos.x, glyphPos.y);
        const dx = Math.round(snapped.x - dragStartGlyphRef.current.x);
        const dy = Math.round(snapped.y - dragStartGlyphRef.current.y);

        if (dx === 0 && dy === 0) return;

        const newCommands = commands.map((cmd) => ({ ...cmd }));
        const updatedPoints: EditablePoint[] = [];

        // Mirror drag: Alt + drag with 2+ on-curve endpoints spreads/contracts
        // points symmetrically around their centroid.
        // Each point's delta sign is based on which side of the centroid it's on,
        // so dragging right spreads horizontally, dragging left contracts.
        // Hold Shift to constrain movement along the axis between the points.
        const onCurveEndpoints = selectedPoints.filter(p => p.field === 'end' && p.isOnCurve);
        const mirrorDrag = e.altKey && onCurveEndpoints.length >= 2;

        let centroidX = 0;
        let centroidY = 0;
        let mirrorDx = dx;
        let mirrorDy = dy;
        if (mirrorDrag) {
          for (const ep of onCurveEndpoints) {
            centroidX += ep.x;
            centroidY += ep.y;
          }
          centroidX /= onCurveEndpoints.length;
          centroidY /= onCurveEndpoints.length;

          // Shift: constrain drag to the axis between the points
          if (e.shiftKey && onCurveEndpoints.length === 2) {
            const axX = onCurveEndpoints[1].x - onCurveEndpoints[0].x;
            const axY = onCurveEndpoints[1].y - onCurveEndpoints[0].y;
            const axLen = Math.sqrt(axX * axX + axY * axY);
            if (axLen > 0) {
              const nx = axX / axLen;
              const ny = axY / axLen;
              const proj = dx * nx + dy * ny;
              mirrorDx = Math.round(proj * nx);
              mirrorDy = Math.round(proj * ny);
            }
          } else if (e.shiftKey) {
            // 3+ points: constrain to nearest 45° axis
            if (Math.abs(dx) > Math.abs(dy)) mirrorDy = 0;
            else mirrorDx = 0;
          }
        }

        for (const pt of selectedPoints) {
          const cmd = { ...newCommands[pt.commandIndex] };

          let ptDx = dx;
          let ptDy = dy;

          if (mirrorDrag && pt.field === 'end' && pt.isOnCurve) {
            const sx = Math.sign(pt.x - centroidX) || 1;
            const sy = Math.sign(pt.y - centroidY) || 1;
            ptDx = mirrorDx * sx;
            ptDy = mirrorDy * sy;
          }

          if (pt.field === 'end' && cmd.x !== undefined && cmd.y !== undefined) {
            cmd.x += ptDx;
            cmd.y += ptDy;
            updatedPoints.push({ ...pt, x: cmd.x, y: cmd.y });
          } else if (pt.field === 'cp1' && cmd.x1 !== undefined && cmd.y1 !== undefined) {
            cmd.x1 += ptDx;
            cmd.y1 += ptDy;
            updatedPoints.push({ ...pt, x: cmd.x1, y: cmd.y1 });
          } else if (pt.field === 'cp2' && cmd.x2 !== undefined && cmd.y2 !== undefined) {
            cmd.x2 += ptDx;
            cmd.y2 += ptDy;
            updatedPoints.push({ ...pt, x: cmd.x2, y: cmd.y2 });
          } else {
            updatedPoints.push(pt);
          }
          newCommands[pt.commandIndex] = cmd;
        }

        // Linked handle behavior for smooth points
        // Hold Option/Alt to break the link and move handles independently
        const breakLink = e.altKey;
        if (breakLink) {
          const toBreak: number[] = [];
          for (const pt of updatedPoints) {
            if (pt.field === 'end') continue;
            const endpointIdx = pt.field === 'cp2' ? pt.commandIndex : pt.commandIndex - 1;
            if (endpointIdx >= 0 && endpointIdx < newCommands.length && !brokenLinksRef.current.has(endpointIdx)) {
              toBreak.push(endpointIdx);
              brokenLinksRef.current.add(endpointIdx);
            }
          }
          if (toBreak.length > 0) {
            onSetCornerPoints(toBreak);
          }
        }

        if (!breakLink) {
          for (const pt of updatedPoints) {
            if (pt.field === 'end') continue;

            const endpointIdx = pt.field === 'cp2' ? pt.commandIndex : pt.commandIndex - 1;
            if (endpointIdx < 0 || endpointIdx >= newCommands.length) continue;

            const endCmd = newCommands[endpointIdx];
            if (!endCmd || endCmd.x === undefined || endCmd.y === undefined) continue;
            if (cornerPoints.has(endpointIdx)) continue;

            const cmdType = newCommands[endpointIdx]?.type;
            const nextCmd = endpointIdx + 1 < newCommands.length ? newCommands[endpointIdx + 1] : null;
            if (!(cmdType === 'Q' || cmdType === 'C') && !(nextCmd && (nextCmd.type === 'Q' || nextCmd.type === 'C'))) continue;

            let linkedCmdIdx: number;
            let linkedField: 'cp1' | 'cp2';

            if (pt.field === 'cp2') {
              linkedCmdIdx = pt.commandIndex + 1;
              if (linkedCmdIdx >= newCommands.length) continue;
              const lCmd = newCommands[linkedCmdIdx];
              if (lCmd.type !== 'Q' && lCmd.type !== 'C') continue;
              linkedField = 'cp1';
            } else {
              linkedCmdIdx = pt.commandIndex - 1;
              if (linkedCmdIdx < 0) continue;
              const lCmd = newCommands[linkedCmdIdx];
              if (lCmd.type === 'C') linkedField = 'cp2';
              else if (lCmd.type === 'Q') linkedField = 'cp1';
              else continue;
            }

            if (updatedPoints.some((p) => p.commandIndex === linkedCmdIdx && p.field === linkedField)) continue;

            const linkedCmd = { ...newCommands[linkedCmdIdx] };
            const linkedX = linkedField === 'cp1' ? linkedCmd.x1 : linkedCmd.x2;
            const linkedY = linkedField === 'cp1' ? linkedCmd.y1 : linkedCmd.y2;
            if (linkedX === undefined || linkedY === undefined) continue;

            const epX = endCmd.x;
            const epY = endCmd.y;
            const angle = Math.atan2(pt.y - epY, pt.x - epX);
            const mirrorAngle = angle + Math.PI;
            const linkedLen = Math.sqrt((linkedX - epX) ** 2 + (linkedY - epY) ** 2);

            if (linkedField === 'cp1') {
              linkedCmd.x1 = Math.round(epX + Math.cos(mirrorAngle) * linkedLen);
              linkedCmd.y1 = Math.round(epY + Math.sin(mirrorAngle) * linkedLen);
            } else {
              linkedCmd.x2 = Math.round(epX + Math.cos(mirrorAngle) * linkedLen);
              linkedCmd.y2 = Math.round(epY + Math.sin(mirrorAngle) * linkedLen);
            }
            newCommands[linkedCmdIdx] = linkedCmd;
          }
        }

        dragStartGlyphRef.current = snapped;
        onSelectedPointsChange(updatedPoints);
        onCommandsChange(newCommands);
        return;
      }

      const mapper = getMapper();
      const points = getEditablePoints(commands);
      const hit = findPointAtScreenPos(points, pos.x, pos.y, mapper.glyphToScreen);
      setHoveredPoint(hit);
    },
    [getCanvasPos, getMapper, commands, isPanning, isDragging, isMarquee, marqueeStart, selectedPoints, onCommandsChange, onPanChange, onSelectedPointsChange, snapToGrid, cornerPoints, activeTool, constrainToAxis, onSetCornerPoints, shapeDragStart, sliceDragStart, selectedContours, onDragStart, onSelectedContoursChange, onMoveInstance, computeSnapGuides, glyph, metricLines, gridSettings],
  );

  const KAPPA = 0.5522847498;

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Component instance drag release
      if (instanceDragRef.current) {
        setInstanceDrag(null);
        return;
      }

      // Slice tool finalization
      if (activeTool === 'slice' && sliceDragStart && sliceDragCurrent && onSlice) {
        const dx = sliceDragCurrent.x - sliceDragStart.x;
        const dy = sliceDragCurrent.y - sliceDragStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 5) {
          onSlice(sliceDragStart.x, sliceDragStart.y, sliceDragCurrent.x, sliceDragCurrent.y);
        }
        setSliceDragStart(null);
        setSliceDragCurrent(null);
        return;
      }

      // Shape tool finalization
      if ((activeTool === 'rect' || activeTool === 'ellipse') && shapeDragStart) {
        const mapper = getMapper();
        const glyphPos = mapper.screenToGlyph(getCanvasPos(e).x, getCanvasPos(e).y);
        const snapped = snapToGrid(glyphPos.x, glyphPos.y);
        let endX = Math.round(snapped.x);
        let endY = Math.round(snapped.y);
        if (shapeDragShiftRef.current || e.shiftKey) {
          const dx = endX - shapeDragStart.x;
          const dy = endY - shapeDragStart.y;
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          endX = shapeDragStart.x + side * Math.sign(dx);
          endY = shapeDragStart.y + side * Math.sign(dy);
        }

        const x1 = Math.min(shapeDragStart.x, endX);
        const y1 = Math.min(shapeDragStart.y, endY);
        const x2 = Math.max(shapeDragStart.x, endX);
        const y2 = Math.max(shapeDragStart.y, endY);

        if (Math.abs(x2 - x1) > 2 && Math.abs(y2 - y1) > 2) {
          onDragStart();
          const newCmds: PathCommand[] = [];

          if (activeTool === 'rect') {
            newCmds.push(
              { type: 'M', x: x1, y: y2 },
              { type: 'L', x: x2, y: y2 },
              { type: 'L', x: x2, y: y1 },
              { type: 'L', x: x1, y: y1 },
              { type: 'Z' },
            );
          } else {
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;
            const rx = (x2 - x1) / 2;
            const ry = (y2 - y1) / 2;
            const kx = rx * KAPPA;
            const ky = ry * KAPPA;
            newCmds.push(
              { type: 'M', x: Math.round(cx), y: Math.round(cy + ry) },
              { type: 'C', x1: Math.round(cx + kx), y1: Math.round(cy + ry), x2: Math.round(cx + rx), y2: Math.round(cy + ky), x: Math.round(cx + rx), y: Math.round(cy) },
              { type: 'C', x1: Math.round(cx + rx), y1: Math.round(cy - ky), x2: Math.round(cx + kx), y2: Math.round(cy - ry), x: Math.round(cx), y: Math.round(cy - ry) },
              { type: 'C', x1: Math.round(cx - kx), y1: Math.round(cy - ry), x2: Math.round(cx - rx), y2: Math.round(cy - ky), x: Math.round(cx - rx), y: Math.round(cy) },
              { type: 'C', x1: Math.round(cx - rx), y1: Math.round(cy + ky), x2: Math.round(cx - kx), y2: Math.round(cy + ry), x: Math.round(cx), y: Math.round(cy + ry) },
              { type: 'Z' },
            );
          }

          onCommandsChange([...commands, ...newCmds]);
        }

        setShapeDragStart(null);
        setShapeDragCurrent(null);
        return;
      }

      // Shape select tool finalization (move/scale/rotate/skew)
      if (activeTool === 'shape' && shapeToolDragRef.current && selectedContours.length > 0) {
        const drag = shapeToolDragRef.current;
        const dx = drag.currentGlyph.x - drag.startGlyph.x;
        const dy = drag.currentGlyph.y - drag.startGlyph.y;

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          onDragStart();

          if (drag.handle === 'rotate') {
            // Rotation
            let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
            for (const ci of selectedContours) {
              const b = getContourBounds(commands, ci);
              if (b.minX < allMinX) allMinX = b.minX;
              if (b.minY < allMinY) allMinY = b.minY;
              if (b.maxX > allMaxX) allMaxX = b.maxX;
              if (b.maxY > allMaxY) allMaxY = b.maxY;
            }
            const cx = (allMinX + allMaxX) / 2, cy = (allMinY + allMaxY) / 2;
            const startAngle = Math.atan2(drag.startGlyph.y - cy, drag.startGlyph.x - cx);
            const curAngle = Math.atan2(drag.currentGlyph.y - cy, drag.currentGlyph.x - cx);
            let angleDeg = ((curAngle - startAngle) * 180) / Math.PI;
            if (e.shiftKey) angleDeg = Math.round(angleDeg / 15) * 15;
            const newCmds = rotateContourCommands(commands, selectedContours, angleDeg, cx, cy);
            onCommandsChange(newCmds);
          } else if (drag.handle?.startsWith('skew_')) {
            // Skew
            let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
            for (const ci of selectedContours) {
              const b = getContourBounds(commands, ci);
              if (b.minX < allMinX) allMinX = b.minX;
              if (b.minY < allMinY) allMinY = b.minY;
              if (b.maxX > allMaxX) allMaxX = b.maxX;
              if (b.maxY > allMaxY) allMaxY = b.maxY;
            }
            const cx = (allMinX + allMaxX) / 2, cy = (allMinY + allMaxY) / 2;
            const bw = allMaxX - allMinX || 1;
            const bh = allMaxY - allMinY || 1;
            const skewId = drag.handle.replace('skew_', '');
            let skewXDeg = 0, skewYDeg = 0;
            if (skewId === 'tc' || skewId === 'bc') {
              skewXDeg = Math.atan2(dx, bh) * (180 / Math.PI);
            } else if (skewId === 'ml' || skewId === 'mr') {
              skewYDeg = Math.atan2(dy, bw) * (180 / Math.PI);
            }
            if (e.shiftKey) {
              skewXDeg = Math.round(skewXDeg / 5) * 5;
              skewYDeg = Math.round(skewYDeg / 5) * 5;
            }
            const newCmds = skewContourCommands(commands, selectedContours, skewXDeg, skewYDeg, cx, cy);
            onCommandsChange(newCmds);
          } else if (drag.handle) {
            // Scale operation
            let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
            for (const ci of selectedContours) {
              const b = getContourBounds(commands, ci);
              if (b.minX < allMinX) allMinX = b.minX;
              if (b.minY < allMinY) allMinY = b.minY;
              if (b.maxX > allMaxX) allMaxX = b.maxX;
              if (b.maxY > allMaxY) allMaxY = b.maxY;
            }
            const bw = allMaxX - allMinX || 1;
            const bh = allMaxY - allMinY || 1;

            let anchorX = allMinX, anchorY = allMinY;
            let sx = 1, sy = 1;

            if (drag.handle.includes('r')) { anchorX = allMinX; sx = (bw + dx) / bw; }
            else if (drag.handle.includes('l')) { anchorX = allMaxX; sx = (bw - dx) / bw; }
            if (drag.handle.includes('b')) { anchorY = allMaxY; sy = (bh - dy) / bh; }
            else if (drag.handle.includes('t')) { anchorY = allMinY; sy = (bh + dy) / bh; }

            if (e.shiftKey) {
              const uniform = Math.max(Math.abs(sx), Math.abs(sy));
              sx = uniform * Math.sign(sx || 1);
              sy = uniform * Math.sign(sy || 1);
            }

            if (drag.handle === 'tc' || drag.handle === 'bc') sx = 1;
            if (drag.handle === 'ml' || drag.handle === 'mr') sy = 1;

            const newCmds = scaleContourCommands(commands, selectedContours, sx, sy, anchorX, anchorY);
            onCommandsChange(newCmds);
          } else if (drag.altDuplicated) {
            const newCmds = translateContourCommands(commands, selectedContours, Math.round(dx), Math.round(dy));
            onCommandsChange(newCmds);
          } else if (e.altKey && !drag.altDuplicated) {
            const duped = extractContours(commands, selectedContours);
            const ranges = getContourRanges(commands);
            const newCommands = [...commands, ...duped];
            const newRanges = getContourRanges(newCommands);
            const dupedIndices = Array.from({ length: newRanges.length - ranges.length }, (_, i) => ranges.length + i);
            const translated = translateContourCommands(newCommands, dupedIndices, Math.round(dx), Math.round(dy));
            onCommandsChange(translated);
            onSelectedContoursChange(dupedIndices);
          } else {
            const newCmds = translateContourCommands(commands, selectedContours, Math.round(dx), Math.round(dy));
            onCommandsChange(newCmds);
          }
        }

        setShapeToolDrag(null);
        setSnapGuides([]);
        return;
      }

      // Pen tool finalization
      if (activeTool === 'pen' && penDragRef.current) {
        const pos = getCanvasPos(e);
        const mapper = getMapper();
        let upGlyph = mapper.screenToGlyph(pos.x, pos.y);
        const downGlyph = penDragRef.current.glyph;
        penDragRef.current = null;
        setPenDragState(null);

        // Shift-constrain the handle direction relative to the anchor
        if (e.shiftKey) {
          upGlyph = constrainToAxis(downGlyph, upGlyph);
        }

        const dragDx = upGlyph.x - downGlyph.x;
        const dragDy = upGlyph.y - downGlyph.y;
        const isDrag = Math.sqrt(dragDx * dragDx + dragDy * dragDy) > 5;

        // Shift-constrain the anchor point relative to the last placed point
        let ptX = Math.round(downGlyph.x);
        let ptY = Math.round(downGlyph.y);
        if (e.shiftKey && penStateRef.current) {
          const lastCmd = commands[commands.length - 1];
          if (lastCmd?.x !== undefined && lastCmd?.y !== undefined) {
            const constrained = constrainToAxis(
              { x: lastCmd.x, y: lastCmd.y },
              { x: ptX, y: ptY },
            );
            ptX = Math.round(constrained.x);
            ptY = Math.round(constrained.y);
          }
        }

        if (!penStateRef.current) {
          onDragStart();
          onCommandsChange([...commands, { type: 'M', x: ptX, y: ptY }]);
          penStateRef.current = {
            contourStartIdx: commands.length,
            outgoingHandle: isDrag ? { x: Math.round(upGlyph.x), y: Math.round(upGlyph.y) } : null,
          };
        } else {
          onDragStart();
          const lastCmd = commands[commands.length - 1];
          const prevX = lastCmd?.x ?? 0;
          const prevY = lastCmd?.y ?? 0;

          if (isDrag || penStateRef.current.outgoingHandle) {
            const cp1 = penStateRef.current.outgoingHandle ?? {
              x: prevX,
              y: prevY,
            };
            const cp2 = isDrag
              ? { x: Math.round(2 * ptX - upGlyph.x), y: Math.round(2 * ptY - upGlyph.y) }
              : { x: ptX, y: ptY };

            onCommandsChange([
              ...commands,
              { type: 'C', x1: cp1.x, y1: cp1.y, x2: cp2.x, y2: cp2.y, x: ptX, y: ptY },
            ]);
            penStateRef.current.outgoingHandle = isDrag
              ? { x: Math.round(upGlyph.x), y: Math.round(upGlyph.y) }
              : null;
          } else {
            onCommandsChange([...commands, { type: 'L', x: ptX, y: ptY }]);
            penStateRef.current.outgoingHandle = null;
          }
        }
        return;
      }

      if (isMarquee && marqueeStart && marqueeEnd) {
        const mapper = getMapper();
        const points = getEditablePoints(commands);
        const inRect = findPointsInRect(
          points,
          marqueeStart.x, marqueeStart.y,
          marqueeEnd.x, marqueeEnd.y,
          mapper.glyphToScreen,
        );
        if (inRect.length > 0) {
          if (e.shiftKey) {
            const existing = new Set(selectedPoints.map(pointKey));
            const merged = [...selectedPoints, ...inRect.filter((p) => !existing.has(pointKey(p)))];
            onSelectedPointsChange(merged);
          } else {
            onSelectedPointsChange(inRect);
          }
        }
      }

      panStartRef.current = null;
      dragStartGlyphRef.current = null;
      brokenLinksRef.current.clear();
      setIsDragging(false);
      setIsPanning(false);
      setIsMarquee(false);
      setMarqueeStart(null);
      setMarqueeEnd(null);
    },
    [isMarquee, marqueeStart, marqueeEnd, getMapper, commands, selectedPoints, onSelectedPointsChange, activeTool, getCanvasPos, onDragStart, onCommandsChange, constrainToAxis, shapeDragStart, sliceDragStart, sliceDragCurrent, snapToGrid, selectedContours, onSelectedContoursChange, onSlice],
  );

  const handleMouseLeave = useCallback(() => {
    panStartRef.current = null;
    dragStartGlyphRef.current = null;
    brokenLinksRef.current.clear();
    setIsDragging(false);
    setIsPanning(false);
    setIsMarquee(false);
    setMarqueeStart(null);
    setMarqueeEnd(null);
    setCursorPos(null);
    setPenCursorGlyph(null);
    setPenSegmentSnap(null);
    setPenDragState(null);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const mapper = getMapper();
      const glyphAtCursor = mapper.screenToGlyph(pos.x, pos.y);

      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.max(0.1, Math.min(10, zoom * factor));

      const newMapper = createCoordMapper(
        canvasSize.width,
        canvasSize.height,
        font.unitsPerEm,
        newZoom,
        panX,
        panY,
        font.ascender,
      );
      const newScreen = newMapper.glyphToScreen(glyphAtCursor.x, glyphAtCursor.y);

      const panDx = pos.x - newScreen.x;
      const panDy = pos.y - newScreen.y;

      onZoomChange(newZoom);
      onPanChange(panX + panDx, panY + panDy);
    },
    [zoom, panX, panY, getCanvasPos, getMapper, onZoomChange, onPanChange, canvasSize, font],
  );

  const cursorStyle = isPanning || isSpacePanning
    ? (isPanning ? 'grabbing' : 'grab')
    : (activeTool === 'pen' || activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'slice')
      ? 'crosshair'
      : activeTool === 'shape'
        ? (shapeToolDrag ? 'grabbing' : 'default')
        : hoveredPoint
          ? 'pointer'
        : isDragging
          ? 'grabbing'
          : 'crosshair';

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (!rect) return;
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      const scaleX = rect.width > 0 ? canvasSize.width / rect.width : 1;
      const scaleY = rect.height > 0 ? canvasSize.height / rect.height : 1;
      const pos = { x: rawX * scaleX, y: rawY * scaleY };
      const mapper = getMapper();
      const glyphPos = mapper.screenToGlyph(pos.x, pos.y);

      let hitInstance: number | null = null;
      for (let i = 0; i < componentInstances.length; i++) {
        const inst = componentInstances[i];
        const b = inst.bounds;
        if (glyphPos.x >= b.minX && glyphPos.x <= b.maxX && glyphPos.y >= b.minY && glyphPos.y <= b.maxY) {
          hitInstance = i;
          break;
        }
      }

      const hasSelection = selectedContours.length > 0 || selectedPoints.length > 0;
      const segHit = findSegmentAtScreenPos(commands, pos.x, pos.y, mapper.glyphToScreen);
      setContextMenu({
        x: rawX,
        y: rawY,
        glyphX: glyphPos.x,
        glyphY: glyphPos.y,
        hasSelection,
        instanceIndex: hitInstance,
        segmentCommandIndex: segHit ? segHit.commandIndex : null,
      });
    },
    [getMapper, componentInstances, selectedContours, selectedPoints, commands, canvasSize],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div className="glyph-editor" ref={containerRef}>
      <canvas
        ref={canvasRef}
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          cursor: cursorStyle,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />
      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.segmentCommandIndex !== null && onBreakSegment && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                onBreakSegment(contextMenu.segmentCommandIndex!);
                closeContextMenu();
              }}
            >Break Segment</button>
          )}
          {contextMenu.hasSelection && onReverseContour && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                onReverseContour();
                closeContextMenu();
              }}
            >Reverse Contour Direction</button>
          )}
          {contextMenu.hasSelection && onMakeCutout && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                onMakeCutout();
                closeContextMenu();
              }}
            >Make Cutout (Hole)</button>
          )}
          {contextMenu.hasSelection && onMakeFill && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                onMakeFill();
                closeContextMenu();
              }}
            >Make Fill (Solid)</button>
          )}
          {contextMenu.hasSelection && onMakeIndent && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                onMakeIndent();
                closeContextMenu();
              }}
            >Make Indent (Clip to Fill)</button>
          )}
          {contextMenu.hasSelection && (onReverseContour || onMakeCutout) && <div className="ctx-menu-divider" />}
          {contextMenu.hasSelection && onCreateComponentFromSelection && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                const contourIdxs = selectedContours.length > 0
                  ? selectedContours
                  : (() => {
                      const ranges = getContourRanges(commands);
                      const pts = selectedPoints;
                      const found = new Set<number>();
                      for (const pt of pts) {
                        const ci = ranges.findIndex(r => pt.commandIndex >= r.start && pt.commandIndex <= r.end);
                        if (ci >= 0) found.add(ci);
                      }
                      return Array.from(found);
                    })();
                onCreateComponentFromSelection(contourIdxs);
                closeContextMenu();
              }}
            >Create Component from Selection</button>
          )}
          {contextMenu.instanceIndex !== null && onDecomposeInstance && (
            <button
              className="ctx-menu-item"
              onClick={() => {
                onDecomposeInstance(contextMenu.instanceIndex!);
                closeContextMenu();
              }}
            >Decompose Component</button>
          )}
          {onInsertComponentById && availableComponents.length > 0 && (
            <>
              <div className="ctx-menu-label">Add Component:</div>
              {availableComponents.map(c => (
                <button
                  key={c.id}
                  className="ctx-menu-item"
                  onClick={() => {
                    onInsertComponentById(c.id, contextMenu.glyphX, contextMenu.glyphY);
                    closeContextMenu();
                  }}
                >{c.name}</button>
              ))}
            </>
          )}
          {onInsertComponentById && availableComponents.length === 0 && (
            <button className="ctx-menu-item" disabled style={{ opacity: 0.5 }}>
              No components yet
            </button>
          )}
          <button className="ctx-menu-item ctx-menu-cancel" onClick={closeContextMenu}>Cancel</button>
        </div>
      )}
      <div className="editor-info">
        <span>
          {glyph.name || 'unnamed'} | U+
          {glyph.unicode?.toString(16).toUpperCase().padStart(4, '0') ?? '????'} |
          Width: {glyph.advanceWidth ?? 0} | {commands.length} commands
        </span>
      </div>
    </div>
  );
};
