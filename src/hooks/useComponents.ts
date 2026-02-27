import { useState, useCallback } from 'react';
import type { PathCommand } from 'opentype.js';
import type { ComponentDef, ComponentInstance, GlyphComponents } from '../types';

let nextId = 1;
function genId(): string {
  return `comp_${Date.now()}_${nextId++}`;
}

function transformCommands(
  commands: PathCommand[],
  inst: ComponentInstance,
): PathCommand[] {
  const { offsetX, offsetY, scaleX, scaleY, rotation } = inst;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const xform = (x: number, y: number): { x: number; y: number } => {
    const sx = x * scaleX;
    const sy = y * scaleY;
    return {
      x: Math.round(sx * cos - sy * sin + offsetX),
      y: Math.round(sx * sin + sy * cos + offsetY),
    };
  };

  return commands.map((cmd) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = { ...cmd };
    if (c.x !== undefined && c.y !== undefined) {
      const p = xform(c.x, c.y);
      c.x = p.x;
      c.y = p.y;
    }
    if (c.x1 !== undefined && c.y1 !== undefined) {
      const p = xform(c.x1, c.y1);
      c.x1 = p.x;
      c.y1 = p.y;
    }
    if (c.x2 !== undefined && c.y2 !== undefined) {
      const p = xform(c.x2, c.y2);
      c.x2 = p.x;
      c.y2 = p.y;
    }
    return c as PathCommand;
  });
}

export function useComponents() {
  const [components, setComponents] = useState<ComponentDef[]>([]);
  const [glyphComponents, setGlyphComponents] = useState<GlyphComponents>({});
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

  const addComponent = useCallback(
    (name: string, commands: PathCommand[], advanceWidth: number = 600): string => {
      const id = genId();
      const def: ComponentDef = {
        id,
        name,
        commands: commands.map((c) => ({ ...c })),
        advanceWidth,
      };
      setComponents((prev) => [...prev, def]);
      return id;
    },
    [],
  );

  const updateComponent = useCallback(
    (id: string, commands: PathCommand[]) => {
      setComponents((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, commands: commands.map((cmd) => ({ ...cmd })) } : c,
        ),
      );
    },
    [],
  );

  const removeComponent = useCallback(
    (id: string) => {
      setComponents((prev) => prev.filter((c) => c.id !== id));
      setGlyphComponents((prev) => {
        const next: GlyphComponents = {};
        for (const [key, instances] of Object.entries(prev)) {
          const filtered = instances.filter((inst) => inst.componentId !== id);
          if (filtered.length > 0) next[Number(key)] = filtered;
        }
        return next;
      });
      if (selectedComponentId === id) setSelectedComponentId(null);
    },
    [selectedComponentId],
  );

  const renameComponent = useCallback(
    (id: string, newName: string) => {
      setComponents((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name: newName } : c)),
      );
    },
    [],
  );

  const addInstance = useCallback(
    (
      glyphIndex: number,
      componentId: string,
      offsetX: number = 0,
      offsetY: number = 0,
    ) => {
      const inst: ComponentInstance = {
        componentId,
        offsetX,
        offsetY,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      };
      setGlyphComponents((prev) => ({
        ...prev,
        [glyphIndex]: [...(prev[glyphIndex] || []), inst],
      }));
    },
    [],
  );

  const updateInstance = useCallback(
    (glyphIndex: number, instanceIndex: number, updates: Partial<ComponentInstance>) => {
      setGlyphComponents((prev) => {
        const instances = [...(prev[glyphIndex] || [])];
        if (instanceIndex < 0 || instanceIndex >= instances.length) return prev;
        instances[instanceIndex] = { ...instances[instanceIndex], ...updates };
        return { ...prev, [glyphIndex]: instances };
      });
    },
    [],
  );

  const removeInstance = useCallback(
    (glyphIndex: number, instanceIndex: number) => {
      setGlyphComponents((prev) => {
        const instances = [...(prev[glyphIndex] || [])];
        instances.splice(instanceIndex, 1);
        const next = { ...prev };
        if (instances.length === 0) {
          delete next[glyphIndex];
        } else {
          next[glyphIndex] = instances;
        }
        return next;
      });
    },
    [],
  );

  const resolveInstance = useCallback(
    (inst: ComponentInstance): PathCommand[] => {
      const def = components.find((c) => c.id === inst.componentId);
      if (!def) return [];
      return transformCommands(def.commands, inst);
    },
    [components],
  );

  const resolveGlyphComponents = useCallback(
    (glyphIndex: number): PathCommand[] => {
      const instances = glyphComponents[glyphIndex];
      if (!instances || instances.length === 0) return [];
      const result: PathCommand[] = [];
      for (const inst of instances) {
        result.push(...resolveInstance(inst));
      }
      return result;
    },
    [glyphComponents, resolveInstance],
  );

  const decomposeInstance = useCallback(
    (glyphIndex: number, instanceIndex: number): PathCommand[] => {
      const instances = glyphComponents[glyphIndex];
      if (!instances || instanceIndex < 0 || instanceIndex >= instances.length) return [];
      const resolved = resolveInstance(instances[instanceIndex]);
      removeInstance(glyphIndex, instanceIndex);
      return resolved;
    },
    [glyphComponents, resolveInstance, removeInstance],
  );

  const getComponent = useCallback(
    (id: string): ComponentDef | undefined => {
      return components.find((c) => c.id === id);
    },
    [components],
  );

  return {
    components,
    glyphComponents,
    selectedComponentId,
    setSelectedComponentId,
    addComponent,
    updateComponent,
    removeComponent,
    renameComponent,
    addInstance,
    updateInstance,
    removeInstance,
    resolveInstance,
    resolveGlyphComponents,
    decomposeInstance,
    getComponent,
  };
}
