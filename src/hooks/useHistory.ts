import { useState, useCallback, useRef } from 'react';
import type { PathCommand } from 'opentype.js';

function cloneCommands(commands: PathCommand[]): PathCommand[] {
  return commands.map((cmd) => ({ ...cmd }));
}

export function useHistory() {
  const undoStack = useRef<PathCommand[][]>([]);
  const redoStack = useRef<PathCommand[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushState = useCallback((commands: PathCommand[]) => {
    undoStack.current.push(cloneCommands(commands));
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(
    (currentCommands: PathCommand[]): PathCommand[] | null => {
      if (undoStack.current.length === 0) return null;
      const prev = undoStack.current.pop()!;
      redoStack.current.push(cloneCommands(currentCommands));
      setCanUndo(undoStack.current.length > 0);
      setCanRedo(true);
      return prev;
    },
    [],
  );

  const redo = useCallback(
    (currentCommands: PathCommand[]): PathCommand[] | null => {
      if (redoStack.current.length === 0) return null;
      const next = redoStack.current.pop()!;
      undoStack.current.push(cloneCommands(currentCommands));
      setCanRedo(redoStack.current.length > 0);
      setCanUndo(true);
      return next;
    },
    [],
  );

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { pushState, undo, redo, clear, canUndo, canRedo };
}
