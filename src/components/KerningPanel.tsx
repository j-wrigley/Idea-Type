import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Font, PathCommand } from 'opentype.js';
import type { KernPair } from '../types';
import type { Theme } from '../App';

interface KerningPanelProps {
  font: Font;
  theme: Theme;
  onFontChanged: () => void;
  onTrackingChange?: (value: number) => void;
  selectedGlyphIndex: number | null;
  commands: PathCommand[];
  onCommandsChange: (cmds: PathCommand[]) => void;
}

function getCommandsBounds(commands: PathCommand[]): { minX: number; maxX: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let hasPoints = false;
  for (const cmd of commands) {
    if (cmd.type === 'Z') continue;
    if ('x' in cmd && cmd.x !== undefined) { minX = Math.min(minX, cmd.x); maxX = Math.max(maxX, cmd.x); hasPoints = true; }
    if ('x1' in cmd && cmd.x1 !== undefined) { minX = Math.min(minX, cmd.x1); maxX = Math.max(maxX, cmd.x1); }
    if ('x2' in cmd && cmd.x2 !== undefined) { minX = Math.min(minX, cmd.x2); maxX = Math.max(maxX, cmd.x2); }
  }
  return hasPoints ? { minX, maxX } : null;
}

function glyphIndexToChar(font: Font, index: number): string {
  const g = font.glyphs.get(index);
  if (g.unicode !== undefined) return String.fromCodePoint(g.unicode);
  return g.name || `#${index}`;
}

