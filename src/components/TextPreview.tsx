import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Font, PathCommand } from 'opentype.js';
import type { Theme } from '../App';

type PreviewTab = 'type' | 'paragraph' | 'waterfall' | 'grid';

interface TextPreviewProps {
  font: Font;
  theme: Theme;
  fontVersion: number;
  glyphCommands: PathCommand[];
  selectedGlyphIndex: number | null;
  pendingTracking?: number;
}

const DEFAULT_PARAGRAPH =
  'The quick brown fox jumps over the lazy dog. ' +
  'Pack my box with five dozen liquor jugs. ' +
  'How vexingly quick daft zebras jump! ' +
  'The five boxing wizards jump quickly. ' +
  'Sphinx of black quartz, judge my vow.';

const WATERFALL_SIZES = [12, 16, 20, 24, 32, 40, 48, 64, 80, 96];

function drawTextLine(
  ctx: CanvasRenderingContext2D,
  font: Font,
  text: string,
  fontSize: number,
  x: number,
  yBaseline: number,
  fg: string,
  useKerning: boolean,
  pendingTracking: number,
  glyphCommands?: PathCommand[],
  selectedGlyphIndex?: number | null,
): number {
  const scale = fontSize / font.unitsPerEm;
  let cursorX = x;

  for (let i = 0; i < text.length; i++) {
    const glyph = font.charToGlyph(text[i]);
    if (!glyph) continue;

    if (
      glyphCommands &&
      selectedGlyphIndex !== null &&
      selectedGlyphIndex !== undefined &&
      glyph.index === selectedGlyphIndex &&
      glyphCommands.length > 0
    ) {
      ctx.beginPath();
      for (const cmd of glyphCommands) {
        if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
          ctx.moveTo(cursorX + cmd.x * scale, yBaseline - cmd.y * scale);
        } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
          ctx.lineTo(cursorX + cmd.x * scale, yBaseline - cmd.y * scale);
        } else if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
          ctx.quadraticCurveTo(cursorX + cmd.x1 * scale, yBaseline - cmd.y1 * scale, cursorX + cmd.x * scale, yBaseline - cmd.y * scale);
        } else if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
          ctx.bezierCurveTo(cursorX + cmd.x1 * scale, yBaseline - cmd.y1 * scale, cursorX + cmd.x2 * scale, yBaseline - cmd.y2 * scale, cursorX + cmd.x * scale, yBaseline - cmd.y * scale);
        } else if (cmd.type === 'Z') {
          ctx.closePath();
        }
      }
      ctx.fillStyle = fg;
      ctx.fill();
    } else {
      const glyphPath = glyph.getPath(cursorX, yBaseline, fontSize);
      glyphPath.fill = fg;
      glyphPath.stroke = null;
      glyphPath.draw(ctx);
    }

    cursorX += ((glyph.advanceWidth ?? 0) + pendingTracking) * scale;

    if (useKerning && i < text.length - 1) {
      const nextGlyph = font.charToGlyph(text[i + 1]);
      if (nextGlyph) {
        const kernKey = `${glyph.index},${nextGlyph.index}`;
        let kernValue = 0;
        if (font.kerningPairs && kernKey in font.kerningPairs) {
          kernValue = font.kerningPairs[kernKey];
        } else {
          try { kernValue = font.getKerningValue(glyph, nextGlyph); } catch { /* */ }
        }
        cursorX += kernValue * scale;
      }
    }
  }

  return cursorX;
}

