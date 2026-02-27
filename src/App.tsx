import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import opentype, { type PathCommand } from 'opentype.js';
import { useFont } from './hooks/useFont';
import { useHistory } from './hooks/useHistory';
import { useComponents } from './hooks/useComponents';
import { FontUploader } from './components/FontUploader';
import { GlyphGrid } from './components/GlyphGrid';
import { GlyphEditor } from './components/GlyphEditor';
import { SliderPanel, DEFAULT_DESIGN_TOOLS, isDefaultDesignTools } from './components/SliderPanel';
import type { DesignToolValues } from './components/SliderPanel';
import { Toolbar } from './components/Toolbar';
import { TextPreview } from './components/TextPreview';
import { KerningPanel } from './components/KerningPanel';
import { ExportDialog, type ExportMetadata } from './components/ExportDialog';
import { cloneCommands, removeDuplicatePoints, applyTransform, applyDesignTools, getContourRanges, reverseContour, reverseContours, makeContourCutout, makeContourFill, makeIndent, extractContours, removeContours, translateContourCommands, flipContourCommands, scaleContourCommands, getContourBounds, breakSegment } from './utils/pathTransforms';
import { slicePathWithLine } from './utils/slicePath';
import { exportFont } from './utils/fontExport';
import { getEditablePoints, deletePoints, splitSegmentAtT, convertSegmentToType } from './utils/hitTesting';
import { DEFAULT_TRANSFORM, DEFAULT_GRID, isDefaultTransform, createDefaultMetrics } from './types';
import type { TransformValues, EditablePoint, GridSettings, EditorTool, SidebarTab, MetricLine } from './types';
import './App.css';

export type Theme = 'dark' | 'light';

