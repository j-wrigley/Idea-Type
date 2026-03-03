import { useState, useCallback } from 'react';
import type { PathCommand } from 'opentype.js';
import type { SegmentDef } from '../types';

let nextId = 1;
function genId(): string {
  return `seg_${Date.now()}_${nextId++}`;
}

function makePresets(): SegmentDef[] {
  return [
    {
      id: 'preset_inktrap_v',
      name: 'V Ink Trap',
      category: 'ink-trap',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 50, y: -40 },
        { type: 'L', x: 100, y: 0 },
      ],
    },
    {
      id: 'preset_inktrap_round',
      name: 'Round Ink Trap',
      category: 'ink-trap',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 20, y1: -30, x2: 80, y2: -30, x: 100, y: 0 },
      ],
    },
    {
      id: 'preset_inktrap_flat',
      name: 'Flat Ink Trap',
      category: 'ink-trap',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 30, y: -20 },
        { type: 'L', x: 70, y: -20 },
        { type: 'L', x: 100, y: 0 },
      ],
    },
    {
      id: 'preset_serif_bracket',
      name: 'Serif Bracket',
      category: 'serif',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 0, y1: 40, x2: 30, y2: 60, x: 60, y: 60 },
        { type: 'L', x: 100, y: 60 },
        { type: 'L', x: 100, y: 0 },
      ],
    },
    {
      id: 'preset_curve_bump',
      name: 'Curve Bump',
      category: 'decorative',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 25, y1: 50, x2: 75, y2: 50, x: 100, y: 0 },
      ],
    },
    {
      id: 'preset_wave',
      name: 'Wave',
      category: 'decorative',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 20, y1: 40, x2: 30, y2: 40, x: 50, y: 0 },
        { type: 'C', x1: 70, y1: -40, x2: 80, y2: -40, x: 100, y: 0 },
      ],
    },
    {
      id: 'preset_notch',
      name: 'Notch',
      category: 'custom',
      builtin: true,
      commands: [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 40, y: 0 },
        { type: 'L', x: 40, y: -30 },
        { type: 'L', x: 60, y: -30 },
        { type: 'L', x: 60, y: 0 },
        { type: 'L', x: 100, y: 0 },
      ],
    },
  ];
}

export function useSegments() {
  const [segments, setSegments] = useState<SegmentDef[]>(makePresets);

  const addSegment = useCallback(
    (name: string, commands: PathCommand[], category: SegmentDef['category'] = 'custom'): string => {
      const id = genId();
      const def: SegmentDef = {
        id,
        name,
        commands: commands.map(c => ({ ...c })),
        category,
      };
      setSegments(prev => [...prev, def]);
      return id;
    },
    [],
  );

  const updateSegment = useCallback(
    (id: string, commands: PathCommand[]) => {
      setSegments(prev =>
        prev.map(s =>
          s.id === id ? { ...s, commands: commands.map(c => ({ ...c })) } : s,
        ),
      );
    },
    [],
  );

  const removeSegment = useCallback(
    (id: string) => {
      setSegments(prev => prev.filter(s => s.id !== id || s.builtin));
    },
    [],
  );

  const renameSegment = useCallback(
    (id: string, newName: string) => {
      setSegments(prev =>
        prev.map(s => (s.id === id ? { ...s, name: newName } : s)),
      );
    },
    [],
  );

  const getSegment = useCallback(
    (id: string): SegmentDef | undefined => {
      return segments.find(s => s.id === id);
    },
    [segments],
  );

  return {
    segments,
    addSegment,
    updateSegment,
    removeSegment,
    renameSegment,
    getSegment,
  };
}