function wrapText(font: Font, text: string, fontSize: number, maxWidth: number, pendingTracking: number, useKerning: boolean): string[] {
  const scale = fontSize / font.unitsPerEm;
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = '';
  let currentWidth = 0;

  for (const word of words) {
    let wordWidth = 0;
    for (let i = 0; i < word.length; i++) {
      const g = font.charToGlyph(word[i]);
      if (g) {
        wordWidth += ((g.advanceWidth ?? 0) + pendingTracking) * scale;
        if (useKerning && i < word.length - 1) {
          const ng = font.charToGlyph(word[i + 1]);
          if (ng) {
            const kk = `${g.index},${ng.index}`;
            let kv = 0;
            if (font.kerningPairs && kk in font.kerningPairs) kv = font.kerningPairs[kk];
            else { try { kv = font.getKerningValue(g, ng); } catch { /* */ } }
            wordWidth += kv * scale;
          }
        }
      }
    }

    const spaceG = font.charToGlyph(' ');
    const spaceW = spaceG ? ((spaceG.advanceWidth ?? 0) + pendingTracking) * scale : fontSize * 0.25;

    if (currentLine && currentWidth + spaceW + wordWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
      currentWidth = wordWidth;
    } else {
      if (currentLine) {
        currentLine += ' ' + word;
        currentWidth += spaceW + wordWidth;
      } else {
        currentLine = word;
        currentWidth = wordWidth;
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

export const TextPreview: React.FC<TextPreviewProps> = ({
  font, theme, fontVersion, glyphCommands, selectedGlyphIndex, pendingTracking = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const typeCanvasRef = useRef<HTMLCanvasElement>(null);
  const paragraphCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);

  const [text, setText] = useState('The quick brown fox jumps over the lazy dog');
  const [paragraphText, setParagraphText] = useState(DEFAULT_PARAGRAPH);
  const [fontSize, setFontSize] = useState(48);
  const [containerWidth, setContainerWidth] = useState(600);
  const [useKerning, setUseKerning] = useState(true);
  const [activeTab, setActiveTab] = useState<PreviewTab>('type');
  const [expanded, setExpanded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // --- Type tab ---
  useEffect(() => {
    if (activeTab !== 'type') return;
    const canvas = typeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = expanded ? 200 : 120;
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#0a0a0a' : '#f5f5f5';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, containerWidth, height);

    try {
      drawTextLine(ctx, font, text, fontSize, 16, height * 0.65, fg, useKerning, pendingTracking, glyphCommands, selectedGlyphIndex);
    } catch {
      ctx.fillStyle = fg;
      ctx.font = '12px monospace';
      ctx.fillText('Preview error', 16, height / 2);
    }
  }, [activeTab, font, text, fontSize, theme, containerWidth, useKerning, fontVersion, glyphCommands, selectedGlyphIndex, pendingTracking, expanded, refreshKey]);

  // --- Paragraph tab ---
  useEffect(() => {
    if (activeTab !== 'paragraph') return;
    const canvas = paragraphCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const padX = 20;
    const usableWidth = containerWidth - padX * 2;
    const lineHeight = fontSize * 1.4;
    const lines = wrapText(font, paragraphText, fontSize, usableWidth, pendingTracking, useKerning);
    const height = Math.max(200, lines.length * lineHeight + 60);

    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#0a0a0a' : '#f5f5f5';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, containerWidth, height);

    try {
      const ascenderRatio = (font.ascender ?? font.unitsPerEm * 0.8) / font.unitsPerEm;
      let y = 30 + fontSize * ascenderRatio;
      for (const line of lines) {
        drawTextLine(ctx, font, line, fontSize, padX, y, fg, useKerning, pendingTracking, glyphCommands, selectedGlyphIndex);
        y += lineHeight;
      }
    } catch { /* */ }
  }, [activeTab, font, paragraphText, fontSize, theme, containerWidth, useKerning, fontVersion, glyphCommands, selectedGlyphIndex, pendingTracking, refreshKey]);

  // --- Waterfall tab ---
  useEffect(() => {
    if (activeTab !== 'waterfall') return;
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const padX = 20;
    const padY = 16;
    const ascenderRatio = (font.ascender ?? font.unitsPerEm * 0.8) / font.unitsPerEm;
    const descenderRatio = Math.abs((font.descender ?? -(font.unitsPerEm * 0.2))) / font.unitsPerEm;

    let totalHeight = padY;
    for (const sz of WATERFALL_SIZES) {
      totalHeight += sz * (ascenderRatio + descenderRatio) + 12;
    }
    totalHeight += padY;

    const height = Math.max(300, totalHeight);
    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#0a0a0a' : '#f5f5f5';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';
    const dimColor = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';
    const labelColor = theme === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, containerWidth, height);

    try {
      let y = padY;
      for (const sz of WATERFALL_SIZES) {
        const baseline = y + sz * ascenderRatio;
        const rowH = sz * (ascenderRatio + descenderRatio);

        ctx.strokeStyle = dimColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padX, baseline);
        ctx.lineTo(containerWidth - padX, baseline);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = labelColor;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${sz}px`, padX + 30, baseline - 2);
        ctx.textAlign = 'left';

        drawTextLine(ctx, font, text, sz, padX + 38, baseline, fg, useKerning, pendingTracking, glyphCommands, selectedGlyphIndex);
        y += rowH + 12;
      }
    } catch { /* */ }
  }, [activeTab, font, text, theme, containerWidth, useKerning, fontVersion, glyphCommands, selectedGlyphIndex, pendingTracking, refreshKey]);

  // --- Grid tab ---
  useEffect(() => {
    if (activeTab !== 'grid') return;
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cellSize = 64;
    const padX = 12;
    const padY = 12;
    const cols = Math.max(1, Math.floor((containerWidth - padX * 2) / cellSize));

    const populatedGlyphs: { index: number; unicode?: number; name?: string }[] = [];
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      if (g && (g.unicode !== undefined || (g.path && g.path.commands && g.path.commands.length > 0))) {
        populatedGlyphs.push({ index: i, unicode: g.unicode, name: g.name });
      }
    }

    const rows = Math.ceil(populatedGlyphs.length / cols);
    const height = Math.max(300, padY * 2 + rows * cellSize);

    canvas.width = containerWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = containerWidth + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const bg = theme === 'dark' ? '#0a0a0a' : '#f5f5f5';
    const fg = theme === 'dark' ? '#ffffff' : '#111111';
    const borderColor = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const labelColor = theme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
    const selectedBg = theme === 'dark' ? 'rgba(100,180,255,0.12)' : 'rgba(0,100,200,0.08)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, containerWidth, height);

    const glyphFontSize = cellSize * 0.55;
    const ascenderRatio = (font.ascender ?? font.unitsPerEm * 0.8) / font.unitsPerEm;

    for (let idx = 0; idx < populatedGlyphs.length; idx++) {
      const gInfo = populatedGlyphs[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = padX + col * cellSize;
      const cy = padY + row * cellSize;

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);

      if (gInfo.index === selectedGlyphIndex) {
        ctx.fillStyle = selectedBg;
        ctx.fillRect(cx + 1, cy + 1, cellSize - 2, cellSize - 2);
      }

      try {
        const g = font.glyphs.get(gInfo.index);
        if (g) {
          const scale = glyphFontSize / font.unitsPerEm;
          const glyphW = (g.advanceWidth ?? font.unitsPerEm) * scale;
          const xOff = cx + (cellSize - glyphW) / 2;
          const yBase = cy + 10 + glyphFontSize * ascenderRatio;

          const glyphPath = g.getPath(xOff, yBase, glyphFontSize);
          glyphPath.fill = fg;
          glyphPath.stroke = null;
          glyphPath.draw(ctx);
        }
      } catch { /* */ }

      const label = gInfo.unicode !== undefined && gInfo.unicode > 32
        ? String.fromCodePoint(gInfo.unicode)
        : gInfo.name || '';
      if (label) {
        ctx.fillStyle = labelColor;
        ctx.font = '8px -apple-system, BlinkMacSystemFont, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx + cellSize / 2, cy + cellSize - 4);
        ctx.textAlign = 'left';
      }
    }
  }, [activeTab, font, theme, containerWidth, fontVersion, selectedGlyphIndex, refreshKey]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  return (
    <div className={`text-preview ${expanded ? 'expanded' : ''}`} ref={containerRef}>
      <div className="text-preview-header">
        <div className="preview-tabs">
          {(['type', 'paragraph', 'waterfall', 'grid'] as PreviewTab[]).map((tab) => (
            <button
              key={tab}
              className={`preview-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="preview-controls">
          {(activeTab === 'type' || activeTab === 'waterfall') && (
            <label className="text-preview-kern-toggle" title="Toggle kerning">
              <input
                type="checkbox"
                checked={useKerning}
                onChange={(e) => setUseKerning(e.target.checked)}
              />
              <span>Kern</span>
            </label>
          )}
          {(activeTab === 'type' || activeTab === 'paragraph') && (
            <div className="text-preview-size">
              <input
                type="range"
                min={12}
                max={120}
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                className="slider-input"
              />
              <span className="slider-value">{fontSize}px</span>
            </div>
          )}
          <button
            className="preview-refresh-btn"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Refresh preview"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            className="preview-expand-btn"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? 'Collapse preview' : 'Expand preview'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {expanded ? (
                <polyline points="18 15 12 9 6 15" />
              ) : (
                <polyline points="6 9 12 15 18 9" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {activeTab === 'type' && (
        <div className="preview-tab-controls">
          <input
            type="text"
            className="text-preview-input"
            value={text}
            onChange={handleTextChange}
            placeholder="Type to preview..."
          />
        </div>
      )}
      {activeTab === 'paragraph' && (
        <div className="preview-tab-controls">
          <textarea
            className="text-preview-textarea"
            value={paragraphText}
            onChange={(e) => setParagraphText(e.target.value)}
            placeholder="Enter paragraph text..."
            rows={2}
          />
        </div>
      )}
      {activeTab === 'waterfall' && (
        <div className="preview-tab-controls">
          <input
            type="text"
            className="text-preview-input"
            value={text}
            onChange={handleTextChange}
            placeholder="Type to preview..."
          />
        </div>
      )}

      <div className="preview-canvas-scroll">
        {activeTab === 'type' && <canvas ref={typeCanvasRef} />}
        {activeTab === 'paragraph' && <canvas ref={paragraphCanvasRef} />}
        {activeTab === 'waterfall' && <canvas ref={waterfallCanvasRef} />}
        {activeTab === 'grid' && <canvas ref={gridCanvasRef} />}
      </div>
    </div>
  );
};
