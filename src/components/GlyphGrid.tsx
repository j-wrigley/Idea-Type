import React, { useCallback, useEffect, useState, useMemo, useRef, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Font, Glyph } from 'opentype.js';
import type { Theme } from '../App';
import type { ComponentDef } from '../types';

type SidebarMode = 'glyphs' | 'components';

interface GlyphGridProps {
  font: Font;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onAddGlyph?: (char: string) => void;
  onRemoveGlyph?: (index: number) => void;
  onRenameGlyph?: (index: number, newChar: string) => void;
  theme: Theme;
  fontVersion?: number;
  contextGlyphs?: number[];
  onContextChange?: (indices: number[]) => void;
  components?: ComponentDef[];
  selectedComponentId?: string | null;
  onSelectComponent?: (id: string) => void;
  onAddComponent?: (name: string) => void;
  onRemoveComponent?: (id: string) => void;
  onRenameComponent?: (id: string, newName: string) => void;
  onInsertComponent?: (componentId: string) => void;
}

type GlyphTab = 'all' | 'basic' | 'extended' | 'numbers' | 'other';
type SortMode = 'unicode' | 'name' | 'width';

const TAB_LABELS: Record<GlyphTab, string> = {
  all: 'All',
  basic: 'Basic',
  extended: 'Extended',
  numbers: 'Num/Sym',
  other: 'Other',
};

function glyphMatchesTab(glyph: Glyph, tab: GlyphTab): boolean {
  if (tab === 'all') return true;
  const u = glyph.unicode;
  if (u === undefined) return tab === 'other';
  if (tab === 'basic') return u >= 0x0020 && u <= 0x007F;
  if (tab === 'extended') return u >= 0x0080 && u <= 0x024F;
  if (tab === 'numbers') return (u >= 0x0030 && u <= 0x0039) || (u >= 0x2000 && u <= 0x206F) || (u >= 0x0021 && u <= 0x002F) || (u >= 0x003A && u <= 0x0040) || (u >= 0x005B && u <= 0x0060) || (u >= 0x007B && u <= 0x007E);
  return u > 0x024F || u === undefined;
}

const CELL_SIZE = 72;

const GlyphCell: React.FC<{
  glyph: Glyph;
  index: number;
  isSelected: boolean;
  isContext: boolean;
  font: Font;
  onSelect: (index: number, e: React.MouseEvent) => void;
  onRename?: (index: number, newChar: string) => void;
  theme: Theme;
  fontVersion?: number;
}> = React.memo(({ glyph, index, isSelected, isContext, font, onSelect, onRename, theme, fontVersion }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = CELL_SIZE;
    const h = CELL_SIZE;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const bgColor = theme === 'dark' ? '#111111' : '#eaeaea';
    const fillColor = theme === 'dark' ? '#ffffff' : '#111111';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    try {
      const fontSize = w * 0.55;
      const scale = fontSize / font.unitsPerEm;
      const advW = (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale;
      const xOffset = Math.max(2, (w - advW) / 2);
      const yBaseline = font.ascender * scale + (h - fontSize) / 2;

      const path = glyph.getPath(xOffset, yBaseline, fontSize);
      path.fill = fillColor;
      path.stroke = null;
      path.draw(ctx);
    } catch (err) {
      console.error(`Glyph #${index} draw error:`, err);
      ctx.fillStyle = '#ff4444';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ERR', w / 2, h / 2);
    }

    ctx.restore();
  }, [glyph, font, index, theme, fontVersion]);

  const unicode = glyph.unicode;
  const label = unicode !== undefined && unicode !== 0
    ? String.fromCodePoint(unicode)
    : glyph.name || `#${index}`;

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0) return;
    setEditValue(label);
    setIsEditing(true);
  }, [index, label]);

  const commitRename = useCallback(() => {
    setIsEditing(false);
    if (editValue && editValue !== label && onRename) {
      onRename(index, editValue.charAt(0));
    }
  }, [editValue, label, onRename, index]);

  return (
    <div
      className={`glyph-cell ${isSelected ? 'selected' : isContext ? 'context' : ''}`}
      onClick={(e) => onSelect(index, e)}
      title={`${glyph.name || 'unnamed'} (U+${unicode?.toString(16).toUpperCase().padStart(4, '0') ?? '????'})`}
    >
      <canvas ref={canvasRef} />
      {isEditing ? (
        <input
          className="glyph-rename-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setIsEditing(false); }}
          maxLength={1}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="glyph-label" onDoubleClick={handleDoubleClick}>{label}</span>
      )}
    </div>
  );
});