export default function App() {
  const { fontState, loadFont, loadFontFromBuffer, createNewFont, selectGlyph, updateFont, markGlyphModified, markAllGlyphsModified } = useFont();
  const history = useHistory();
  const [commands, setCommands] = useState<PathCommand[]>([]);
  const [transform, setTransform] = useState<TransformValues>(DEFAULT_TRANSFORM);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [theme, setTheme] = useState<Theme>('light');
  const [gridSettings, setGridSettings] = useState<GridSettings>(DEFAULT_GRID);
  const [showRulers, setShowRulers] = useState(false);
  const [showPathDirection, setShowPathDirection] = useState(false);
  const [selectedPoints, setSelectedPoints] = useState<EditablePoint[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const clipboardRef = useRef<PathCommand[] | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('transform');
  const [cornerPoints, setCornerPoints] = useState<Set<number>>(new Set());
  const [fontVersion, setFontVersion] = useState(0);
  const [pendingTracking, setPendingTracking] = useState(0);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showFill, setShowFill] = useState(false);
  const [contextGlyphs, setContextGlyphs] = useState<number[]>([]);
  const [metricLines, setMetricLines] = useState<MetricLine[]>([]);
  const [selectedContours, setSelectedContours] = useState<number[]>([]);
  const contourClipboardRef = useRef<PathCommand[] | null>(null);
  const [designTools, setDesignTools] = useState<DesignToolValues>(DEFAULT_DESIGN_TOOLS);
  const [showControlsInfo, setShowControlsInfo] = useState(false);

  const {
    components: compLibrary,
    glyphComponents,
    selectedComponentId,
    setSelectedComponentId,
    addComponent,
    updateComponent: updateComponentDef,
    removeComponent,
    renameComponent,
    addInstance,
    updateInstance,
    resolveInstance,
    decomposeInstance,
    getComponent,
  } = useComponents();

  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const glyphOwnCommandsRef = useRef<Record<number, PathCommand[]>>({});
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (fontState.font) {
      setMetricLines(createDefaultMetrics(fontState.font));
    }
  }, [fontState.font]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleFontChanged = useCallback(() => {
    setFontVersion((v) => v + 1);
  }, []);

  const handleAddGlyph = useCallback((char: string) => {
    if (!fontState.font) return;
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return;
    const glyph = new opentype.Glyph({
      name: char,
      unicode: codePoint,
      advanceWidth: Math.round(fontState.font.unitsPerEm * 0.6),
      path: new opentype.Path(),
    });
    glyph.path.unitsPerEm = fontState.font.unitsPerEm;
    const newIndex = fontState.font.glyphs.length;
    fontState.font.glyphs.push(newIndex, glyph as never);
    markGlyphModified(newIndex);
    setFontVersion((v) => v + 1);
    selectGlyph(newIndex);
  }, [fontState.font, selectGlyph, markGlyphModified]);

  const handleRemoveGlyph = useCallback((index: number) => {
    if (!fontState.font) return;
    if (index === 0) return;
    const glyphs: InstanceType<typeof opentype.Glyph>[] = [];
    for (let i = 0; i < fontState.font.glyphs.length; i++) {
      if (i !== index) glyphs.push(fontState.font.glyphs.get(i));
    }
    const newFont = new opentype.Font({
      familyName: fontState.font.names.fontFamily?.en || 'Untitled',
      styleName: fontState.font.names.fontSubfamily?.en || 'Regular',
      unitsPerEm: fontState.font.unitsPerEm,
      ascender: fontState.font.ascender,
      descender: fontState.font.descender,
      glyphs: glyphs,
    });
    if (fontState.font.kerningPairs) {
      (newFont as unknown as Record<string, unknown>).kerningPairs = { ...fontState.font.kerningPairs };
    }
    Object.assign(newFont.names, fontState.font.names);
    markAllGlyphsModified();
    setFontVersion((v) => v + 1);
    selectGlyph(Math.min(index, glyphs.length - 1) || 0);
    updateFont(newFont);
  }, [fontState.font, selectGlyph, updateFont, markAllGlyphsModified]);

  const handleRenameGlyph = useCallback((index: number, newChar: string) => {
    if (!fontState.font) return;
    const g = fontState.font.glyphs.get(index);
    if (!g) return;
    const codePoint = newChar.codePointAt(0);
    if (codePoint === undefined) return;
    g.unicode = codePoint;
    g.unicodes = [codePoint];
    g.name = newChar;
    markGlyphModified(index);
    setFontVersion((v) => v + 1);
  }, [fontState.font, markGlyphModified]);

  const selectedGlyph = useMemo(() => {
    if (!fontState.font || fontState.selectedGlyphIndex === null) return null;
    return fontState.font.glyphs.get(fontState.selectedGlyphIndex);
  }, [fontState.font, fontState.selectedGlyphIndex]);

  useEffect(() => {
    if (selectedGlyph && fontState.selectedGlyphIndex !== null) {
      const ownCmds = glyphOwnCommandsRef.current[fontState.selectedGlyphIndex];
      const rawCmds = ownCmds ? cloneCommands(ownCmds) : cloneCommands(selectedGlyph.path.commands);
      setCommands(removeDuplicatePoints(rawCmds));
      setTransform(DEFAULT_TRANSFORM);
      setDesignTools(DEFAULT_DESIGN_TOOLS);
      setSelectedPoints([]);
      setSelectedContours([]);
      setCornerPoints(new Set());
      history.clear();
      setZoom(1);
      setPanX(0);
      setPanY(0);
      skipSyncRef.current = false;
    }
  }, [selectedGlyph]);

  const displayCommands = useMemo(() => {
    let result = commands;
    if (!isDefaultTransform(transform)) {
      result = applyTransform(result, transform);
    }
    if (fontState.font && !isDefaultDesignTools(designTools)) {
      const { commands: designResult } = applyDesignTools(result, designTools, {
        unitsPerEm: fontState.font.unitsPerEm,
        ascender: fontState.font.ascender,
        descender: fontState.font.descender,
      });
      result = designResult;
    }
    return result;
  }, [commands, transform, designTools, fontState.font]);

  const displayCommandsWithComponents = useMemo(() => {
    if (editingComponentId || fontState.selectedGlyphIndex === null) return displayCommands;
    const instances = glyphComponents[fontState.selectedGlyphIndex];
    if (!instances || instances.length === 0) return displayCommands;
    const resolved: PathCommand[] = [];
    for (const inst of instances) {
      resolved.push(...resolveInstance(inst));
    }
    return [...displayCommands, ...resolved];
  }, [displayCommands, editingComponentId, fontState.selectedGlyphIndex, glyphComponents, resolveInstance]);

  useEffect(() => {
    if (editingComponentId || skipSyncRef.current) return;
    if (!fontState.font || fontState.selectedGlyphIndex === null) return;
    const g = fontState.font.glyphs.get(fontState.selectedGlyphIndex);
    if (g) {
      // Store the raw commands (without transforms/design tools) so that
      // switching away and back doesn't reload already-transformed data.
      glyphOwnCommandsRef.current[fontState.selectedGlyphIndex] = commands;

      const instances = glyphComponents[fontState.selectedGlyphIndex];
      let merged = displayCommands;
      if (instances && instances.length > 0) {
        const resolved: PathCommand[] = [];
        for (const inst of instances) {
          resolved.push(...resolveInstance(inst));
        }
        merged = [...displayCommands, ...resolved];
      }

      const p = new opentype.Path();
      p.commands = merged;
      p.unitsPerEm = fontState.font.unitsPerEm;
      g.path = p;
    }
  }, [fontState.font, fontState.selectedGlyphIndex, commands, displayCommands, editingComponentId, glyphComponents, resolveInstance]);

  // When component definitions change, update all glyphs that use them
  useEffect(() => {
    if (!fontState.font || compLibrary.length === 0) return;
    for (const [key, instances] of Object.entries(glyphComponents)) {
      const glyphIdx = Number(key);
      if (glyphIdx === fontState.selectedGlyphIndex) continue;
      if (!instances || instances.length === 0) continue;
      const g = fontState.font.glyphs.get(glyphIdx);
      if (!g) continue;
      // Only use glyphOwnCommandsRef — never fall back to g.path.commands
      // since that may already have components merged in from a previous sync.
      const own = glyphOwnCommandsRef.current[glyphIdx];
      if (!own) continue;
      const resolved: PathCommand[] = [];
      for (const inst of instances) {
        resolved.push(...resolveInstance(inst));
      }
      const p = new opentype.Path();
      p.commands = [...own, ...resolved];
      p.unitsPerEm = fontState.font.unitsPerEm;
      g.path = p;
    }
    setFontVersion(v => v + 1);
  }, [compLibrary, glyphComponents, resolveInstance, fontState.font]);

  const handleCommandsChange = useCallback(
    (newCommands: PathCommand[]) => {
      setCommands(newCommands);
      setTransform(DEFAULT_TRANSFORM);
      if (editingComponentId) {
        updateComponentDef(editingComponentId, newCommands);
      } else if (fontState.selectedGlyphIndex !== null) {
        markGlyphModified(fontState.selectedGlyphIndex);
      }
    },
    [fontState.selectedGlyphIndex, markGlyphModified, editingComponentId, updateComponentDef],
  );

  const handleDragStart = useCallback(() => {
    if (!isDefaultTransform(transform)) {
      const applied = applyTransform(commands, transform);
      history.pushState(commands);
      setCommands(applied);
      setTransform(DEFAULT_TRANSFORM);
    } else {
      history.pushState(commands);
    }
  }, [commands, transform, history]);

  const handleApplyTransform = useCallback(() => {
    if (isDefaultTransform(transform)) return;
    history.pushState(commands);
    setCommands(applyTransform(commands, transform));
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, transform, history]);

  const handleApplyDesignTools = useCallback(() => {
    if (!fontState.font || isDefaultDesignTools(designTools)) return;
    history.pushState(commands);
    const fontInfo = {
      unitsPerEm: fontState.font.unitsPerEm,
      ascender: fontState.font.ascender,
      descender: fontState.font.descender,
    };
    const { commands: result, advanceWidthDelta } = applyDesignTools(commands, designTools, fontInfo);
    setCommands(result);
    if (advanceWidthDelta !== 0 && selectedGlyph) {
      selectedGlyph.advanceWidth = Math.max(0, (selectedGlyph.advanceWidth ?? 0) + advanceWidthDelta);
    }
    setDesignTools(DEFAULT_DESIGN_TOOLS);
  }, [commands, designTools, fontState.font, selectedGlyph, history]);

  const handleApplyDesignToolsToAll = useCallback(() => {
    if (!fontState.font || isDefaultDesignTools(designTools)) return;
    const f = fontState.font;
    const fontInfo = {
      unitsPerEm: f.unitsPerEm,
      ascender: f.ascender,
      descender: f.descender,
    };
    const selectedIdx = fontState.selectedGlyphIndex;
    history.pushState(commands);
    for (let i = 0; i < f.glyphs.length; i++) {
      const g = f.glyphs.get(i);
      if (g.path && g.path.commands && g.path.commands.length > 0) {
        // For the selected glyph, use the raw `commands` state instead of
        // g.path.commands, which already has design tools applied via the
        // live preview sync in the useEffect.
        const source = (i === selectedIdx) ? commands : g.path.commands;
        const { commands: result, advanceWidthDelta } = applyDesignTools(source, designTools, fontInfo);
        const p = new opentype.Path();
        p.commands = result;
        p.unitsPerEm = f.unitsPerEm;
        g.path = p;
        if (advanceWidthDelta !== 0) {
          g.advanceWidth = Math.max(0, (g.advanceWidth ?? 0) + advanceWidthDelta);
        }
      }
    }
    markAllGlyphsModified();
    if (selectedGlyph) {
      setCommands(cloneCommands(selectedGlyph.path.commands));
    }
    setDesignTools(DEFAULT_DESIGN_TOOLS);
  }, [fontState.font, fontState.selectedGlyphIndex, designTools, selectedGlyph, commands, history, markAllGlyphsModified]);

  const handleApplyToAll = useCallback(() => {
    if (!fontState.font || isDefaultTransform(transform)) return;
    const f = fontState.font;
    const selectedIdx = fontState.selectedGlyphIndex;
    history.pushState(commands);
    for (let i = 0; i < f.glyphs.length; i++) {
      const g = f.glyphs.get(i);
      if (g.path && g.path.commands && g.path.commands.length > 0) {
        const source = (i === selectedIdx) ? commands : g.path.commands;
        const p = new opentype.Path();
        p.commands = applyTransform(source, transform);
        p.unitsPerEm = f.unitsPerEm;
        g.path = p;
      }
    }
    markAllGlyphsModified();
    if (selectedGlyph) {
      setCommands(cloneCommands(selectedGlyph.path.commands));
    }
    setTransform(DEFAULT_TRANSFORM);
  }, [fontState.font, fontState.selectedGlyphIndex, transform, selectedGlyph, commands, history, markAllGlyphsModified]);

  const handleUndo = useCallback(() => {
    const prev = history.undo(commands);
    if (prev) {
      setCommands(prev);
      setTransform(DEFAULT_TRANSFORM);
      setSelectedPoints([]);
    }
  }, [commands, history]);

  const handleRedo = useCallback(() => {
    const next = history.redo(commands);
    if (next) {
      setCommands(next);
      setTransform(DEFAULT_TRANSFORM);
      setSelectedPoints([]);
    }
  }, [commands, history]);

  const commitCurrentGlyph = useCallback(() => {
    if (editingComponentId) {
      updateComponentDef(editingComponentId, commands);
      return;
    }
    if (!fontState.font || fontState.selectedGlyphIndex === null) return;
    const g = fontState.font.glyphs.get(fontState.selectedGlyphIndex);
    const ownCommands = isDefaultTransform(transform)
      ? commands
      : applyTransform(commands, transform);

    glyphOwnCommandsRef.current[fontState.selectedGlyphIndex] = ownCommands;

    const instances = glyphComponents[fontState.selectedGlyphIndex];
    let merged = ownCommands;
    if (instances && instances.length > 0) {
      const resolved: PathCommand[] = [];
      for (const inst of instances) {
        resolved.push(...resolveInstance(inst));
      }
      merged = [...ownCommands, ...resolved];
    }

    const p = new opentype.Path();
    p.commands = merged;
    p.unitsPerEm = fontState.font.unitsPerEm;
    g.path = p;
    markGlyphModified(fontState.selectedGlyphIndex);
    setFontVersion((v) => v + 1);
  }, [fontState.font, fontState.selectedGlyphIndex, commands, transform, markGlyphModified, editingComponentId, updateComponentDef, glyphComponents, resolveInstance]);

  const handleSave = useCallback(() => {
    if (!fontState.font) return;
    commitCurrentGlyph();
    setShowExportDialog(true);
  }, [fontState.font, commitCurrentGlyph]);

  const handleExport = useCallback(async (metadata: ExportMetadata) => {
    if (!fontState.font) return;
    try {
      // Force-commit the current glyph's edits before serializing
      commitCurrentGlyph();

      // Temporarily apply pending tracking to all glyphs for export
      const appliedTracking = pendingTracking;
      if (appliedTracking !== 0) {
        for (let i = 0; i < fontState.font.glyphs.length; i++) {
          const g = fontState.font.glyphs.get(i);
          if (g.advanceWidth !== undefined) {
            g.advanceWidth += appliedTracking;
          }
        }
        markAllGlyphsModified();
      }

      let arrayBuffer: ArrayBuffer;
      try {
        arrayBuffer = await exportFont(
          fontState.font,
          fontState.originalBuffer,
          fontState.modifiedGlyphs,
          {
            familyName: metadata.familyName,
            styleName: metadata.styleName,
            version: metadata.version,
            copyright: metadata.copyright,
            designer: metadata.designer,
            description: metadata.description,
            license: metadata.license,
            format: metadata.format,
            hinting: metadata.hinting,
          },
          glyphComponents,
          compLibrary,
        );
      } finally {
        // Revert tracking so the slider remains non-destructive
        if (appliedTracking !== 0) {
          for (let i = 0; i < fontState.font.glyphs.length; i++) {
            const g = fontState.font.glyphs.get(i);
            if (g.advanceWidth !== undefined) {
              g.advanceWidth -= appliedTracking;
            }
          }
        }
      }

      if (window.electronAPI?.saveFontFile) {
        await window.electronAPI.saveFontFile(arrayBuffer, metadata.fileName);
      } else {
        const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = metadata.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setShowExportDialog(false);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [fontState.font, fontState.originalBuffer, fontState.modifiedGlyphs, commitCurrentGlyph, pendingTracking, markAllGlyphsModified]);

  const handleSelectGlyph = useCallback(
    (index: number) => {
      if (fontState.selectedGlyphIndex !== null && fontState.font) {
        commitCurrentGlyph();
      }
      selectGlyph(index);
      setContextGlyphs([index]);
    },
    [fontState.selectedGlyphIndex, fontState.font, commitCurrentGlyph, selectGlyph],
  );

  const handleContextChange = useCallback(
    (indices: number[]) => {
      setContextGlyphs(indices);
    },
    [],
  );

  const handleSwitchActiveGlyph = useCallback(
    (index: number) => {
      if (fontState.selectedGlyphIndex !== null && fontState.font) {
        commitCurrentGlyph();
      }
      selectGlyph(index);
    },
    [fontState.selectedGlyphIndex, fontState.font, commitCurrentGlyph, selectGlyph],
  );

  const handlePanChange = useCallback((x: number, y: number) => {
    setPanX(x);
    setPanY(y);
  }, []);

  const handleDeletePoints = useCallback(() => {
    if (selectedPoints.length === 0) return;
    history.pushState(commands);
    const newCmds = deletePoints(commands, selectedPoints);
    setCommands(newCmds);
    setSelectedPoints([]);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, selectedPoints, history]);

  const handleAddPoint = useCallback((commandIndex: number, t: number) => {
    history.pushState(commands);
    const newCmds = splitSegmentAtT(commands, commandIndex, t);
    setCommands(newCmds);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, history]);

  const handleBreakSegment = useCallback((commandIndex: number) => {
    history.pushState(commands);
    const newCmds = breakSegment(commands, commandIndex);
    setCommands(newCmds);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, history]);

  const handleSlice = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    history.pushState(commands);
    const newCmds = slicePathWithLine(commands, x1, y1, x2, y2);
    setCommands(newCmds);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, history]);

  const handleReverseContour = useCallback(() => {
    if (activeTool === 'shape' && selectedContours.length > 0) {
      history.pushState(commands);
      const newCmds = reverseContours(commands, selectedContours);
      setCommands(newCmds);
    } else if (selectedPoints.length > 0) {
      const ranges = getContourRanges(commands);
      const ptIdx = selectedPoints[0].commandIndex;
      const contourIdx = ranges.findIndex(r => ptIdx >= r.start && ptIdx <= r.end);
      if (contourIdx < 0) return;
      history.pushState(commands);
      const newCmds = reverseContour(commands, contourIdx);
      setCommands(newCmds);
      setSelectedPoints([]);
    }
  }, [commands, selectedPoints, selectedContours, activeTool, history]);

  const handleMakeCutout = useCallback(() => {
    if (activeTool === 'shape' && selectedContours.length > 0) {
      history.pushState(commands);
      const newCmds = makeContourCutout(commands, selectedContours);
      setCommands(newCmds);
    } else if (selectedPoints.length > 0) {
      const ranges = getContourRanges(commands);
      const indices = new Set<number>();
      for (const pt of selectedPoints) {
        const ci = ranges.findIndex(r => pt.commandIndex >= r.start && pt.commandIndex <= r.end);
        if (ci >= 0) indices.add(ci);
      }
      if (indices.size === 0) return;
      history.pushState(commands);
      const newCmds = makeContourCutout(commands, Array.from(indices));
      setCommands(newCmds);
      setSelectedPoints([]);
    }
  }, [commands, selectedPoints, selectedContours, activeTool, history]);

  const handleMakeFill = useCallback(() => {
    if (activeTool === 'shape' && selectedContours.length > 0) {
      history.pushState(commands);
      const newCmds = makeContourFill(commands, selectedContours);
      setCommands(newCmds);
    } else if (selectedPoints.length > 0) {
      const ranges = getContourRanges(commands);
      const indices = new Set<number>();
      for (const pt of selectedPoints) {
        const ci = ranges.findIndex(r => pt.commandIndex >= r.start && pt.commandIndex <= r.end);
        if (ci >= 0) indices.add(ci);
      }
      if (indices.size === 0) return;
      history.pushState(commands);
      const newCmds = makeContourFill(commands, Array.from(indices));
      setCommands(newCmds);
      setSelectedPoints([]);
    }
  }, [commands, selectedPoints, selectedContours, activeTool, history]);

  const handleMakeIndent = useCallback(() => {
    if (activeTool === 'shape' && selectedContours.length > 0) {
      history.pushState(commands);
      const newCmds = makeIndent(commands, selectedContours);
      setCommands(newCmds);
      setSelectedContours([]);
    } else if (selectedPoints.length > 0) {
      const ranges = getContourRanges(commands);
      const indices = new Set<number>();
      for (const pt of selectedPoints) {
        const ci = ranges.findIndex(r => pt.commandIndex >= r.start && pt.commandIndex <= r.end);
        if (ci >= 0) indices.add(ci);
      }
      if (indices.size === 0) return;
      history.pushState(commands);
      const newCmds = makeIndent(commands, Array.from(indices));
      setCommands(newCmds);
      setSelectedPoints([]);
    }
  }, [commands, selectedPoints, selectedContours, activeTool, history]);

  const handleFlipContour = useCallback((axis: 'horizontal' | 'vertical') => {
    if (activeTool === 'shape' && selectedContours.length > 0) {
      history.pushState(commands);
      const newCmds = flipContourCommands(commands, selectedContours, axis);
      setCommands(newCmds);
    } else if (selectedPoints.length > 0) {
      const ranges = getContourRanges(commands);
      const ptIdx = selectedPoints[0].commandIndex;
      const contourIdx = ranges.findIndex(r => ptIdx >= r.start && ptIdx <= r.end);
      if (contourIdx < 0) return;
      history.pushState(commands);
      const newCmds = flipContourCommands(commands, [contourIdx], axis);
      setCommands(newCmds);
      setSelectedPoints([]);
    }
  }, [commands, selectedPoints, selectedContours, activeTool, history]);

  // --- Component handlers ---

  const handleSelectComponent = useCallback((id: string) => {
    if (fontState.selectedGlyphIndex !== null && fontState.font && !editingComponentId) {
      commitCurrentGlyph();
    }
    setSelectedComponentId(id);
    setEditingComponentId(id);
    const comp = compLibrary.find(c => c.id === id);
    if (comp) {
      setCommands(cloneCommands(comp.commands));
      setTransform(DEFAULT_TRANSFORM);
      setSelectedPoints([]);
      setSelectedContours([]);
      history.clear();
    }
  }, [compLibrary, history, setSelectedComponentId, fontState.selectedGlyphIndex, fontState.font, editingComponentId, commitCurrentGlyph]);

  const handleAddComponentBlank = useCallback((name: string) => {
    addComponent(name, [], 600);
  }, [addComponent]);

  const handleCreateComponentFromSelection = useCallback((contourIndices: number[]) => {
    if (contourIndices.length === 0) return;
    const name = `Component ${compLibrary.length + 1}`;
    const extracted = extractContours(commands, contourIndices);
    const compId = addComponent(name, extracted, 600);

    history.pushState(commands);
    const remaining = removeContours(commands, contourIndices);
    setCommands(remaining);
    setSelectedPoints([]);
    setSelectedContours([]);

    if (fontState.selectedGlyphIndex !== null) {
      addInstance(fontState.selectedGlyphIndex, compId, 0, 0);
    }
  }, [commands, addComponent, history, fontState.selectedGlyphIndex, addInstance, compLibrary.length]);

  const handleInsertComponentById = useCallback((componentId: string, x: number, y: number) => {
    if (fontState.selectedGlyphIndex !== null) {
      addInstance(fontState.selectedGlyphIndex, componentId, Math.round(x), Math.round(y));
    }
  }, [fontState.selectedGlyphIndex, addInstance]);

  const handleMoveInstance = useCallback((instanceIndex: number, newOffsetX: number, newOffsetY: number) => {
    if (fontState.selectedGlyphIndex !== null) {
      updateInstance(fontState.selectedGlyphIndex, instanceIndex, {
        offsetX: Math.round(newOffsetX),
        offsetY: Math.round(newOffsetY),
      });
    }
  }, [fontState.selectedGlyphIndex, updateInstance]);

  const handleDecomposeInstance = useCallback((instanceIndex: number) => {
    if (fontState.selectedGlyphIndex === null) return;
    const resolved = decomposeInstance(fontState.selectedGlyphIndex, instanceIndex);
    if (resolved.length > 0) {
      history.pushState(commands);
      setCommands([...commands, ...resolved]);
    }
  }, [fontState.selectedGlyphIndex, decomposeInstance, commands, history]);

  const handleInsertComponentFromSidebar = useCallback((componentId: string) => {
    if (fontState.selectedGlyphIndex === null) {
      alert('Select a glyph first, then double-click a component to insert it.');
      return;
    }
    if (editingComponentId) return;
    addInstance(fontState.selectedGlyphIndex, componentId, 0, 0);
  }, [fontState.selectedGlyphIndex, editingComponentId, addInstance]);

  const componentInstancesForEditor = useMemo(() => {
    if (fontState.selectedGlyphIndex === null || editingComponentId) return [];
    const instances = glyphComponents[fontState.selectedGlyphIndex];
    if (!instances) return [];
    return instances.map(inst => {
      const comp = getComponent(inst.componentId);
      const resolved = resolveInstance(inst);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const cmd of resolved) {
        if (cmd.x !== undefined && cmd.y !== undefined) {
          if (cmd.x < minX) minX = cmd.x;
          if (cmd.x > maxX) maxX = cmd.x;
          if (cmd.y < minY) minY = cmd.y;
          if (cmd.y > maxY) maxY = cmd.y;
        }
      }
      return {
        componentId: inst.componentId,
        name: comp?.name || '?',
        offsetX: inst.offsetX,
        offsetY: inst.offsetY,
        bounds: { minX, minY, maxX, maxY },
        resolvedCommands: resolved,
      };
    });
  }, [fontState.selectedGlyphIndex, editingComponentId, glyphComponents, getComponent, resolveInstance, compLibrary]);

  // When exiting component editing mode, save back
  const commitComponentEdit = useCallback(() => {
    if (editingComponentId) {
      updateComponentDef(editingComponentId, commands);
    }
  }, [editingComponentId, commands, updateComponentDef]);

  const handleSelectGlyphWithCompExit = useCallback(
    (index: number) => {
      if (editingComponentId) {
        commitComponentEdit();
        skipSyncRef.current = true;
        setEditingComponentId(null);
        setSelectedComponentId(null);
      }
      handleSelectGlyph(index);
    },
    [editingComponentId, commitComponentEdit, setSelectedComponentId, handleSelectGlyph],
  );

  const handleSelectAll = useCallback(() => {
    const pts = getEditablePoints(displayCommands);
    setSelectedPoints(pts);
  }, [displayCommands]);

  const handleCleanupPoints = useCallback(() => {
    const before = commands.length;
    const cleaned = removeDuplicatePoints(commands);
    if (cleaned.length < before) {
      history.pushState(commands);
      setCommands(cleaned);
    }
  }, [commands, history]);

  const handleNudgeContours = useCallback((dx: number, dy: number) => {
    if (selectedContours.length === 0) return;
    history.pushState(commands);
    const newCommands = translateContourCommands(commands, selectedContours, dx, dy);
    setCommands(newCommands);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, selectedContours, history]);

  const handleScaleContours = useCallback((sx: number, sy: number, uniform: boolean) => {
    if (selectedContours.length === 0) return;
    history.pushState(commands);
    let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
    for (const ci of selectedContours) {
      const b = getContourBounds(commands, ci);
      if (b.minX < allMinX) allMinX = b.minX;
      if (b.minY < allMinY) allMinY = b.minY;
      if (b.maxX > allMaxX) allMaxX = b.maxX;
      if (b.maxY > allMaxY) allMaxY = b.maxY;
    }
    const cx = (allMinX + allMaxX) / 2;
    const cy = (allMinY + allMaxY) / 2;
    let scaleX = sx, scaleY = sy;
    if (uniform) {
      const u = Math.max(sx, sy);
      scaleX = scaleY = u;
    }
    const newCommands = scaleContourCommands(commands, selectedContours, scaleX, scaleY, cx, cy);
    setCommands(newCommands);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, selectedContours, history]);

  const handleNudge = useCallback((dx: number, dy: number) => {
    if (selectedPoints.length === 0) return;
    history.pushState(commands);
    const newCommands = commands.map((cmd) => ({ ...cmd }));
    const updatedPoints: EditablePoint[] = [];

    for (const pt of selectedPoints) {
      const cmd = { ...newCommands[pt.commandIndex] };
      if (pt.field === 'end' && cmd.x !== undefined && cmd.y !== undefined) {
        cmd.x += dx;
        cmd.y += dy;
        updatedPoints.push({ ...pt, x: cmd.x, y: cmd.y });
      } else if (pt.field === 'cp1' && cmd.x1 !== undefined && cmd.y1 !== undefined) {
        cmd.x1 += dx;
        cmd.y1 += dy;
        updatedPoints.push({ ...pt, x: cmd.x1, y: cmd.y1 });
      } else if (pt.field === 'cp2' && cmd.x2 !== undefined && cmd.y2 !== undefined) {
        cmd.x2 += dx;
        cmd.y2 += dy;
        updatedPoints.push({ ...pt, x: cmd.x2, y: cmd.y2 });
      } else {
        updatedPoints.push(pt);
      }
      newCommands[pt.commandIndex] = cmd;
    }

    setCommands(newCommands);
    setSelectedPoints(updatedPoints);
    setTransform(DEFAULT_TRANSFORM);
  }, [commands, selectedPoints, history]);

  const cycleGlyph = useCallback((direction: 1 | -1) => {
    if (!fontState.font) return;
    const total = fontState.font.glyphs.length;
    if (total === 0) return;
    const current = fontState.selectedGlyphIndex ?? -1;
    let next = current + direction;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    handleSelectGlyph(next);
  }, [fontState.font, fontState.selectedGlyphIndex, handleSelectGlyph]);

  const handleToggleCornerPoint = useCallback((commandIndex: number) => {
    setCornerPoints((prev) => {
      const next = new Set(prev);
      if (next.has(commandIndex)) next.delete(commandIndex);
      else next.add(commandIndex);
      return next;
    });
  }, []);

  const handleSetCornerPoints = useCallback((indices: number[]) => {
    setCornerPoints((prev) => {
      const next = new Set(prev);
      for (const idx of indices) next.add(idx);
      return next;
    });
  }, []);

  const handleConvertPointType = useCallback((targetType: 'L' | 'Q' | 'C') => {
    if (selectedPoints.length === 0) return;
    history.pushState(commands);
    let newCommands = commands.map((cmd) => ({ ...cmd }));
    const indices = new Set<number>();
    for (const pt of selectedPoints) {
      const cmd = newCommands[pt.commandIndex];
      if (cmd && cmd.type !== 'Z') {
        if (cmd.type === 'M') {
          // For the start point of a closed contour, find the closing segment
          // (the last L/Q/C before the next Z) and convert that instead.
          // If there's no explicit closing segment, materialize one.
          let zIdx = -1;
          for (let i = pt.commandIndex + 1; i < newCommands.length; i++) {
            if (newCommands[i].type === 'Z') {
              zIdx = i;
              break;
            }
          }
          if (zIdx > pt.commandIndex) {
            const beforeZ = newCommands[zIdx - 1];
            if (beforeZ.type === 'L' || beforeZ.type === 'Q' || beforeZ.type === 'C') {
              // The closing segment already has an explicit command
              indices.add(zIdx - 1);
            } else if (beforeZ.x !== undefined && beforeZ.y !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
              // No explicit closing segment — insert an L back to the start
              const closingL: PathCommand = { type: 'L', x: cmd.x, y: cmd.y };
              newCommands.splice(zIdx, 0, closingL);
              indices.add(zIdx);
            }
          }
        } else {
          indices.add(pt.commandIndex);
        }
      }
    }
    for (const idx of indices) {
      newCommands = convertSegmentToType(newCommands, idx, targetType);
    }
    setCommands(newCommands);
    setTransform(DEFAULT_TRANSFORM);
    const newPts = getEditablePoints(newCommands);
    const updated = selectedPoints
      .map((sp) => newPts.find((np) => np.commandIndex === sp.commandIndex && np.field === 'end'))
      .filter((p): p is EditablePoint => p !== undefined);
    setSelectedPoints(updated);
  }, [commands, selectedPoints, history]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      if (e.metaKey && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (e.metaKey && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      if (e.metaKey && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.metaKey && e.key === 'o') {
        e.preventDefault();
        loadFont();
        return;
      }
      if (e.metaKey && e.key === 'c') {
        e.preventDefault();
        if (activeTool === 'shape' && selectedContours.length > 0) {
          contourClipboardRef.current = extractContours(commands, selectedContours);
        } else {
          clipboardRef.current = cloneCommands(commands);
        }
        return;
      }
      if (e.metaKey && e.key === 'v') {
        e.preventDefault();
        if (activeTool === 'shape' && contourClipboardRef.current) {
          history.pushState(commands);
          const pasted = cloneCommands(contourClipboardRef.current);
          const offset = translateContourCommands(
            pasted,
            Array.from({ length: getContourRanges(pasted).length }, (_, i) => i),
            20, 20,
          );
          const newCmds = [...commands, ...offset];
          setCommands(newCmds);
          const ranges = getContourRanges(newCmds);
          const pastedRanges = getContourRanges(offset);
          const newIndices = Array.from({ length: pastedRanges.length }, (_, i) => ranges.length - pastedRanges.length + i);
          setSelectedContours(newIndices);
        } else if (clipboardRef.current) {
          history.pushState(commands);
          setCommands(cloneCommands(clipboardRef.current));
          setTransform(DEFAULT_TRANSFORM);
          setSelectedPoints([]);
        }
        return;
      }
      if (e.metaKey && e.key === 'd') {
        e.preventDefault();
        if (activeTool === 'shape' && selectedContours.length > 0) {
          history.pushState(commands);
          const duped = extractContours(commands, selectedContours);
          const offset = translateContourCommands(
            duped,
            Array.from({ length: getContourRanges(duped).length }, (_, i) => i),
            20, 20,
          );
          const newCmds = [...commands, ...offset];
          setCommands(newCmds);
          const ranges = getContourRanges(newCmds);
          const dupedRanges = getContourRanges(offset);
          setSelectedContours(Array.from({ length: dupedRanges.length }, (_, i) => ranges.length - dupedRanges.length + i));
        }
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (activeTool === 'shape' && selectedContours.length > 0) {
          history.pushState(commands);
          setCommands(removeContours(commands, selectedContours));
          setSelectedContours([]);
          return;
        }
        handleDeletePoints();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editingComponentId) {
          commitComponentEdit();
          setEditingComponentId(null);
          setSelectedComponentId(null);
          if (fontState.selectedGlyphIndex !== null) {
            const ownCmds = glyphOwnCommandsRef.current[fontState.selectedGlyphIndex];
            if (ownCmds) setCommands(cloneCommands(ownCmds));
          }
          return;
        }
        setSelectedPoints([]);
        setSelectedContours([]);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        cycleGlyph(e.shiftKey ? -1 : 1);
        return;
      }

      if (e.key === '1') { e.preventDefault(); handleConvertPointType('L'); return; }
      if (e.key === '2') { e.preventDefault(); handleConvertPointType('Q'); return; }
      if (e.key === '3') { e.preventDefault(); handleConvertPointType('C'); return; }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setActiveTool((t) => (t === 'pen' ? 'select' : 'pen'));
        return;
      }
      if (e.key === 'R' && e.shiftKey && !e.metaKey) {
        e.preventDefault();
        handleReverseContour();
        return;
      }
      if (e.key === 'H' && e.shiftKey && !e.metaKey) {
        e.preventDefault();
        handleFlipContour('horizontal');
        return;
      }
      if (e.key === 'V' && e.shiftKey && !e.metaKey && e.altKey) {
        e.preventDefault();
        handleFlipContour('vertical');
        return;
      }
      if (e.key === 'r' && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setActiveTool((t) => (t === 'rect' ? 'select' : 'rect'));
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !e.metaKey) {
        e.preventDefault();
        setActiveTool((t) => (t === 'ellipse' ? 'select' : 'ellipse'));
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        setActiveTool((t) => (t === 'shape' ? 'select' : 'shape'));
        return;
      }
      if ((e.key === 'x' || e.key === 'X') && !e.metaKey) {
        e.preventDefault();
        setActiveTool((t) => (t === 'slice' ? 'select' : 'slice'));
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        if (!e.metaKey) { e.preventDefault(); setActiveTool('select'); return; }
      }
      if (e.key === 'f' || e.key === 'F') {
        if (!e.metaKey) { e.preventDefault(); setShowFill((s) => !s); return; }
      }

      const nudgeAmount = e.shiftKey && !e.altKey ? 10 : 1;
      const scaleUp = 1.05;
      const scaleDown = 1 / scaleUp;
      const isShapeWithSelection = activeTool === 'shape' && selectedContours.length > 0;
      const isScaleMode = e.shiftKey && isShapeWithSelection;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (isScaleMode) {
          if (e.altKey) handleScaleContours(scaleDown, scaleDown, true);
          else handleScaleContours(scaleDown, 1, false);
        } else if (isShapeWithSelection) handleNudgeContours(-nudgeAmount, 0);
        else handleNudge(-nudgeAmount, 0);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (isScaleMode) {
          if (e.altKey) handleScaleContours(scaleUp, scaleUp, true);
          else handleScaleContours(scaleUp, 1, false);
        } else if (isShapeWithSelection) handleNudgeContours(nudgeAmount, 0);
        else handleNudge(nudgeAmount, 0);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (isScaleMode) {
          if (e.altKey) handleScaleContours(scaleUp, scaleUp, true);
          else handleScaleContours(1, scaleUp, false);
        } else if (isShapeWithSelection) handleNudgeContours(0, nudgeAmount);
        else handleNudge(0, nudgeAmount);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (isScaleMode) {
          if (e.altKey) handleScaleContours(scaleDown, scaleDown, true);
          else handleScaleContours(1, scaleDown, false);
        } else if (isShapeWithSelection) handleNudgeContours(0, -nudgeAmount);
        else handleNudge(0, -nudgeAmount);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleSelectAll, handleSave, loadFont, handleDeletePoints, handleNudge, handleNudgeContours, handleScaleContours, cycleGlyph, handleConvertPointType, commands, history, handleReverseContour, handleFlipContour, activeTool, selectedContours, editingComponentId, commitComponentEdit, setSelectedComponentId]);

  if (!fontState.font) {
    return <FontUploader onFontLoaded={loadFontFromBuffer} onOpenDialog={loadFont} onCreateNew={createNewFont} />;
  }

  return (
    <div className="app">
      <Toolbar
        fileName={fontState.fileName}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        hasGlyph={selectedGlyph !== null}
        hasSelection={selectedPoints.length > 0 || selectedContours.length > 0}
        onNew={createNewFont}
        onOpen={loadFont}
        onSave={handleSave}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onZoomIn={() => setZoom((z) => Math.min(10, z * 1.2))}
        onZoomOut={() => setZoom((z) => Math.max(0.1, z / 1.2))}
        onZoomReset={() => setZoom(1)}
        onDelete={handleDeletePoints}
        zoom={zoom}
        theme={theme}
        onToggleTheme={toggleTheme}
        showRulers={showRulers}
        onToggleRulers={() => setShowRulers((r) => !r)}
        showPathDirection={showPathDirection}
        onTogglePathDirection={() => setShowPathDirection((d) => !d)}
        showFill={showFill}
        onToggleFill={() => setShowFill((f) => !f)}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onReverseContour={handleReverseContour}
        onFlipHorizontal={() => handleFlipContour('horizontal')}
        onFlipVertical={() => handleFlipContour('vertical')}
      />
      <div className="main-content">
        <GlyphGrid
          font={fontState.font}
          selectedIndex={fontState.selectedGlyphIndex}
          onSelect={handleSelectGlyphWithCompExit}
          onAddGlyph={handleAddGlyph}
          onRemoveGlyph={handleRemoveGlyph}
          onRenameGlyph={handleRenameGlyph}
          theme={theme}
          fontVersion={fontVersion}
          contextGlyphs={contextGlyphs}
          onContextChange={handleContextChange}
          components={compLibrary}
          selectedComponentId={selectedComponentId}
          onSelectComponent={handleSelectComponent}
          onAddComponent={handleAddComponentBlank}
          onRemoveComponent={removeComponent}
          onRenameComponent={renameComponent}
          onInsertComponent={handleInsertComponentFromSidebar}
        />
        <div className="editor-area">
          {editingComponentId && (
            <div className="component-edit-banner">
              Editing Component: <strong>{compLibrary.find(c => c.id === editingComponentId)?.name || '?'}</strong>
              <button onClick={() => {
                commitComponentEdit();
                setEditingComponentId(null);
                setSelectedComponentId(null);
                if (fontState.selectedGlyphIndex !== null) {
                  const ownCmds = glyphOwnCommandsRef.current[fontState.selectedGlyphIndex];
                  if (ownCmds) setCommands(cloneCommands(ownCmds));
                }
              }}>Done</button>
            </div>
          )}
          {(selectedGlyph || editingComponentId) ? (
            <>
              <GlyphEditor
                commands={displayCommands}
                font={fontState.font}
                glyph={selectedGlyph || fontState.font.glyphs.get(0)}
                onCommandsChange={handleCommandsChange}
                onDragStart={handleDragStart}
                zoom={zoom}
                panX={panX}
                panY={panY}
                onZoomChange={setZoom}
                onPanChange={handlePanChange}
                theme={theme}
                gridSettings={gridSettings}
                showRulers={showRulers}
                showPathDirection={showPathDirection}
                selectedPoints={selectedPoints}
                onSelectedPointsChange={setSelectedPoints}
                onDeletePoints={handleDeletePoints}
                onAddPoint={handleAddPoint}
                onBreakSegment={handleBreakSegment}
                onSlice={handleSlice}
                activeTool={activeTool}
                cornerPoints={cornerPoints}
                onCornerPointsChange={handleToggleCornerPoint}
                onSetCornerPoints={handleSetCornerPoints}
                showFill={showFill}
                contextGlyphs={contextGlyphs}
                onSwitchActiveGlyph={handleSwitchActiveGlyph}
                metricLines={metricLines}
                selectedContours={selectedContours}
                onSelectedContoursChange={setSelectedContours}
                onCreateComponentFromSelection={handleCreateComponentFromSelection}
                onInsertComponentById={handleInsertComponentById}
                availableComponents={compLibrary.map(c => ({ id: c.id, name: c.name }))}
                componentInstances={componentInstancesForEditor}
                onDecomposeInstance={handleDecomposeInstance}
                onMoveInstance={handleMoveInstance}
                onReverseContour={handleReverseContour}
                onMakeCutout={handleMakeCutout}
                onMakeFill={handleMakeFill}
                onMakeIndent={handleMakeIndent}
              />
              <div className="info-button-container">
                <button
                  className={`info-toggle-btn ${showControlsInfo ? 'active' : ''}`}
                  onClick={() => setShowControlsInfo(v => !v)}
                  title="Keyboard shortcuts"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                  </svg>
                </button>
                {showControlsInfo && (
                  <div className="controls-info-popup">
                    <div className="controls-info-header">
                      <span>Keyboard Shortcuts</span>
                      <button className="controls-info-close" onClick={() => setShowControlsInfo(false)}>&times;</button>
                    </div>
                    <div className="controls-help">
                      <p><kbd>Click</kbd> select point</p>
                      <p><kbd>Shift+Click</kbd> add to selection</p>
                      <p><kbd>Drag</kbd> on empty to marquee select</p>
                      <p><kbd>Drag</kbd> point to move selected</p>
                      <p><kbd>Double-click</kbd> segment to add point</p>
                      <p><kbd>Shift+Dbl-click</kbd> or right-click segment: break</p>
                      <p><kbd>Double-click</kbd> point: smooth/corner</p>
                      <p><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> line / quad / cubic</p>
                      <p><kbd>P</kbd> pen &middot; <kbd>R</kbd> rect &middot; <kbd>E</kbd> ellipse &middot; <kbd>X</kbd> slice</p>
                      <p><kbd>V</kbd> select &middot; <kbd>A</kbd> shape select</p>
                      <p><kbd>Arrow</kbd> nudge 1u &middot; <kbd>Shift</kbd> 10u (points)</p>
                      <p><kbd>Shift+Arrow</kbd> scale &middot; <kbd>Shift+Alt+Arrow</kbd> uniform (shape)</p>
                      <p><kbd>&#8679;R</kbd> reverse &middot; <kbd>&#8679;H</kbd> flip H &middot; <kbd>&#8679;&#8997;V</kbd> flip V</p>
                      <p><kbd>Shift+Drag</kbd> constrain to square/circle</p>
                      <p><kbd>Delete</kbd> remove selected points</p>
                      <p><kbd>Space+Drag</kbd> or <kbd>Option+Drag</kbd> pan</p>
                      <p><kbd>Scroll</kbd> zoom at cursor</p>
                      <p><kbd>&#8984;A</kbd> select all &middot; <kbd>&#8984;Z</kbd> undo &middot; <kbd>&#8984;&#8679;Z</kbd> redo</p>
                      <p><kbd>&#8984;C</kbd> / <kbd>&#8984;V</kbd> copy / paste &middot; <kbd>&#8984;D</kbd> duplicate</p>
                      <p><kbd>&#8984;S</kbd> export &middot; <kbd>&#8984;O</kbd> open</p>
                      <p><kbd>Tab</kbd> / <kbd>&#8679;Tab</kbd> next / prev glyph</p>
                      <p><kbd>Esc</kbd> deselect</p>
                    </div>
                  </div>
                )}
              </div>
              {showPreview && (
                <TextPreview font={fontState.font} theme={theme} fontVersion={fontVersion} glyphCommands={displayCommandsWithComponents} selectedGlyphIndex={fontState.selectedGlyphIndex} pendingTracking={pendingTracking} />
              )}
            </>
          ) : (
            <div className="editor-placeholder">
              <div className="placeholder-content">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <p>Select a glyph from the sidebar to begin editing</p>
              </div>
            </div>
          )}
        </div>
        {(selectedGlyph || editingComponentId) && fontState.font && (
          <div className="right-sidebar">
            <div className="sidebar-tab-bar">
              <button
                className={`sidebar-tab ${sidebarTab === 'transform' ? 'active' : ''}`}
                onClick={() => setSidebarTab('transform')}
              >
                Transform
              </button>
              <button
                className={`sidebar-tab ${sidebarTab === 'kerning' ? 'active' : ''}`}
                onClick={() => setSidebarTab('kerning')}
              >
                Kerning
              </button>
            </div>
            {sidebarTab === 'transform' ? (
              <SliderPanel
                transform={transform}
                onChange={setTransform}
                onApply={handleApplyTransform}
                onApplyToAll={handleApplyToAll}
                font={fontState.font}
                glyph={selectedGlyph}
                commandCount={displayCommands.length}
                gridSettings={gridSettings}
                onGridChange={setGridSettings}
                selectedPointCount={selectedPoints.length}
                metricLines={metricLines}
                onMetricLinesChange={setMetricLines}
                designTools={designTools}
                onDesignToolsChange={setDesignTools}
                onApplyDesignTools={handleApplyDesignTools}
                onApplyDesignToolsToAll={handleApplyDesignToolsToAll}
              />
            ) : (
              <KerningPanel
                font={fontState.font}
                theme={theme}
                onFontChanged={handleFontChanged}
                onTrackingChange={setPendingTracking}
                selectedGlyphIndex={fontState.selectedGlyphIndex}
                commands={commands}
                onCommandsChange={handleCommandsChange}
              />
            )}
          </div>
        )}
      </div>
      {showExportDialog && fontState.font && (
        <ExportDialog
          font={fontState.font}
          theme={theme}
          currentFileName={fontState.fileName}
          onExport={handleExport}
          onCancel={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
}