function charToGlyphIndex(font: Font, char: string): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idxFn = (font as any).charToGlyphIndex;
    if (typeof idxFn === 'function') {
      const idx = idxFn.call(font, char) as number;
      if (idx > 0) return idx;
    }
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint > 0) {
      for (let i = 1; i < font.glyphs.length; i++) {
        const g = font.glyphs.get(i);
        if (g.unicode === codePoint) return i;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export const KerningPanel: React.FC<KerningPanelProps> = ({ font, theme, onFontChanged, onTrackingChange, selectedGlyphIndex, commands, onCommandsChange }) => {
  const [pairInput, setPairInput] = useState('AV');
  const [pairFilter, setPairFilter] = useState('');
  const [tracking, setTracking] = useState(0);
  const [sampleText, setSampleText] = useState('AVATAR WAVE');
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(220);
  const bearingCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDraggingKern, setIsDraggingKern] = useState(false);
  const dragStartRef = useRef<{ x: number; startValue: number } | null>(null);
  const [isDraggingBearing, setIsDraggingBearing] = useState<'lsb' | 'rsb' | null>(null);
  const bearingDragRef = useRef<{ x: number; startValue: number } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const kernPairs = useMemo<KernPair[]>(() => {
    if (!font.kerningPairs) return [];
    const pairs: KernPair[] = [];
    for (const key of Object.keys(font.kerningPairs)) {
      const val = font.kerningPairs[key];
      const parts = key.split(',');
      if (parts.length !== 2) continue;
      const left = parseInt(parts[0]);
      const right = parseInt(parts[1]);
      if (isNaN(left) || isNaN(right)) continue;
      pairs.push({
        leftGlyphIndex: left,
        rightGlyphIndex: right,
        leftChar: glyphIndexToChar(font, left),
        rightChar: glyphIndexToChar(font, right),
        value: val,
      });
    }
    pairs.sort((a, b) => a.leftChar.localeCompare(b.leftChar) || a.rightChar.localeCompare(b.rightChar));
    return pairs;
  }, [font, font.kerningPairs, revision]);

  const filteredPairs = useMemo(() => {
    if (!pairFilter) return kernPairs;
    const q = pairFilter.toLowerCase();
    return kernPairs.filter(
      (p) =>
        p.leftChar.toLowerCase().includes(q) ||
        p.rightChar.toLowerCase().includes(q) ||
        `${p.leftChar}${p.rightChar}`.toLowerCase().includes(q),
    );
  }, [kernPairs, pairFilter]);

  const currentPairValue = useMemo(() => {
    if (pairInput.length < 2) return null;
    const left = charToGlyphIndex(font, pairInput[0]);
    const right = charToGlyphIndex(font, pairInput[1]);
    if (left === null || right === null) return null;
    const key = `${left},${right}`;
    const val = font.kerningPairs?.[key] ?? 0;
    return { left, right, value: val };
  }, [font, pairInput, revision]);

  const setKernValue = useCallback(
    (leftIdx: number, rightIdx: number, value: number) => {
      if (!font.kerningPairs) {
        (font as unknown as Record<string, unknown>).kerningPairs = {};
      }
      const key = `${leftIdx},${rightIdx}`;
      if (value === 0) {
        delete font.kerningPairs[key];
      } else {
        font.kerningPairs[key] = value;
      }
      setRevision((r) => r + 1);
      onFontChanged();
    },
    [font, onFontChanged],
  );

  const addPair = useCallback(() => {
    if (pairInput.length < 2) return;
    const left = charToGlyphIndex(font, pairInput[0]);
    const right = charToGlyphIndex(font, pairInput[1]);
    if (left === null || right === null) return;
    setKernValue(left, right, -50);
  }, [font, pairInput, setKernValue]);

  const deletePair = useCallback(
    (leftIdx: number, rightIdx: number) => {
      setKernValue(leftIdx, rightIdx, 0);
    },
    [setKernValue],
  );

  const applyTracking = useCallback(() => {
    if (tracking === 0) return;
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      if (g.advanceWidth !== undefined) {
        g.advanceWidth += tracking;
      }
    }
    setTracking(0);
    onTrackingChange?.(0);
    setRevision((r) => r + 1);
    onFontChanged();
  }, [font, tracking, onFontChanged]);

  const selectedGlyph = useMemo(() => {
    if (selectedGlyphIndex === null) return null;
    return font.glyphs.get(selectedGlyphIndex);
  }, [font, selectedGlyphIndex]);

  const sideBearings = useMemo(() => {
    if (!selectedGlyph || commands.length === 0) return null;
    const bounds = getCommandsBounds(commands);
    if (!bounds) return null;
    const aw = selectedGlyph.advanceWidth ?? 0;
    return {
      lsb: Math.round(bounds.minX),
      rsb: Math.round(aw - bounds.maxX),
      advanceWidth: Math.round(aw),
    };
  }, [selectedGlyph, commands, revision]);

  const handleLSBChange = useCallback((newLSB: number) => {
    if (!selectedGlyph || !sideBearings) return;
    const delta = newLSB - sideBearings.lsb;
    if (delta === 0) return;
    const shifted = commands.map((cmd) => {
      const c = { ...cmd };
      if ('x' in c && c.x !== undefined) c.x += delta;
      if ('x1' in c && c.x1 !== undefined) c.x1 += delta;
      if ('x2' in c && c.x2 !== undefined) c.x2 += delta;
      return c;
    });
    selectedGlyph.advanceWidth = (selectedGlyph.advanceWidth ?? 0) + delta;
    onCommandsChange(shifted);
    setRevision((r) => r + 1);
    onFontChanged();
  }, [selectedGlyph, sideBearings, commands, onCommandsChange, onFontChanged]);

  const handleRSBChange = useCallback((newRSB: number) => {
    if (!selectedGlyph || !sideBearings) return;
    const delta = newRSB - sideBearings.rsb;
    if (delta === 0) return;
    selectedGlyph.advanceWidth = (selectedGlyph.advanceWidth ?? 0) + delta;
    setRevision((r) => r + 1);
    onFontChanged();
  }, [selectedGlyph, sideBearings, onFontChanged]);

  const handleAdvanceWidthChange = useCallback((newAW: number) => {
    if (!selectedGlyph) return;
    selectedGlyph.advanceWidth = newAW;
    setRevision((r) => r + 1);
    onFontChanged();
  }, [selectedGlyph, onFontChanged]);

  const bearingKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLInputElement>,
    current: number,
    handler: (v: number) => void,
  ) => {
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const step = e.key === 'ArrowUp' ? 10 : -10;
      handler(current + step);
    }
  }, []);

  // Bearing canvas preview
  useEffect(() => {
    const canvas = bearingCanvasRef.current;
    if (!canvas || !selectedGlyph || !sideBearings) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerWidth - 32;
    const h = 150;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#111' : '#f0f0f0';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';
    const lsbColor = theme === 'dark' ? 'rgba(255,140,60,0.3)' : 'rgba(230,100,20,0.15)';
    const rsbColor = theme === 'dark' ? 'rgba(100,180,255,0.3)' : 'rgba(40,120,220,0.15)';
    const lsbStroke = theme === 'dark' ? 'rgba(255,140,60,0.8)' : 'rgba(200,80,10,0.7)';
    const rsbStroke = theme === 'dark' ? 'rgba(100,180,255,0.8)' : 'rgba(40,120,220,0.7)';
    const dimColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const labelColor = theme === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    try {
      const aw = selectedGlyph.advanceWidth ?? 0;
      const bounds = getCommandsBounds(commands);
      if (!bounds) return;

      const ascender = font.ascender ?? font.unitsPerEm * 0.8;
      const descender = font.descender ?? -(font.unitsPerEm * 0.2);
      const verticalExtent = ascender - descender;

      const labelPadY = 14;
      const padX = 14;
      const drawW = w - padX * 2;
      const drawH = h - labelPadY * 2;

      const hScale = drawW / Math.max(aw, bounds.maxX - Math.min(0, bounds.minX), 1);
      const vScale = drawH / verticalExtent;
      const scale = Math.min(hScale, vScale);
      const fontSize = font.unitsPerEm * scale;

      const glyphPixelW = Math.max(aw, bounds.maxX - Math.min(0, bounds.minX)) * scale;
      const originX = padX + (drawW - glyphPixelW) / 2 + Math.max(0, -bounds.minX * scale);
      const yBaseline = labelPadY + ascender * scale;

      const awPx = aw * scale;
      const lsbPx = sideBearings.lsb * scale;
      const rsbPx = sideBearings.rsb * scale;

      // LSB zone
      if (Math.abs(lsbPx) > 0.5) {
        ctx.fillStyle = lsbColor;
        const x0 = originX;
        ctx.fillRect(Math.min(x0, x0 + lsbPx), labelPadY, Math.abs(lsbPx), drawH);
      }

      // RSB zone
      if (Math.abs(rsbPx) > 0.5) {
        ctx.fillStyle = rsbColor;
        const rsbStart = originX + awPx - Math.max(0, rsbPx);
        ctx.fillRect(rsbStart, labelPadY, Math.abs(rsbPx), drawH);
      }

      // Origin line
      ctx.strokeStyle = lsbStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(originX, labelPadY - 2);
      ctx.lineTo(originX, h - labelPadY + 2);
      ctx.stroke();

      // Advance width line
      ctx.strokeStyle = rsbStroke;
      ctx.beginPath();
      ctx.moveTo(originX + awPx, labelPadY - 2);
      ctx.lineTo(originX + awPx, h - labelPadY + 2);
      ctx.stroke();

      // Baseline
      ctx.strokeStyle = dimColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padX - 4, yBaseline);
      ctx.lineTo(w - padX + 4, yBaseline);
      ctx.stroke();

      // x-height line (approximate)
      const xHeightRatio = 0.48;
      const xHeightY = yBaseline - font.unitsPerEm * xHeightRatio * scale;
      ctx.beginPath();
      ctx.moveTo(padX - 4, xHeightY);
      ctx.lineTo(w - padX + 4, xHeightY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw the glyph from commands prop (avoids stale glyph.path data during glyph switch)
      ctx.save();
      ctx.translate(originX, yBaseline);
      ctx.scale(scale, -scale);
      ctx.beginPath();
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'M': ctx.moveTo(cmd.x!, cmd.y!); break;
          case 'L': ctx.lineTo(cmd.x!, cmd.y!); break;
          case 'Q': ctx.quadraticCurveTo(cmd.x1!, cmd.y1!, cmd.x!, cmd.y!); break;
          case 'C': ctx.bezierCurveTo(cmd.x1!, cmd.y1!, cmd.x2!, cmd.y2!, cmd.x!, cmd.y!); break;
          case 'Z': ctx.closePath(); break;
        }
      }
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.restore();

      // LSB drag handle
      const handleX = originX + lsbPx;
      ctx.fillStyle = lsbStroke;
      ctx.beginPath();
      ctx.moveTo(handleX, h / 2 - 10);
      ctx.lineTo(handleX + 6, h / 2);
      ctx.lineTo(handleX, h / 2 + 10);
      ctx.closePath();
      ctx.fill();

      // RSB drag handle
      const rsbHandleX = originX + awPx - rsbPx;
      ctx.fillStyle = rsbStroke;
      ctx.beginPath();
      ctx.moveTo(rsbHandleX, h / 2 - 10);
      ctx.lineTo(rsbHandleX - 6, h / 2);
      ctx.lineTo(rsbHandleX, h / 2 + 10);
      ctx.closePath();
      ctx.fill();

      // Top label: advance width
      ctx.font = '9px -apple-system, BlinkMacSystemFont, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = labelColor;
      ctx.fillText(`\u2194 ${sideBearings.advanceWidth}`, originX + awPx / 2, 10);

      // Bottom labels: LSB and RSB
      ctx.fillStyle = lsbStroke;
      const lsbLabelX = originX + lsbPx / 2;
      ctx.fillText(`${sideBearings.lsb}`, lsbLabelX, h - 3);

      ctx.fillStyle = rsbStroke;
      const rsbLabelX = originX + awPx - rsbPx / 2;
      ctx.fillText(`${sideBearings.rsb}`, rsbLabelX, h - 3);
    } catch {
      // ignore render errors
    }
  }, [font, selectedGlyph, sideBearings, commands, theme, containerWidth, revision]);

  const getBearingLayout = useCallback(() => {
    if (!selectedGlyph) return null;
    const bounds = getCommandsBounds(commands);
    if (!bounds) return null;
    const w = containerWidth - 32;
    const h = 150;
    const aw = selectedGlyph.advanceWidth ?? 0;
    const ascender = font.ascender ?? font.unitsPerEm * 0.8;
    const descender = font.descender ?? -(font.unitsPerEm * 0.2);
    const verticalExtent = ascender - descender;
    const labelPadY = 14;
    const padX = 14;
    const drawW = w - padX * 2;
    const drawH = h - labelPadY * 2;
    const hScale = drawW / Math.max(aw, bounds.maxX - Math.min(0, bounds.minX), 1);
    const vScale = drawH / verticalExtent;
    const scale = Math.min(hScale, vScale);
    const glyphPixelW = Math.max(aw, bounds.maxX - Math.min(0, bounds.minX)) * scale;
    const originX = padX + (drawW - glyphPixelW) / 2 + Math.max(0, -bounds.minX * scale);
    return { scale, originX, aw };
  }, [selectedGlyph, commands, containerWidth, font]);

  // Bearing canvas drag interaction
  const handleBearingMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!sideBearings || !selectedGlyph) return;
      const canvas = bearingCanvasRef.current;
      if (!canvas) return;
      const layout = getBearingLayout();
      if (!layout) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const { scale, originX, aw } = layout;

      const lsbEdge = originX + sideBearings.lsb * scale;
      const rsbEdge = originX + aw * scale - sideBearings.rsb * scale;

      const distLSB = Math.abs(mouseX - lsbEdge);
      const distRSB = Math.abs(mouseX - rsbEdge);

      if (distLSB < 14 && distLSB <= distRSB) {
        setIsDraggingBearing('lsb');
        bearingDragRef.current = { x: e.clientX, startValue: sideBearings.lsb };
      } else if (distRSB < 14) {
        setIsDraggingBearing('rsb');
        bearingDragRef.current = { x: e.clientX, startValue: sideBearings.rsb };
      }
    },
    [sideBearings, selectedGlyph, getBearingLayout],
  );

  useEffect(() => {
    if (!isDraggingBearing) return;
    const handleMove = (e: MouseEvent) => {
      if (!bearingDragRef.current || !sideBearings || !selectedGlyph) return;
      const layout = getBearingLayout();
      if (!layout) return;
      const dx = e.clientX - bearingDragRef.current.x;
      const deltaUnits = Math.round(dx / layout.scale);

      if (isDraggingBearing === 'lsb') {
        const newLSB = Math.max(-500, Math.min(500, bearingDragRef.current.startValue + deltaUnits));
        handleLSBChange(newLSB);
      } else {
        const newRSB = Math.max(-500, Math.min(500, bearingDragRef.current.startValue - deltaUnits));
        handleRSBChange(newRSB);
      }
    };
    const handleUp = () => {
      setIsDraggingBearing(null);
      bearingDragRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingBearing, sideBearings, selectedGlyph, getBearingLayout, handleLSBChange, handleRSBChange]);

  // Interactive drag-to-kern on the preview
  const handlePreviewMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!currentPairValue) return;
      setIsDraggingKern(true);
      dragStartRef.current = { x: e.clientX, startValue: currentPairValue.value };
    },
    [currentPairValue],
  );

  useEffect(() => {
    if (!isDraggingKern) return;
    const handleMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !currentPairValue) return;
      const dx = e.clientX - dragStartRef.current.x;
      const scale = font.unitsPerEm / 150;
      const newValue = Math.round(dragStartRef.current.startValue + dx * scale);
      const clamped = Math.max(-500, Math.min(500, newValue));
      setKernValue(currentPairValue.left, currentPairValue.right, clamped);
    };
    const handleUp = () => {
      setIsDraggingKern(false);
      dragStartRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingKern, currentPairValue, font, setKernValue]);

  // Main pair preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || pairInput.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerWidth - 32;
    const h = 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#0a0a0a' : '#f5f5f5';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';
    const dimColor = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    const accentColor = theme === 'dark' ? 'rgba(100,200,255,0.6)' : 'rgba(0,100,200,0.5)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    try {
      const fontSize = 72;
      const text = pairInput.slice(0, 2);
      const scale = fontSize / font.unitsPerEm;

      const leftGlyph = font.charToGlyph(text[0]);
      const rightGlyph = font.charToGlyph(text[1]);
      const leftWidth = (leftGlyph.advanceWidth ?? 0) * scale;
      const rightWidth = (rightGlyph.advanceWidth ?? 0) * scale;
      const kernVal = (currentPairValue?.value ?? 0) * scale;
      const totalWidth = leftWidth + rightWidth + kernVal;
      const xStart = Math.max(8, (w - totalWidth) / 2);
      const yBaseline = h * 0.72;

      // Baseline guide
      ctx.strokeStyle = dimColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yBaseline);
      ctx.lineTo(w, yBaseline);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw left glyph
      const leftPath = leftGlyph.getPath(xStart, yBaseline, fontSize);
      leftPath.fill = fg;
      leftPath.stroke = null;
      leftPath.draw(ctx);

      // Kern gap indicator
      const gapX = xStart + leftWidth;
      const gapW = kernVal;
      if (Math.abs(gapW) > 0.5) {
        ctx.fillStyle = accentColor;
        const drawX = gapW < 0 ? gapX + gapW : gapX;
        ctx.fillRect(drawX, yBaseline - fontSize * 0.7, Math.abs(gapW), fontSize * 0.85);
      }
      // Kern gap center line
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(gapX + gapW / 2, 4);
      ctx.lineTo(gapX + gapW / 2, h - 4);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw right glyph
      const rightPath = rightGlyph.getPath(xStart + leftWidth + kernVal, yBaseline, fontSize);
      rightPath.fill = fg;
      rightPath.stroke = null;
      rightPath.draw(ctx);

      // Kern value badge
      const val = currentPairValue?.value ?? 0;
      ctx.font = '10px -apple-system, BlinkMacSystemFont, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = accentColor;
      ctx.fillText(`${val > 0 ? '+' : ''}${val}`, gapX + gapW / 2, h - 6);
    } catch {
      // ignore render errors
    }
  }, [font, pairInput, theme, containerWidth, currentPairValue, revision]);

  // Sample text canvas
  useEffect(() => {
    const canvas = sampleCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerWidth - 32;
    const h = 48;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#0a0a0a' : '#f5f5f5';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    try {
      const fontSize = 24;
      const path = font.getPath(sampleText || 'Type sample text', 8, h * 0.68, fontSize);
      path.fill = fg;
      path.stroke = null;
      path.draw(ctx);
    } catch {
      // ignore
    }
  }, [font, sampleText, theme, containerWidth, currentPairValue, revision]);

  return (
    <div className="kerning-panel" ref={containerRef}>
      {/* Live pair preview */}
      <div className="panel-section kern-preview-section">
        <div className="kern-pair-entry">
          <input
            type="text"
            className="kern-pair-input"
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value)}
            placeholder="AV"
            maxLength={6}
          />
          <button className="kern-add-btn" onClick={addPair} disabled={pairInput.length < 2} title="Add kerning pair">
            +
          </button>
        </div>
        <canvas
          ref={previewCanvasRef}
          className="kern-preview-canvas"
          onMouseDown={handlePreviewMouseDown}
          style={{ cursor: isDraggingKern ? 'ew-resize' : 'col-resize' }}
          title="Drag left/right to adjust kerning"
        />
        {currentPairValue && (
          <div className="kern-value-control">
            <input
              type="range"
              className="slider-input"
              min={-500}
              max={500}
              step={1}
              value={currentPairValue.value}
              onChange={(e) =>
                setKernValue(currentPairValue.left, currentPairValue.right, parseInt(e.target.value))
              }
            />
            <input
              type="number"
              className="kern-value-num"
              value={currentPairValue.value}
              onChange={(e) =>
                setKernValue(currentPairValue.left, currentPairValue.right, parseInt(e.target.value) || 0)
              }
            />
            {currentPairValue.value !== 0 && (
              <button
                className="slider-reset-btn"
                onClick={() => setKernValue(currentPairValue.left, currentPairValue.right, 0)}
                title="Reset to 0"
              >
                &times;
              </button>
            )}
          </div>
        )}
        {!currentPairValue && pairInput.length >= 2 && (
          <span className="kern-hint">Characters not found in font</span>
        )}
      </div>

      {/* Sample text preview */}
      <div className="panel-section kern-sample-section">
        <input
          type="text"
          className="kern-sample-input"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Sample text..."
        />
        <canvas ref={sampleCanvasRef} className="kern-sample-canvas" />
      </div>

      {/* Global tracking */}
      <div className="panel-section">
        <h3 className="panel-title">Tracking</h3>
        <div className="kern-value-control">
          <input
            type="range"
            className="slider-input"
            min={-200}
            max={200}
            step={1}
            value={tracking}
            onChange={(e) => { const v = parseInt(e.target.value); setTracking(v); onTrackingChange?.(v); }}
          />
          <span className="kern-value-label">{tracking}</span>
          {tracking !== 0 && (
            <button className="slider-reset-btn" onClick={() => { setTracking(0); onTrackingChange?.(0); }} title="Reset">
              &times;
            </button>
          )}
        </div>
        <button className="kern-apply-btn" onClick={applyTracking} disabled={tracking === 0}>
          Apply to All Glyphs
        </button>
      </div>

      {/* Side Bearings */}
      {sideBearings && selectedGlyph && (
        <div className="panel-section bearing-section">
          <h3 className="panel-title">
            Side Bearings
            <span className="bearing-glyph-label">
              {selectedGlyph.unicode !== undefined
                ? String.fromCodePoint(selectedGlyph.unicode)
                : selectedGlyph.name || `#${selectedGlyphIndex}`}
            </span>
          </h3>
          <canvas
            ref={bearingCanvasRef}
            className="bearing-canvas"
            onMouseDown={handleBearingMouseDown}
            style={{ cursor: isDraggingBearing ? 'ew-resize' : 'default' }}
            title="Drag the arrows to adjust side bearings"
          />
          <div className="bearing-controls">
            <div className="bearing-field bearing-field-lsb">
              <label className="bearing-field-label">LSB</label>
              <input
                type="number"
                className="bearing-input"
                value={sideBearings.lsb}
                step={1}
                onChange={(e) => handleLSBChange(parseInt(e.target.value) || 0)}
                onKeyDown={(e) => bearingKeyDown(e, sideBearings.lsb, handleLSBChange)}
              />
            </div>
            <div className="bearing-field bearing-field-width">
              <label className="bearing-field-label">W</label>
              <input
                type="number"
                className="bearing-input"
                value={sideBearings.advanceWidth}
                step={1}
                onChange={(e) => handleAdvanceWidthChange(parseInt(e.target.value) || 0)}
                onKeyDown={(e) => bearingKeyDown(e, sideBearings.advanceWidth, handleAdvanceWidthChange)}
              />
            </div>
            <div className="bearing-field bearing-field-rsb">
              <label className="bearing-field-label">RSB</label>
              <input
                type="number"
                className="bearing-input"
                value={sideBearings.rsb}
                step={1}
                onChange={(e) => handleRSBChange(parseInt(e.target.value) || 0)}
                onKeyDown={(e) => bearingKeyDown(e, sideBearings.rsb, handleRSBChange)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Existing pairs */}
      <div className="panel-section kern-pairs-section">
        <h3 className="panel-title">Pairs ({filteredPairs.length})</h3>
        <input
          type="text"
          className="kern-filter-input"
          placeholder="Filter..."
          value={pairFilter}
          onChange={(e) => setPairFilter(e.target.value)}
        />
        <div className="kern-pair-list">
          {filteredPairs.map((pair) => (
            <div
              key={`${pair.leftGlyphIndex},${pair.rightGlyphIndex}`}
              className={`kern-pair-row ${pairInput === `${pair.leftChar}${pair.rightChar}` ? 'active' : ''}`}
              onClick={() => setPairInput(`${pair.leftChar}${pair.rightChar}`)}
            >
              <span className="kern-pair-chars">{pair.leftChar}{pair.rightChar}</span>
              <input
                type="number"
                className="kern-pair-value-input"
                value={pair.value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  setKernValue(pair.leftGlyphIndex, pair.rightGlyphIndex, parseInt(e.target.value) || 0)
                }
              />
              <button
                className="kern-pair-delete"
                onClick={(e) => { e.stopPropagation(); deletePair(pair.leftGlyphIndex, pair.rightGlyphIndex); }}
                title="Remove pair"
              >
                &times;
              </button>
            </div>
          ))}
          {filteredPairs.length === 0 && (
            <span className="kern-pair-empty">
              {kernPairs.length === 0
                ? 'No kerning pairs yet. Type two characters above and click + to add.'
                : 'No matches.'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