const ComponentCell: React.FC<{
  comp: ComponentDef;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onInsert: () => void;
  onRename?: (id: string, newName: string) => void;
  theme: Theme;
}> = React.memo(({ comp, isSelected, onClick, onDoubleClick, onInsert, onRename, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = CELL_SIZE, h = CELL_SIZE;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const bgColor = theme === 'dark' ? '#111111' : '#eaeaea';
    const fillColor = theme === 'dark' ? '#88ccff' : '#0066aa';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (comp.commands.length === 0) {
      ctx.restore();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cmd of comp.commands) {
      if (cmd.x !== undefined && cmd.y !== undefined) {
        if (cmd.x < minX) minX = cmd.x;
        if (cmd.x > maxX) maxX = cmd.x;
        if (cmd.y < minY) minY = cmd.y;
        if (cmd.y > maxY) maxY = cmd.y;
      }
    }
    if (!isFinite(minX)) { ctx.restore(); return; }

    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const margin = 8;
    const scale = Math.min((w - margin * 2) / bw, (h - margin * 2) / bh);
    const ox = (w - bw * scale) / 2 - minX * scale;
    const oy = (h - bh * scale) / 2 - minY * scale;
    const flipY = (gx: number, gy: number) => ({ x: gx * scale + ox, y: h - (gy * scale + oy) });

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    for (const cmd of comp.commands) {
      if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
        const p = flipY(cmd.x, cmd.y);
        ctx.moveTo(p.x, p.y);
      } else if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
        const p = flipY(cmd.x, cmd.y);
        ctx.lineTo(p.x, p.y);
      } else if (cmd.type === 'C') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = cmd as any;
        const p1 = flipY(c.x1, c.y1);
        const p2 = flipY(c.x2, c.y2);
        const pe = flipY(c.x, c.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, pe.x, pe.y);
      } else if (cmd.type === 'Q') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = cmd as any;
        const p1 = flipY(c.x1, c.y1);
        const pe = flipY(c.x, c.y);
        ctx.quadraticCurveTo(p1.x, p1.y, pe.x, pe.y);
      } else if (cmd.type === 'Z') {
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.restore();
  }, [comp, theme]);

  const handleDoubleClickLabel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(comp.name);
    setIsEditing(true);
  }, [comp.name]);

  const commitRename = useCallback(() => {
    setIsEditing(false);
    if (editValue && editValue !== comp.name && onRename) {
      onRename(comp.id, editValue);
    }
  }, [editValue, comp.name, comp.id, onRename]);

  return (
    <div
      className={`glyph-cell component-cell ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={`${comp.name} — Click to edit, double-click or use ➕ to insert into glyph`}
    >
      <canvas ref={canvasRef} />
      <button
        className="comp-insert-btn"
        title="Insert into current glyph"
        onClick={(e) => { e.stopPropagation(); onInsert(); }}
      >+</button>
      {isEditing ? (
        <input
          className="glyph-rename-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setIsEditing(false); }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="glyph-label" onDoubleClick={handleDoubleClickLabel}>{comp.name}</span>
      )}
    </div>
  );
});

export const GlyphGrid: React.FC<GlyphGridProps> = ({
  font,
  selectedIndex,
  onSelect,
  onAddGlyph,
  onRemoveGlyph,
  onRenameGlyph,
  theme,
  fontVersion,
  contextGlyphs = [],
  onContextChange,
  components = [],
  selectedComponentId,
  onSelectComponent,
  onAddComponent,
  onRemoveComponent,
  onRenameComponent,
  onInsertComponent,
}) => {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('glyphs');
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState<GlyphTab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('unicode');
  const [showAddInput, setShowAddInput] = useState(false);
  const [addChar, setAddChar] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  const [showCompAddInput, setShowCompAddInput] = useState(false);
  const [compAddName, setCompAddName] = useState('');
  const compAddInputRef = useRef<HTMLInputElement>(null);

  const tabCounts = useMemo(() => {
    const counts: Record<GlyphTab, number> = { all: 0, basic: 0, extended: 0, numbers: 0, other: 0 };
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      counts.all++;
      if (glyphMatchesTab(g, 'basic')) counts.basic++;
      if (glyphMatchesTab(g, 'extended')) counts.extended++;
      if (glyphMatchesTab(g, 'numbers')) counts.numbers++;
      if (glyphMatchesTab(g, 'other')) counts.other++;
    }
    return counts;
  }, [font, fontVersion]);

  const glyphIndices = useMemo(() => {
    const indices: number[] = [];
    const numGlyphs = font.glyphs.length;
    for (let i = 0; i < numGlyphs; i++) {
      const glyph = font.glyphs.get(i);

      if (!glyphMatchesTab(glyph, activeTab)) continue;

      if (filter) {
        const query = filter.toLowerCase();
        const charMatch =
          glyph.unicode !== undefined &&
          String.fromCodePoint(glyph.unicode).toLowerCase().includes(query);
        const nameMatch = glyph.name?.toLowerCase().includes(query);
        const hexMatch =
          glyph.unicode !== undefined &&
          glyph.unicode.toString(16).toLowerCase().includes(query);
        if (!charMatch && !nameMatch && !hexMatch) continue;
      }
      indices.push(i);
    }

    if (sortMode === 'name') {
      indices.sort((a, b) => {
        const na = font.glyphs.get(a).name || '';
        const nb = font.glyphs.get(b).name || '';
        return na.localeCompare(nb);
      });
    } else if (sortMode === 'width') {
      indices.sort((a, b) => {
        const wa = font.glyphs.get(a).advanceWidth ?? 0;
        const wb = font.glyphs.get(b).advanceWidth ?? 0;
        return wa - wb;
      });
    }

    return indices;
  }, [font, filter, activeTab, sortMode, fontVersion]);

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter(e.target.value);
    },
    [],
  );

  const contextSet = useMemo(() => new Set(contextGlyphs), [contextGlyphs]);

  const handleCellClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.shiftKey && onContextChange) {
        if (contextSet.has(index)) {
          const next = contextGlyphs.filter((i) => i !== index);
          if (next.length === 0) return;
          onContextChange(next);
          if (selectedIndex === index) {
            onSelect(next[0]);
          }
        } else {
          onContextChange([...contextGlyphs, index]);
        }
      } else {
        onSelect(index);
      }
    },
    [onSelect, onContextChange, contextGlyphs, contextSet, selectedIndex],
  );

  return (
    <div className="glyph-sidebar">
      <div className="sidebar-mode-tabs">
        <button
          className={`sidebar-mode-tab ${sidebarMode === 'glyphs' ? 'active' : ''}`}
          onClick={() => setSidebarMode('glyphs')}
        >Glyphs</button>
        <button
          className={`sidebar-mode-tab ${sidebarMode === 'components' ? 'active' : ''}`}
          onClick={() => setSidebarMode('components')}
        >Components <span className="tab-count">{components.length}</span></button>
      </div>

      {sidebarMode === 'glyphs' ? (
        <>
          <div className="glyph-sidebar-header">
            <div className="glyph-tabs">
              {(Object.keys(TAB_LABELS) as GlyphTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`glyph-tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                  title={`${TAB_LABELS[tab]} (${tabCounts[tab]})`}
                >
                  {TAB_LABELS[tab]}
                  <span className="tab-count">{tabCounts[tab]}</span>
                </button>
              ))}
            </div>
            <div className="glyph-sidebar-controls">
              <input
                type="text"
                className="glyph-filter"
                placeholder="Filter glyphs..."
                value={filter}
                onChange={handleFilterChange}
              />
              <select
                className="glyph-sort"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="unicode">Unicode</option>
                <option value="name">Name</option>
                <option value="width">Width</option>
              </select>
            </div>
            <div className="glyph-sidebar-actions">
              <span className="glyph-count">{glyphIndices.length} glyphs</span>
              <div className="glyph-action-btns">
                {showAddInput ? (
                  <form className="glyph-add-form" onSubmit={(e) => {
                    e.preventDefault();
                    if (addChar && onAddGlyph) { onAddGlyph(addChar); setAddChar(''); setShowAddInput(false); }
                  }}>
                    <input
                      ref={addInputRef}
                      type="text"
                      className="glyph-add-input"
                      value={addChar}
                      onChange={(e) => setAddChar(e.target.value)}
                      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => { if (e.key === 'Escape') setShowAddInput(false); }}
                      onBlur={() => { if (!addChar) setShowAddInput(false); }}
                      placeholder="A"
                      maxLength={1}
                      autoFocus
                    />
                    <button type="submit" className="glyph-action-btn" disabled={!addChar} title="Confirm">+</button>
                  </form>
                ) : (
                  <button
                    className="glyph-action-btn"
                    onClick={() => { setShowAddInput(true); setTimeout(() => addInputRef.current?.focus(), 0); }}
                    title="Add glyph"
                  >+</button>
                )}
                <button
                  className="glyph-action-btn"
                  onClick={() => { if (selectedIndex !== null && onRemoveGlyph) onRemoveGlyph(selectedIndex); }}
                  disabled={selectedIndex === null || selectedIndex === 0}
                  title="Remove selected glyph"
                >&minus;</button>
              </div>
            </div>
          </div>
          <div className="glyph-grid">
            {glyphIndices.map((idx) => (
              <GlyphCell
                key={idx}
                glyph={font.glyphs.get(idx)}
                index={idx}
                isSelected={selectedIndex === idx}
                isContext={contextSet.has(idx) && selectedIndex !== idx}
                font={font}
                onSelect={handleCellClick}
                onRename={onRenameGlyph}
                theme={theme}
                fontVersion={fontVersion}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="glyph-sidebar-header">
            <div className="glyph-sidebar-actions">
              <span className="glyph-count">{components.length} components</span>
              <div className="glyph-action-btns">
                {showCompAddInput ? (
                  <form className="glyph-add-form" onSubmit={(e) => {
                    e.preventDefault();
                    if (compAddName && onAddComponent) {
                      onAddComponent(compAddName);
                      setCompAddName('');
                      setShowCompAddInput(false);
                    }
                  }}>
                    <input
                      ref={compAddInputRef}
                      type="text"
                      className="glyph-add-input comp-add-input"
                      value={compAddName}
                      onChange={(e) => setCompAddName(e.target.value)}
                      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => { if (e.key === 'Escape') setShowCompAddInput(false); }}
                      onBlur={() => { if (!compAddName) setShowCompAddInput(false); }}
                      placeholder="serif"
                      autoFocus
                    />
                    <button type="submit" className="glyph-action-btn" disabled={!compAddName} title="Confirm">+</button>
                  </form>
                ) : (
                  <button
                    className="glyph-action-btn"
                    onClick={() => { setShowCompAddInput(true); setTimeout(() => compAddInputRef.current?.focus(), 0); }}
                    title="Add component"
                  >+</button>
                )}
                <button
                  className="glyph-action-btn"
                  onClick={() => { if (selectedComponentId && onRemoveComponent) onRemoveComponent(selectedComponentId); }}
                  disabled={!selectedComponentId}
                  title="Remove selected component"
                >&minus;</button>
              </div>
            </div>
          </div>
          <div className="glyph-grid">
            {components.map((comp) => (
              <ComponentCell
                key={comp.id}
                comp={comp}
                isSelected={selectedComponentId === comp.id}
                onClick={() => onSelectComponent?.(comp.id)}
                onDoubleClick={() => onInsertComponent?.(comp.id)}
                onInsert={() => onInsertComponent?.(comp.id)}
                onRename={onRenameComponent}
                theme={theme}
              />
            ))}
            {components.length === 0 && (
              <div className="comp-empty-msg">
                No components yet. Click + to create one, or right-click selected shapes in the editor to create a component from them.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
