import type { PathCommand } from 'opentype.js';
import type { TransformValues } from '../types';
import type { DesignToolValues } from '../components/SliderPanel';

export interface ContourRange {
  start: number;
  end: number;
}

export function getContourRanges(commands: PathCommand[]): ContourRange[] {
  const ranges: ContourRange[] = [];
  let start = -1;
  for (let i = 0; i < commands.length; i++) {
    if (commands[i].type === 'M') {
      if (start >= 0) {
        ranges.push({ start, end: i - 1 });
      }
      start = i;
    } else if (commands[i].type === 'Z' && start >= 0) {
      ranges.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0) {
    ranges.push({ start, end: commands.length - 1 });
  }
  return ranges;
}

export function isContourClockwise(commands: PathCommand[], contourIndex: number): boolean {
  const ranges = getContourRanges(commands);
  if (contourIndex < 0 || contourIndex >= ranges.length) return true;
  const { start, end } = ranges[contourIndex];

  const pts: { x: number; y: number }[] = [];
  for (let i = start; i <= end; i++) {
    const cmd = commands[i];
    if (cmd.x !== undefined && cmd.y !== undefined) {
      pts.push({ x: cmd.x, y: cmd.y });
    }
  }
  if (pts.length < 3) return true;

  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  // In font coordinate space (y-up), positive area = counter-clockwise, negative = clockwise
  return area < 0;
}

function reverseSingleContour(commands: PathCommand[], contourIndex: number): PathCommand[] {
  const ranges = getContourRanges(commands);
  if (contourIndex < 0 || contourIndex >= ranges.length) return commands;

  const { start, end } = ranges[contourIndex];
  const contourCmds = commands.slice(start, end + 1);
  const hasZ = contourCmds[contourCmds.length - 1]?.type === 'Z';
  const moveCmd = contourCmds[0];
  if (!moveCmd || moveCmd.type !== 'M') return commands;

  const segments = contourCmds.slice(1, hasZ ? contourCmds.length - 1 : contourCmds.length);
  if (segments.length === 0) return commands;

  const lastSeg = segments[segments.length - 1];
  const newMoveX = lastSeg?.x ?? moveCmd.x ?? 0;
  const newMoveY = lastSeg?.y ?? moveCmd.y ?? 0;

  const reversed: PathCommand[] = [{ type: 'M', x: newMoveX, y: newMoveY }];

  let prevX = moveCmd.x ?? 0;
  let prevY = moveCmd.y ?? 0;
  const endpoints: Array<{ x: number; y: number }> = [{ x: prevX, y: prevY }];
  for (const seg of segments) {
    endpoints.push({ x: seg.x ?? prevX, y: seg.y ?? prevY });
    prevX = seg.x ?? prevX;
    prevY = seg.y ?? prevY;
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const target = endpoints[i];

    if (seg.type === 'L') {
      reversed.push({ type: 'L', x: target.x, y: target.y });
    } else if (seg.type === 'Q') {
      reversed.push({
        type: 'Q',
        x1: seg.x1,
        y1: seg.y1,
        x: target.x,
        y: target.y,
      });
    } else if (seg.type === 'C') {
      reversed.push({
        type: 'C',
        x1: seg.x2,
        y1: seg.y2,
        x2: seg.x1,
        y2: seg.y1,
        x: target.x,
        y: target.y,
      });
    }
  }

  if (hasZ) {
    reversed.push({ type: 'Z' });
  }

  const result = [...commands.slice(0, start), ...reversed, ...commands.slice(end + 1)];
  return result;
}

export function reverseContour(commands: PathCommand[], contourIndex: number): PathCommand[] {
  return reverseSingleContour(commands, contourIndex);
}

export function reverseContours(commands: PathCommand[], contourIndices: number[]): PathCommand[] {
  const sorted = [...contourIndices].sort((a, b) => b - a);
  let result = [...commands.map(c => ({ ...c }))];
  for (const ci of sorted) {
    result = reverseSingleContour(result, ci);
  }
  return result;
}

export function makeContourCutout(commands: PathCommand[], contourIndices: number[]): PathCommand[] {
  let result = [...commands.map(c => ({ ...c }))];
  const sorted = [...contourIndices].sort((a, b) => b - a);
  for (const ci of sorted) {
    if (isContourClockwise(result, ci)) {
      result = reverseSingleContour(result, ci);
    }
  }
  return result;
}

export function makeContourFill(commands: PathCommand[], contourIndices: number[]): PathCommand[] {
  let result = [...commands.map(c => ({ ...c }))];
  const sorted = [...contourIndices].sort((a, b) => b - a);
  for (const ci of sorted) {
    if (!isContourClockwise(result, ci)) {
      result = reverseSingleContour(result, ci);
    }
  }
  return result;
}

export function cloneCommands(commands: PathCommand[]): PathCommand[] {
  return commands.map((cmd) => ({ ...cmd }));
}

/**
 * Remove redundant points from a path:
 * 1. Zero-length line segments (consecutive L to same position)
 * 2. Degenerate curves where all control points and endpoint coincide
 * 3. Closing L commands that return to the contour's M position (Z already does this)
 */
export function removeDuplicatePoints(commands: PathCommand[]): PathCommand[] {
  if (commands.length === 0) return commands;

  const TOLERANCE = 1;

  // Pass 1: find closing L commands that go back to the contour's M position.
  // These are redundant because Z already closes the path.
  const closingLToRemove = new Set<number>();
  let mIdx = -1;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === 'M') {
      mIdx = i;
    } else if (cmd.type === 'Z' && mIdx >= 0) {
      const mCmd = commands[mIdx];
      if (mCmd.x !== undefined && mCmd.y !== undefined) {
        // Walk backwards from Z to find the last drawing command
        for (let j = i - 1; j > mIdx; j--) {
          const prev = commands[j];
          if (prev.type === 'L' && prev.x !== undefined && prev.y !== undefined &&
              Math.abs(prev.x - mCmd.x) < TOLERANCE &&
              Math.abs(prev.y - mCmd.y) < TOLERANCE) {
            closingLToRemove.add(j);
          }
          break;
        }
      }
      mIdx = -1;
    }
  }

  // Pass 2: filter out consecutive duplicates and the closing-L commands
  const result: PathCommand[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;

  for (let i = 0; i < commands.length; i++) {
    if (closingLToRemove.has(i)) continue;

    const cmd = commands[i];

    if (cmd.type === 'M') {
      result.push(cmd);
      lastX = cmd.x;
      lastY = cmd.y;
      continue;
    }

    if (cmd.type === 'Z') {
      result.push(cmd);
      lastX = undefined;
      lastY = undefined;
      continue;
    }

    if (cmd.type === 'L') {
      if (lastX !== undefined && lastY !== undefined &&
          cmd.x !== undefined && cmd.y !== undefined &&
          Math.abs(cmd.x - lastX) < TOLERANCE && Math.abs(cmd.y - lastY) < TOLERANCE) {
        continue;
      }
      result.push(cmd);
      lastX = cmd.x;
      lastY = cmd.y;
      continue;
    }

    if (cmd.type === 'Q') {
      if (lastX !== undefined && lastY !== undefined &&
          cmd.x !== undefined && cmd.y !== undefined &&
          cmd.x1 !== undefined && cmd.y1 !== undefined) {
        const allSame =
          Math.abs(cmd.x - lastX) < TOLERANCE && Math.abs(cmd.y - lastY) < TOLERANCE &&
          Math.abs(cmd.x1 - lastX) < TOLERANCE && Math.abs(cmd.y1 - lastY) < TOLERANCE;
        if (allSame) continue;
      }
      result.push(cmd);
      lastX = cmd.x;
      lastY = cmd.y;
      continue;
    }

    if (cmd.type === 'C') {
      if (lastX !== undefined && lastY !== undefined &&
          cmd.x !== undefined && cmd.y !== undefined &&
          cmd.x1 !== undefined && cmd.y1 !== undefined &&
          cmd.x2 !== undefined && cmd.y2 !== undefined) {
        const allSame =
          Math.abs(cmd.x - lastX) < TOLERANCE && Math.abs(cmd.y - lastY) < TOLERANCE &&
          Math.abs(cmd.x1 - lastX) < TOLERANCE && Math.abs(cmd.y1 - lastY) < TOLERANCE &&
          Math.abs(cmd.x2 - lastX) < TOLERANCE && Math.abs(cmd.y2 - lastY) < TOLERANCE;
        if (allSame) continue;
      }
      result.push(cmd);
      lastX = cmd.x;
      lastY = cmd.y;
      continue;
    }

    result.push(cmd);
  }

  return result;
}

export function extractContours(commands: PathCommand[], contourIndices: number[]): PathCommand[] {
  const ranges = getContourRanges(commands);
  const result: PathCommand[] = [];
  for (const ci of contourIndices) {
    if (ci >= 0 && ci < ranges.length) {
      const { start, end } = ranges[ci];
      result.push(...commands.slice(start, end + 1).map(c => ({ ...c })));
    }
  }
  return result;
}

export function removeContours(commands: PathCommand[], contourIndices: number[]): PathCommand[] {
  const ranges = getContourRanges(commands);
  const removeSet = new Set(contourIndices);
  const result: PathCommand[] = [];
  for (let ci = 0; ci < ranges.length; ci++) {
    if (!removeSet.has(ci)) {
      const { start, end } = ranges[ci];
      result.push(...commands.slice(start, end + 1));
    }
  }
  return result;
}

export function translateContourCommands(
  commands: PathCommand[],
  contourIndices: number[],
  dx: number,
  dy: number,
): PathCommand[] {
  const ranges = getContourRanges(commands);
  const inRange = (idx: number): boolean =>
    contourIndices.some(ci => ci >= 0 && ci < ranges.length && idx >= ranges[ci].start && idx <= ranges[ci].end);

  return commands.map((cmd, i) => {
    if (!inRange(i)) return cmd;
    const c: PathCommand = { ...cmd };
    if (c.x !== undefined) c.x = Math.round(c.x + dx);
    if (c.y !== undefined) c.y = Math.round(c.y + dy);
    if (c.x1 !== undefined) c.x1 = Math.round(c.x1 + dx);
    if (c.y1 !== undefined) c.y1 = Math.round(c.y1 + dy);
    if (c.x2 !== undefined) c.x2 = Math.round(c.x2 + dx);
    if (c.y2 !== undefined) c.y2 = Math.round(c.y2 + dy);
    return c;
  });
}

export function scaleContourCommands(
  commands: PathCommand[],
  contourIndices: number[],
  sx: number,
  sy: number,
  cx: number,
  cy: number,
): PathCommand[] {
  const ranges = getContourRanges(commands);
  const inRange = (idx: number): boolean =>
    contourIndices.some(ci => ci >= 0 && ci < ranges.length && idx >= ranges[ci].start && idx <= ranges[ci].end);

  return commands.map((cmd, i) => {
    if (!inRange(i)) return cmd;
    const c: PathCommand = { ...cmd };
    if (c.x !== undefined) c.x = Math.round(cx + (c.x - cx) * sx);
    if (c.y !== undefined) c.y = Math.round(cy + (c.y - cy) * sy);
    if (c.x1 !== undefined) c.x1 = Math.round(cx + (c.x1 - cx) * sx);
    if (c.y1 !== undefined) c.y1 = Math.round(cy + (c.y1 - cy) * sy);
    if (c.x2 !== undefined) c.x2 = Math.round(cx + (c.x2 - cx) * sx);
    if (c.y2 !== undefined) c.y2 = Math.round(cy + (c.y2 - cy) * sy);
    return c;
  });
}

export function flipContourCommands(
  commands: PathCommand[],
  contourIndices: number[],
  axis: 'horizontal' | 'vertical',
): PathCommand[] {
  const ranges = getContourRanges(commands);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ci of contourIndices) {
    if (ci < 0 || ci >= ranges.length) continue;
    const b = getContourBounds(commands, ci);
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = axis === 'horizontal' ? -1 : 1;
  const sy = axis === 'vertical' ? -1 : 1;
  return scaleContourCommands(commands, contourIndices, sx, sy, cx, cy);
}

/**
 * Breaks the connection between two anchor points by removing the segment.
 * Keeps both points; the contour is split into two (one ending at the "from" point,
 * one starting at the "to" point). Both can then be connected to others.
 */
export function breakSegment(
  commands: PathCommand[],
  segmentCommandIndex: number,
): PathCommand[] {
  const cmd = commands[segmentCommandIndex];
  if ((cmd.type !== 'L' && cmd.type !== 'Q' && cmd.type !== 'C') || cmd.x === undefined || cmd.y === undefined) {
    return commands;
  }

  const ranges = getContourRanges(commands);
  const contourIdx = ranges.findIndex((r) => segmentCommandIndex >= r.start && segmentCommandIndex <= r.end);
  if (contourIdx < 0) return commands;
  const { start, end } = ranges[contourIdx];

  const toX = cmd.x;
  const toY = cmd.y;

  const result: PathCommand[] = [];

  // Part 1: everything before the segment (ends at "from" point)
  for (let i = 0; i < segmentCommandIndex; i++) {
    result.push(commands[i]);
  }
  // Part 1 is now open (no Z)

  // Part 2: new contour starting at "to" point
  result.push({ type: 'M', x: toX, y: toY });
  for (let i = segmentCommandIndex + 1; i <= end; i++) {
    const c = commands[i];
    if (c.type === 'Z') {
      // Close the new contour: L from last point back to this contour's start (toX, toY)
      result.push({ type: 'L', x: toX, y: toY });
      result.push({ type: 'Z' });
    } else {
      result.push({ ...c });
    }
  }

  // Part 3: any contours after this one
  for (let i = end + 1; i < commands.length; i++) {
    result.push(commands[i]);
  }

  return result;
}

export function getContourBounds(commands: PathCommand[], contourIndex: number): {
  minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number;
} {
  const ranges = getContourRanges(commands);
  if (contourIndex < 0 || contourIndex >= ranges.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0 };
  }
  const { start, end } = ranges[contourIndex];
  return getGlyphBounds(commands.slice(start, end + 1));
}

export function skewContourCommands(
  commands: PathCommand[],
  contourIndices: number[],
  skewXDeg: number,
  skewYDeg: number,
  cx: number,
  cy: number,
): PathCommand[] {
  const ranges = getContourRanges(commands);
  const inRange = (idx: number): boolean =>
    contourIndices.some(ci => ci >= 0 && ci < ranges.length && idx >= ranges[ci].start && idx <= ranges[ci].end);

  const tanX = Math.tan((skewXDeg * Math.PI) / 180);
  const tanY = Math.tan((skewYDeg * Math.PI) / 180);

  const skewPt = (x: number, y: number) => ({
    x: Math.round(x + (y - cy) * tanX),
    y: Math.round(y + (x - cx) * tanY),
  });

  return commands.map((cmd, i) => {
    if (!inRange(i)) return cmd;
    const c: PathCommand = { ...cmd };
    if (c.x !== undefined && c.y !== undefined) {
      const p = skewPt(c.x, c.y);
      c.x = p.x; c.y = p.y;
    }
    if (c.x1 !== undefined && c.y1 !== undefined) {
      const p = skewPt(c.x1, c.y1);
      c.x1 = p.x; c.y1 = p.y;
    }
    if (c.x2 !== undefined && c.y2 !== undefined) {
      const p = skewPt(c.x2, c.y2);
      c.x2 = p.x; c.y2 = p.y;
    }
    return c;
  });
}

export function rotateContourCommands(
  commands: PathCommand[],
  contourIndices: number[],
  angleDeg: number,
  cx: number,
  cy: number,
): PathCommand[] {
  const ranges = getContourRanges(commands);
  const inRange = (idx: number): boolean =>
    contourIndices.some(ci => ci >= 0 && ci < ranges.length && idx >= ranges[ci].start && idx <= ranges[ci].end);

  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotPt = (x: number, y: number) => {
    const dx = x - cx, dy = y - cy;
    return {
      x: Math.round(cx + dx * cos - dy * sin),
      y: Math.round(cy + dx * sin + dy * cos),
    };
  };

  return commands.map((cmd, i) => {
    if (!inRange(i)) return cmd;
    const c: PathCommand = { ...cmd };
    if (c.x !== undefined && c.y !== undefined) {
      const p = rotPt(c.x, c.y);
      c.x = p.x; c.y = p.y;
    }
    if (c.x1 !== undefined && c.y1 !== undefined) {
      const p = rotPt(c.x1, c.y1);
      c.x1 = p.x; c.y1 = p.y;
    }
    if (c.x2 !== undefined && c.y2 !== undefined) {
      const p = rotPt(c.x2, c.y2);
      c.x2 = p.x; c.y2 = p.y;
    }
    return c;
  });
}

function transformPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  shiftX: number,
  shiftY: number,
  skewX: number = 0,
  skewY: number = 0,
): { x: number; y: number } {
  let px = (x - cx) * scaleX;
  let py = (y - cy) * scaleY;

  // Apply skew (shear) before rotation, same order as professional tools
  if (skewX !== 0 || skewY !== 0) {
    const tanX = Math.tan((skewX * Math.PI) / 180);
    const tanY = Math.tan((skewY * Math.PI) / 180);
    const sx = px + py * tanX;
    const sy = py + px * tanY;
    px = sx;
    py = sy;
  }

  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx;
    py = ry;
  }

  return {
    x: px + cx + shiftX,
    y: py + cy + shiftY,
  };
}

export function getGlyphBounds(commands: PathCommand[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cmd of commands) {
    if (cmd.x !== undefined && cmd.y !== undefined) {
      minX = Math.min(minX, cmd.x);
      minY = Math.min(minY, cmd.y);
      maxX = Math.max(maxX, cmd.x);
      maxY = Math.max(maxY, cmd.y);
    }
    if (cmd.x1 !== undefined && cmd.y1 !== undefined) {
      minX = Math.min(minX, cmd.x1);
      minY = Math.min(minY, cmd.y1);
      maxX = Math.max(maxX, cmd.x1);
      maxY = Math.max(maxY, cmd.y1);
    }
    if (cmd.x2 !== undefined && cmd.y2 !== undefined) {
      minX = Math.min(minX, cmd.x2);
      minY = Math.min(minY, cmd.y2);
      maxX = Math.max(maxX, cmd.x2);
      maxY = Math.max(maxY, cmd.y2);
    }
  }

  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function applyTransform(
  commands: PathCommand[],
  transform: TransformValues,
): PathCommand[] {
  const bounds = getGlyphBounds(commands);
  const { cx, cy } = bounds;

  return commands.map((cmd) => {
    const newCmd: PathCommand = { ...cmd };

    if (newCmd.x !== undefined && newCmd.y !== undefined) {
      const p = transformPoint(
        newCmd.x, newCmd.y, cx, cy,
        transform.scaleX, transform.scaleY, transform.rotation,
        transform.shiftX, transform.shiftY, transform.skewX, transform.skewY,
      );
      newCmd.x = Math.round(p.x);
      newCmd.y = Math.round(p.y);
    }

    if (newCmd.x1 !== undefined && newCmd.y1 !== undefined) {
      const p = transformPoint(
        newCmd.x1, newCmd.y1, cx, cy,
        transform.scaleX, transform.scaleY, transform.rotation,
        transform.shiftX, transform.shiftY, transform.skewX, transform.skewY,
      );
      newCmd.x1 = Math.round(p.x);
      newCmd.y1 = Math.round(p.y);
    }

    if (newCmd.x2 !== undefined && newCmd.y2 !== undefined) {
      const p = transformPoint(
        newCmd.x2, newCmd.y2, cx, cy,
        transform.scaleX, transform.scaleY, transform.rotation,
        transform.shiftX, transform.shiftY, transform.skewX, transform.skewY,
      );
      newCmd.x2 = Math.round(p.x);
      newCmd.y2 = Math.round(p.y);
    }

    return newCmd;
  });
}

// --- Design Tools ---

function computeOutlineNormals(commands: PathCommand[]): Map<number, { nx: number; ny: number }> {
  const normals = new Map<number, { nx: number; ny: number }>();
  const ranges = getContourRanges(commands);

  for (const { start, end } of ranges) {
    const anchors: { idx: number; x: number; y: number }[] = [];
    for (let i = start; i <= end; i++) {
      const cmd = commands[i];
      if (cmd.x !== undefined && cmd.y !== undefined && cmd.type !== 'Z') {
        anchors.push({ idx: i, x: cmd.x, y: cmd.y });
      }
    }
    if (anchors.length < 2) continue;

    const isClosed = commands[end]?.type === 'Z';

    for (let j = 0; j < anchors.length; j++) {
      const curr = anchors[j];
      const prevJ = j > 0 ? j - 1 : (isClosed ? anchors.length - 1 : j);
      const nextJ = j < anchors.length - 1 ? j + 1 : (isClosed ? 0 : j);
      const prev = anchors[prevJ];
      const next = anchors[nextJ];

      const currCmd = commands[curr.idx];
      const nextCmd = commands[next.idx];

      // Incoming tangent: determined by how the current segment arrives at this point
      let inTx: number, inTy: number;
      if (currCmd.type === 'C' && currCmd.x2 !== undefined && currCmd.y2 !== undefined) {
        inTx = curr.x - currCmd.x2;
        inTy = curr.y - currCmd.y2;
      } else if (currCmd.type === 'Q' && currCmd.x1 !== undefined && currCmd.y1 !== undefined) {
        inTx = curr.x - currCmd.x1;
        inTy = curr.y - currCmd.y1;
      } else {
        inTx = curr.x - prev.x;
        inTy = curr.y - prev.y;
      }

      // Outgoing tangent: determined by how the next segment departs from this point
      let outTx: number, outTy: number;
      if (nextCmd && nextCmd.type === 'C' && nextCmd.x1 !== undefined && nextCmd.y1 !== undefined) {
        outTx = nextCmd.x1 - curr.x;
        outTy = nextCmd.y1 - curr.y;
      } else if (nextCmd && nextCmd.type === 'Q' && nextCmd.x1 !== undefined && nextCmd.y1 !== undefined) {
        outTx = nextCmd.x1 - curr.x;
        outTy = nextCmd.y1 - curr.y;
      } else {
        outTx = next.x - curr.x;
        outTy = next.y - curr.y;
      }

      const inLen = Math.sqrt(inTx * inTx + inTy * inTy);
      const outLen = Math.sqrt(outTx * outTx + outTy * outTy);

      // Normalize both tangent vectors, falling back to each other or to prev→next
      let inNx = 0, inNy = 0, outNx = 0, outNy = 0;
      if (inLen > 0.001) { inNx = inTx / inLen; inNy = inTy / inLen; }
      if (outLen > 0.001) { outNx = outTx / outLen; outNy = outTy / outLen; }

      if (inLen < 0.001 && outLen < 0.001) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        normals.set(curr.idx, { nx: -dy / len, ny: dx / len });
        continue;
      }
      if (inLen < 0.001) { inNx = outNx; inNy = outNy; }
      if (outLen < 0.001) { outNx = inNx; outNy = inNy; }

      // Average incoming and outgoing tangent directions for a smooth normal
      let tanX = (inNx + outNx) / 2;
      let tanY = (inNy + outNy) / 2;
      const tanLen = Math.sqrt(tanX * tanX + tanY * tanY);
      if (tanLen < 0.001) {
        // Tangents point in opposite directions (cusp) — use incoming tangent only
        tanX = inNx;
        tanY = inNy;
      } else {
        tanX /= tanLen;
        tanY /= tanLen;
      }

      normals.set(curr.idx, { nx: -tanY, ny: tanX });
    }
  }
  return normals;
}

function computeControlPointNormals(
  commands: PathCommand[],
  anchorNormals: Map<number, { nx: number; ny: number }>,
): Map<number, { field: 'cp1' | 'cp2'; nx: number; ny: number }[]> {
  const cpNormals = new Map<number, { field: 'cp1' | 'cp2'; nx: number; ny: number }[]>();
  const ranges = getContourRanges(commands);

  for (const { start, end } of ranges) {
    for (let i = start; i <= end; i++) {
      const cmd = commands[i];
      if (!cmd || cmd.type === 'M' || cmd.type === 'Z' || cmd.type === 'L') continue;

      const entries: { field: 'cp1' | 'cp2'; nx: number; ny: number }[] = [];

      // Find the previous anchor point
      let prevAnchorX = 0, prevAnchorY = 0;
      for (let k = i - 1; k >= start; k--) {
        const prev = commands[k];
        if (prev.x !== undefined && prev.y !== undefined && prev.type !== 'Z') {
          prevAnchorX = prev.x;
          prevAnchorY = prev.y;
          break;
        }
      }

      if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined) {
        // Quadratic cp1: tangent at t=0 is (P0→P1), tangent at t=1 is (P1→P2).
        // Normal perpendicular to the segment chord (P0→P2) is a good approximation.
        const dx = (cmd.x ?? 0) - prevAnchorX;
        const dy = (cmd.y ?? 0) - prevAnchorY;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        entries.push({ field: 'cp1', nx: -dy / len, ny: dx / len });
      }

      if (cmd.type === 'C') {
        if (cmd.x1 !== undefined && cmd.y1 !== undefined) {
          // cp1 defines the departing tangent from the previous anchor.
          // Normal is perpendicular to (prevAnchor → cp1).
          let dx = cmd.x1 - prevAnchorX;
          let dy = cmd.y1 - prevAnchorY;
          let len = Math.sqrt(dx * dx + dy * dy);
          if (len < 0.001) {
            // Degenerate: cp1 sits on the previous anchor, fall back to anchor normal
            const fallback = anchorNormals.get(i) || { nx: 0, ny: 0 };
            entries.push({ field: 'cp1', ...fallback });
          } else {
            dx /= len; dy /= len;
            entries.push({ field: 'cp1', nx: -dy, ny: dx });
          }
        }
        if (cmd.x2 !== undefined && cmd.y2 !== undefined) {
          // cp2 defines the arriving tangent at the current anchor.
          // Normal is perpendicular to (cp2 → anchor).
          let dx = (cmd.x ?? 0) - cmd.x2;
          let dy = (cmd.y ?? 0) - cmd.y2;
          let len = Math.sqrt(dx * dx + dy * dy);
          if (len < 0.001) {
            // Degenerate: cp2 sits on the anchor, fall back to anchor normal
            const fallback = anchorNormals.get(i) || { nx: 0, ny: 0 };
            entries.push({ field: 'cp2', ...fallback });
          } else {
            dx /= len; dy /= len;
            entries.push({ field: 'cp2', nx: -dy, ny: dx });
          }
        }
      }

      if (entries.length > 0) cpNormals.set(i, entries);
    }
  }
  return cpNormals;
}

/**
 * Classifies each command index as 'anchor' or 'control' and builds a lookup
 * from each anchor to its prev/next anchors for contour-aware traversal.
 */
function buildAnchorGraph(commands: PathCommand[]): {
  anchorIndices: Set<number>;
  contourOfCmd: Map<number, number>;
  prevAnchor: Map<number, number>;
  nextAnchor: Map<number, number>;
} {
  const anchorIndices = new Set<number>();
  const contourOfCmd = new Map<number, number>();
  const prevAnchor = new Map<number, number>();
  const nextAnchor = new Map<number, number>();
  const ranges = getContourRanges(commands);

  for (let ci = 0; ci < ranges.length; ci++) {
    const { start, end } = ranges[ci];
    const anchors: number[] = [];
    for (let i = start; i <= end; i++) {
      contourOfCmd.set(i, ci);
      const cmd = commands[i];
      if (cmd.type === 'M' || cmd.type === 'L' || cmd.type === 'Z') {
        if (cmd.x !== undefined && cmd.y !== undefined) {
          anchorIndices.add(i);
          anchors.push(i);
        }
      } else if (cmd.type === 'Q' || cmd.type === 'C') {
        if (cmd.x !== undefined && cmd.y !== undefined) {
          anchorIndices.add(i);
          anchors.push(i);
        }
      }
    }
    const isClosed = commands[end]?.type === 'Z';
    for (let j = 0; j < anchors.length; j++) {
      prevAnchor.set(anchors[j], anchors[j > 0 ? j - 1 : (isClosed ? anchors.length - 1 : j)]);
      nextAnchor.set(anchors[j], anchors[j < anchors.length - 1 ? j + 1 : (isClosed ? 0 : j)]);
    }
  }
  return { anchorIndices, contourOfCmd, prevAnchor, nextAnchor };
}

function _lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function _splitCubic(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number, t: number,
) {
  const q0x = _lerp(p0x, p1x, t), q0y = _lerp(p0y, p1y, t);
  const q1x = _lerp(p1x, p2x, t), q1y = _lerp(p1y, p2y, t);
  const q2x = _lerp(p2x, p3x, t), q2y = _lerp(p2y, p3y, t);
  const r0x = _lerp(q0x, q1x, t), r0y = _lerp(q0y, q1y, t);
  const r1x = _lerp(q1x, q2x, t), r1y = _lerp(q1y, q2y, t);
  const sx = _lerp(r0x, r1x, t), sy = _lerp(r0y, r1y, t);
  return {
    first:  { x1: q0x, y1: q0y, x2: r0x, y2: r0y, x: sx, y: sy },
    second: { x1: r1x, y1: r1y, x2: q2x, y2: q2y, x: p3x, y: p3y },
  };
}

function _splitQuad(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, t: number,
) {
  const q0x = _lerp(p0x, p1x, t), q0y = _lerp(p0y, p1y, t);
  const q1x = _lerp(p1x, p2x, t), q1y = _lerp(p1y, p2y, t);
  const sx = _lerp(q0x, q1x, t), sy = _lerp(q0y, q1y, t);
  return {
    first:  { x1: q0x, y1: q0y, x: sx, y: sy },
    second: { x1: q1x, y1: q1y, x: p2x, y: p2y },
  };
}

/**
 * Evaluate a cubic bezier at parameter t.
 * Returns the point and the normalized tangent direction.
 */
function _evalCubic(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number, t: number,
) {
  const u = 1 - t;
  const x = u * u * u * p0x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x;
  const y = u * u * u * p0y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y;
  let tx = 3 * u * u * (p1x - p0x) + 6 * u * t * (p2x - p1x) + 3 * t * t * (p3x - p2x);
  let ty = 3 * u * u * (p1y - p0y) + 6 * u * t * (p2y - p1y) + 3 * t * t * (p3y - p2y);
  const len = Math.sqrt(tx * tx + ty * ty);
  if (len > 1e-9) { tx /= len; ty /= len; } else { tx = 0; ty = 0; }
  return { x, y, tx, ty };
}

/**
 * Evaluate a quadratic bezier at parameter t.
 */
function _evalQuad(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, t: number,
) {
  const u = 1 - t;
  const x = u * u * p0x + 2 * u * t * p1x + t * t * p2x;
  const y = u * u * p0y + 2 * u * t * p1y + t * t * p2y;
  let tx = 2 * u * (p1x - p0x) + 2 * t * (p2x - p1x);
  let ty = 2 * u * (p1y - p0y) + 2 * t * (p2y - p1y);
  const len = Math.sqrt(tx * tx + ty * ty);
  if (len > 1e-9) { tx /= len; ty /= len; } else { tx = 0; ty = 0; }
  return { x, y, tx, ty };
}

/**
 * Approximate the arc-length of a cubic bezier using Gaussian quadrature (5-point).
 */
function _cubicArcLength(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number,
): number {
  const GW = [0.2369269, 0.4786287, 0.5688889, 0.4786287, 0.2369269];
  const GT = [0.0469101, 0.2307653, 0.5, 0.7692347, 0.9530899];
  let len = 0;
  for (let i = 0; i < 5; i++) {
    const t = GT[i];
    const u = 1 - t;
    const dx = 3 * u * u * (p1x - p0x) + 6 * u * t * (p2x - p1x) + 3 * t * t * (p3x - p2x);
    const dy = 3 * u * u * (p1y - p0y) + 6 * u * t * (p2y - p1y) + 3 * t * t * (p3y - p2y);
    len += GW[i] * Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * Approximate the arc-length of a quadratic bezier using Gaussian quadrature (5-point).
 */
function _quadArcLength(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number,
): number {
  const GW = [0.2369269, 0.4786287, 0.5688889, 0.4786287, 0.2369269];
  const GT = [0.0469101, 0.2307653, 0.5, 0.7692347, 0.9530899];
  let len = 0;
  for (let i = 0; i < 5; i++) {
    const t = GT[i];
    const u = 1 - t;
    const dx = 2 * u * (p1x - p0x) + 2 * t * (p2x - p1x);
    const dy = 2 * u * (p1y - p0y) + 2 * t * (p2y - p1y);
    len += GW[i] * Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * Find the parametric t for a given arc-length distance from the start (or end)
 * of a cubic bezier, using bisection.
 */
function _cubicTForDist(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number,
  dist: number, fromEnd: boolean,
): number {
  const totalLen = _cubicArcLength(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y);
  if (dist >= totalLen * 0.99) return fromEnd ? 0.01 : 0.99;
  const target = fromEnd ? totalLen - dist : dist;
  let lo = 0, hi = 1;
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const s = _splitCubic(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, mid);
    const segLen = _cubicArcLength(p0x, p0y, s.first.x1, s.first.y1, s.first.x2, s.first.y2, s.first.x, s.first.y);
    if (segLen < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Find the parametric t for a given arc-length distance from the start (or end)
 * of a quadratic bezier, using bisection.
 */
function _quadTForDist(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number,
  dist: number, fromEnd: boolean,
): number {
  const totalLen = _quadArcLength(p0x, p0y, p1x, p1y, p2x, p2y);
  if (dist >= totalLen * 0.99) return fromEnd ? 0.01 : 0.99;
  const target = fromEnd ? totalLen - dist : dist;
  let lo = 0, hi = 1;
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const s = _splitQuad(p0x, p0y, p1x, p1y, p2x, p2y, mid);
    const segLen = _quadArcLength(p0x, p0y, s.first.x1, s.first.y1, s.first.x, s.first.y);
    if (segLen < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

interface TrimPt { x: number; y: number; tx: number; ty: number; t: number }

/**
 * Apply corner radius to sharp corners in all contours.
 * Computes trim points on actual curves (not linear offsets) to avoid
 * discontinuities between arcs and trimmed curve segments.
 */
function applyCornerRadius(commands: PathCommand[], radius: number): PathCommand[] {
  if (radius <= 0) return commands;

  const ranges = getContourRanges(commands);
  const result: PathCommand[] = [];

  for (const { start, end } of ranges) {
    const contour = commands.slice(start, end + 1);
    const hasZ = contour.length > 0 && contour[contour.length - 1]?.type === 'Z';

    // Collect on-curve vertices
    const pts: { x: number; y: number; ci: number }[] = [];
    for (let i = 0; i < contour.length; i++) {
      const c = contour[i];
      if (c.type !== 'Z' && c.x !== undefined && c.y !== undefined) {
        pts.push({ x: c.x, y: c.y, ci: i });
      }
    }

    const N = pts.length;
    if (!hasZ || N < 3) { result.push(...contour); continue; }

    // Segment type and arc-length for segment from vertex i to vertex (i+1)%N
    const segType = (i: number): 'L' | 'C' | 'Q' => {
      const ni = (i + 1) % N;
      if (ni === 0) return 'L'; // closing Z is always straight
      const c = contour[pts[ni].ci];
      if (c.type === 'C') return 'C';
      if (c.type === 'Q') return 'Q';
      return 'L';
    };

    const segLen = (i: number): number => {
      const v = pts[i], nv = pts[(i + 1) % N], ni = (i + 1) % N;
      if (ni === 0) return Math.sqrt((nv.x - v.x) ** 2 + (nv.y - v.y) ** 2);
      const c = contour[nv.ci];
      if (c.type === 'C') return _cubicArcLength(v.x, v.y, c.x1!, c.y1!, c.x2!, c.y2!, nv.x, nv.y);
      if (c.type === 'Q') return _quadArcLength(v.x, v.y, c.x1!, c.y1!, nv.x, nv.y);
      return Math.sqrt((nv.x - v.x) ** 2 + (nv.y - v.y) ** 2);
    };

    // Tangent at vertex i from the incoming segment (direction of travel)
    const tangentIn = (i: number): { nx: number; ny: number } => {
      const v = pts[i], pv = pts[(i - 1 + N) % N];
      const pi = (i - 1 + N) % N;
      const st = segType(pi);
      if (st === 'C' && i > 0) {
        const c = contour[v.ci];
        if (c.type === 'C' && c.x2 !== undefined) {
          const dx = v.x - c.x2, dy = v.y - c.y2!;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) return { nx: dx / len, ny: dy / len };
        }
      } else if (st === 'Q' && i > 0) {
        const c = contour[v.ci];
        if (c.type === 'Q' && c.x1 !== undefined) {
          const dx = v.x - c.x1, dy = v.y - c.y1!;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) return { nx: dx / len, ny: dy / len };
        }
      }
      const dx = v.x - pv.x, dy = v.y - pv.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      return { nx: len > 0.001 ? dx / len : 0, ny: len > 0.001 ? dy / len : 0 };
    };

    // Tangent at vertex i towards the outgoing segment (direction of travel)
    const tangentOut = (i: number): { nx: number; ny: number } => {
      const v = pts[i], nv = pts[(i + 1) % N], ni = (i + 1) % N;
      if (ni !== 0) {
        const c = contour[nv.ci];
        if (c.type === 'C' && c.x1 !== undefined) {
          const dx = c.x1 - v.x, dy = c.y1! - v.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) return { nx: dx / len, ny: dy / len };
        } else if (c.type === 'Q' && c.x1 !== undefined) {
          const dx = c.x1 - v.x, dy = c.y1! - v.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) return { nx: dx / len, ny: dy / len };
        }
      }
      const dx = nv.x - v.x, dy = nv.y - v.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      return { nx: len > 0.001 ? dx / len : 0, ny: len > 0.001 ? dy / len : 0 };
    };

    // Detect corners and compute initial trim distances
    interface CornerInfo {
      isCorner: boolean; trim: number; angle: number;
    }
    const corners: CornerInfo[] = [];
    for (let i = 0; i < N; i++) {
      const iD = tangentIn(i), oD = tangentOut(i);
      if ((iD.nx === 0 && iD.ny === 0) || (oD.nx === 0 && oD.ny === 0)) {
        corners.push({ isCorner: false, trim: 0, angle: 0 }); continue;
      }
      const dot = iD.nx * oD.nx + iD.ny * oD.ny;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      const isCorner = angle > 0.1;
      let trim = 0;
      if (isCorner) {
        const ha = (Math.PI - angle) / 2;
        const th = Math.tan(ha);
        trim = th > 0.001 ? radius / th : radius * 100;
        const pi = (i - 1 + N) % N;
        trim = Math.min(trim, segLen(pi) * 0.49, segLen(i) * 0.49);
      }
      corners.push({ isCorner, trim, angle });
    }

    // Clamp shared segments so adjacent corners don't over-trim
    for (let i = 0; i < N; i++) {
      const ni = (i + 1) % N;
      if (corners[i].isCorner && corners[ni].isCorner) {
        const total = corners[i].trim + corners[ni].trim;
        const sl = segLen(i);
        if (total > sl * 0.98 && total > 0) {
          const s = (sl * 0.98) / total;
          corners[i].trim *= s;
          corners[ni].trim *= s;
        }
      }
    }

    // Compute actual trim points on curves for each corner
    // inTrim[i] = point + tangent on the incoming segment, at distance trim from vertex i
    // outTrim[i] = point + tangent on the outgoing segment, at distance trim from vertex i
    const inTrim: (TrimPt | null)[] = new Array(N).fill(null);
    const outTrim: (TrimPt | null)[] = new Array(N).fill(null);

    for (let i = 0; i < N; i++) {
      if (!corners[i].isCorner || corners[i].trim < 0.5) continue;
      const trim = corners[i].trim;
      const v = pts[i];

      // Incoming trim: on the segment from pts[prev] to pts[i], distance trim from end
      const pi = (i - 1 + N) % N;
      const prevV = pts[pi];
      const inST = segType(pi);
      if (inST === 'C' && i > 0) {
        const c = contour[v.ci];
        const t = _cubicTForDist(prevV.x, prevV.y, c.x1!, c.y1!, c.x2!, c.y2!, v.x, v.y, trim, true);
        const ev = _evalCubic(prevV.x, prevV.y, c.x1!, c.y1!, c.x2!, c.y2!, v.x, v.y, t);
        inTrim[i] = { x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t };
      } else if (inST === 'Q' && i > 0) {
        const c = contour[v.ci];
        const t = _quadTForDist(prevV.x, prevV.y, c.x1!, c.y1!, v.x, v.y, trim, true);
        const ev = _evalQuad(prevV.x, prevV.y, c.x1!, c.y1!, v.x, v.y, t);
        inTrim[i] = { x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t };
      } else {
        // Straight line: linear offset
        const dx = v.x - prevV.x, dy = v.y - prevV.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = len > 0.001 ? dx / len : 0, ny = len > 0.001 ? dy / len : 0;
        inTrim[i] = { x: v.x - nx * trim, y: v.y - ny * trim, tx: nx, ty: ny, t: len > 0.001 ? 1 - trim / len : 1 };
      }

      // Outgoing trim: on the segment from pts[i] to pts[next], distance trim from start
      const ni = (i + 1) % N;
      const nextV = pts[ni];
      const outST = segType(i);
      if (outST === 'C' && ni !== 0) {
        const c = contour[nextV.ci];
        const t = _cubicTForDist(v.x, v.y, c.x1!, c.y1!, c.x2!, c.y2!, nextV.x, nextV.y, trim, false);
        const ev = _evalCubic(v.x, v.y, c.x1!, c.y1!, c.x2!, c.y2!, nextV.x, nextV.y, t);
        outTrim[i] = { x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t };
      } else if (outST === 'Q' && ni !== 0) {
        const c = contour[nextV.ci];
        const t = _quadTForDist(v.x, v.y, c.x1!, c.y1!, nextV.x, nextV.y, trim, false);
        const ev = _evalQuad(v.x, v.y, c.x1!, c.y1!, nextV.x, nextV.y, t);
        outTrim[i] = { x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t };
      } else {
        // Straight line: linear offset
        const dx = nextV.x - v.x, dy = nextV.y - v.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = len > 0.001 ? dx / len : 0, ny = len > 0.001 ? dy / len : 0;
        outTrim[i] = { x: v.x + nx * trim, y: v.y + ny * trim, tx: nx, ty: ny, t: len > 0.001 ? trim / len : 0 };
      }
    }

    // Emit a rounded arc from inTrim to outTrim at corner vertex i
    const emitArc = (out: PathCommand[], i: number) => {
      const inP = inTrim[i]!, outP = outTrim[i]!;
      const angle = corners[i].angle;
      const halfOpen = (Math.PI - angle) / 2;
      const actualR = corners[i].trim * Math.tan(halfOpen);
      const h = (4 / 3) * Math.tan(Math.max(0.001, angle) / 4) * actualR;

      out.push({
        type: 'C',
        x1: Math.round(inP.x + inP.tx * h), y1: Math.round(inP.y + inP.ty * h),
        x2: Math.round(outP.x - outP.tx * h), y2: Math.round(outP.y - outP.ty * h),
        x: Math.round(outP.x), y: Math.round(outP.y),
      });
    };

    // Emit a segment from vertex fi to vertex ti, clipped by corner trim points
    const emitSeg = (out: PathCommand[], fi: number, ti: number) => {
      const fv = pts[fi], tv = pts[ti];
      const hasStartTrim = corners[fi].isCorner && outTrim[fi] !== null;
      const hasEndTrim = corners[ti].isCorner && inTrim[ti] !== null;

      const st = segType(fi);

      if (st === 'L' || ti === 0) {
        const ex = hasEndTrim ? inTrim[ti]!.x : tv.x;
        const ey = hasEndTrim ? inTrim[ti]!.y : tv.y;
        out.push({ type: 'L', x: Math.round(ex), y: Math.round(ey) });
        return;
      }

      const cmd = contour[tv.ci];
      if (cmd.type === 'C') {
        let p0x = fv.x, p0y = fv.y;
        let x1 = cmd.x1!, y1 = cmd.y1!, x2 = cmd.x2!, y2 = cmd.y2!;
        let px = tv.x, py = tv.y;

        const t1 = hasStartTrim ? outTrim[fi]!.t : 0;
        const t2 = hasEndTrim ? inTrim[ti]!.t : 1;

        if (t2 >= 1 - 1e-6 && t1 <= 1e-6) {
          out.push({ type: 'C', x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), x: Math.round(px), y: Math.round(py) });
          return;
        }

        // Clip end first, then start
        if (t2 < 1 - 1e-6) {
          const s = _splitCubic(p0x, p0y, x1, y1, x2, y2, px, py, t2);
          x1 = s.first.x1; y1 = s.first.y1; x2 = s.first.x2; y2 = s.first.y2;
          px = s.first.x; py = s.first.y;
        }
        if (t1 > 1e-6) {
          const adjT = t2 < 1 - 1e-6 ? t1 / t2 : t1;
          const s = _splitCubic(p0x, p0y, x1, y1, x2, y2, px, py, adjT);
          x1 = s.second.x1; y1 = s.second.y1; x2 = s.second.x2; y2 = s.second.y2;
          // p0 is now the split point — but it's the implicit pen position, so we don't change px/py
        }
        out.push({ type: 'C', x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), x: Math.round(px), y: Math.round(py) });
      } else if (cmd.type === 'Q') {
        let p0x = fv.x, p0y = fv.y;
        let qx1 = cmd.x1!, qy1 = cmd.y1!;
        let px = tv.x, py = tv.y;

        const t1 = hasStartTrim ? outTrim[fi]!.t : 0;
        const t2 = hasEndTrim ? inTrim[ti]!.t : 1;

        if (t2 >= 1 - 1e-6 && t1 <= 1e-6) {
          out.push({ type: 'Q', x1: Math.round(qx1), y1: Math.round(qy1), x: Math.round(px), y: Math.round(py) });
          return;
        }

        if (t2 < 1 - 1e-6) {
          const s = _splitQuad(p0x, p0y, qx1, qy1, px, py, t2);
          qx1 = s.first.x1; qy1 = s.first.y1; px = s.first.x; py = s.first.y;
        }
        if (t1 > 1e-6) {
          const adjT = t2 < 1 - 1e-6 ? t1 / t2 : t1;
          const s = _splitQuad(p0x, p0y, qx1, qy1, px, py, adjT);
          qx1 = s.second.x1; qy1 = s.second.y1;
        }
        out.push({ type: 'Q', x1: Math.round(qx1), y1: Math.round(qy1), x: Math.round(px), y: Math.round(py) });
      }
    };

    // Build output path
    const r: PathCommand[] = [];

    // Starting M point
    if (corners[0].isCorner && inTrim[0]) {
      r.push({ type: 'M', x: Math.round(inTrim[0].x), y: Math.round(inTrim[0].y) });
      emitArc(r, 0);
    } else {
      r.push({ type: 'M', x: pts[0].x, y: pts[0].y });
    }

    // Emit each segment then its destination arc
    for (let s = 0; s < N; s++) {
      const ni = (s + 1) % N;
      emitSeg(r, s, ni);
      if (ni !== 0 && corners[ni].isCorner && corners[ni].trim > 0.5) {
        emitArc(r, ni);
      }
    }

    r.push({ type: 'Z' });
    result.push(...r);
  }

  return result;
}

export function applyDesignTools(
  commands: PathCommand[],
  tools: DesignToolValues,
  font: { unitsPerEm: number; ascender: number; descender: number },
): { commands: PathCommand[]; advanceWidthDelta: number } {
  if (commands.length === 0) {
    return { commands, advanceWidthDelta: 0 };
  }

  // Apply corner radius as a preprocessing step
  const cmds = tools.cornerRadius > 0 ? applyCornerRadius(commands, tools.cornerRadius) : commands;

  const bounds = getGlyphBounds(cmds);
  const { cx, cy, minX, maxX, minY, maxY } = bounds;
  const upm = font.unitsPerEm;
  const glyphW = maxX - minX || 1;
  const glyphH = maxY - minY || 1;
  const xHeightApprox = font.ascender * 0.72;

  // Pre-compute normals for weight and contrast
  let outlineNormals: Map<number, { nx: number; ny: number }> | null = null;
  let cpNormals: Map<number, { field: 'cp1' | 'cp2'; nx: number; ny: number }[]> | null = null;
  if (tools.weight !== 0 || tools.contrast !== 0 || tools.inkTrap !== 0 || tools.serif !== 0) {
    outlineNormals = computeOutlineNormals(cmds);
    cpNormals = computeControlPointNormals(cmds, outlineNormals);
  }

  // Classify points for roundness
  const { anchorIndices } = buildAnchorGraph(cmds);

  // Precompute ink trap sharpness per point (dot product of neighbor normals)
  let inkTrapSharpness: Map<number, number> | null = null;
  if (tools.inkTrap !== 0 && outlineNormals) {
    inkTrapSharpness = new Map();
    const ranges = getContourRanges(cmds);
    for (const { start, end } of ranges) {
      const pts: number[] = [];
      for (let i = start; i <= end; i++) {
        if (outlineNormals.has(i)) pts.push(i);
      }
      for (let j = 0; j < pts.length; j++) {
        const prevIdx = pts[(j - 1 + pts.length) % pts.length];
        const nextIdx = pts[(j + 1) % pts.length];
        const pn = outlineNormals.get(prevIdx);
        const nn = outlineNormals.get(nextIdx);
        if (pn && nn) {
          const dot = pn.nx * nn.nx + pn.ny * nn.ny;
          inkTrapSharpness.set(pts[j], dot);
        }
      }
    }
  }

  let advDelta = 0;
  const result = cmds.map((cmd, cmdIdx) => {
    const c: PathCommand = { ...cmd };

    // Helper: get the normal-based offset for weight/contrast
    const getNormalOffset = (
      cmdI: number,
      field: 'anchor' | 'cp1' | 'cp2',
    ): { nx: number; ny: number } | null => {
      if (!outlineNormals) return null;
      if (field === 'anchor') {
        return outlineNormals.get(cmdI) ?? null;
      }
      const entries = cpNormals?.get(cmdI);
      if (!entries) return null;
      const match = entries.find(e => e.field === field);
      return match ? { nx: match.nx, ny: match.ny } : null;
    };

    const applyShared = (px: number, py: number): { x: number; y: number } => {
      let x = px;
      let y = py;

      // Width: horizontal scale from glyph center
      if (tools.width !== 0) {
        const wScale = 1 + tools.width / 100;
        x = cx + (x - cx) * wScale;
      }

      // Slant (italic): shear horizontally proportional to y position
      // Anchored at baseline (y=0), so baseline stays put and ascenders lean right
      if (tools.slant !== 0) {
        const tanSlant = Math.tan((tools.slant * Math.PI) / 180);
        x = x + y * tanSlant;
      }

      // x-Height: scale the zone between baseline and x-height,
      // with smooth interpolation near the boundary
      if (tools.xHeight !== 0) {
        const factor = tools.xHeight / 100;
        const scale = 1 + factor * 0.2;
        if (y >= 0 && y <= xHeightApprox) {
          y = y * scale;
        } else if (y > xHeightApprox && y < xHeightApprox * 1.3) {
          // Smooth blend zone above x-height
          const t = (y - xHeightApprox) / (xHeightApprox * 0.3);
          const blend = 1 - t * t;
          const newXH = xHeightApprox * scale;
          y = newXH + (y - xHeightApprox) * (1 - blend * (scale - 1) * 0.5);
        }
      }

      // Ascender extension: stretch points above x-height
      // Pinned at x-height so the body doesn't shift
      if (tools.ascenderExtend !== 0 && y > xHeightApprox) {
        const factor = tools.ascenderExtend / 100;
        const above = y - xHeightApprox;
        y = xHeightApprox + above * (1 + factor * 0.3);
      }

      // Descender extension: stretch points below baseline
      // Pinned at baseline
      if (tools.descenderExtend !== 0 && y < 0) {
        const factor = tools.descenderExtend / 100;
        y = y * (1 + factor * 0.3);
      }

      // Overshoot: push extrema points slightly beyond alignment zones
      // Round shapes in type design overshoot the baseline/x-height to look optically aligned
      if (tools.overshoot !== 0) {
        const ov = (tools.overshoot / 100) * upm * 0.02;
        // Near baseline (y near 0): push downward
        if (Math.abs(y) < upm * 0.03) {
          y -= ov;
        }
        // Near x-height
        if (Math.abs(y - xHeightApprox) < upm * 0.03) {
          y += ov;
        }
        // Near ascender
        if (Math.abs(y - font.ascender) < upm * 0.03) {
          y += ov;
        }
        // Near descender
        if (Math.abs(y - font.descender) < upm * 0.03) {
          y -= ov;
        }
      }

      // Optical size: thin strokes become relatively thicker at small sizes.
      // Weight offsets proportional to how thin (close to center) the point is.
      if (tools.opticalSize !== 0) {
        const factor = tools.opticalSize / 100;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Points closer to the center (inner contour/counter) get pushed outward
        // more than points far from center — mimics opening up counters
        const halfDiag = Math.sqrt(glyphW * glyphW + glyphH * glyphH) / 2 || 1;
        const proximity = 1 - Math.min(dist / halfDiag, 1);
        const offset = factor * upm * 0.015 * proximity;
        x += (dx / dist) * offset;
        y += (dy / dist) * offset;
      }

      return { x, y };
    };

    // Process main anchor point
    if (c.x !== undefined && c.y !== undefined) {
      const p = applyShared(c.x, c.y);
      c.x = Math.round(p.x);
      c.y = Math.round(p.y);
    }
    // Process control point 1
    if (c.x1 !== undefined && c.y1 !== undefined) {
      const p = applyShared(c.x1, c.y1);
      c.x1 = Math.round(p.x);
      c.y1 = Math.round(p.y);
    }
    // Process control point 2
    if (c.x2 !== undefined && c.y2 !== undefined) {
      const p = applyShared(c.x2, c.y2);
      c.x2 = Math.round(p.x);
      c.y2 = Math.round(p.y);
    }

    // --- Normal-based adjustments (applied after shared transforms) ---

    // Weight: offset every point along its outline normal
    if (tools.weight !== 0 && outlineNormals) {
      const offset = (tools.weight / 100) * upm * 0.05;

      const an = getNormalOffset(cmdIdx, 'anchor');
      if (an && c.x !== undefined && c.y !== undefined) {
        c.x = Math.round(c.x + an.nx * offset);
        c.y = Math.round(c.y + an.ny * offset);
      }
      const cp1 = getNormalOffset(cmdIdx, 'cp1');
      if (cp1 && c.x1 !== undefined && c.y1 !== undefined) {
        c.x1 = Math.round(c.x1 + cp1.nx * offset);
        c.y1 = Math.round(c.y1 + cp1.ny * offset);
      }
      const cp2 = getNormalOffset(cmdIdx, 'cp2');
      if (cp2 && c.x2 !== undefined && c.y2 !== undefined) {
        c.x2 = Math.round(c.x2 + cp2.nx * offset);
        c.y2 = Math.round(c.y2 + cp2.ny * offset);
      }
    }

    // Contrast: offset differently for horizontal vs vertical strokes
    // Vertical strokes (normal mostly horizontal) get thicker,
    // horizontal strokes (normal mostly vertical) get thinner — or vice versa.
    if (tools.contrast !== 0 && outlineNormals) {
      const factor = (tools.contrast / 100) * upm * 0.03;

      const an = getNormalOffset(cmdIdx, 'anchor');
      if (an && c.x !== undefined && c.y !== undefined) {
        // |nx| ≈ 1 means vertical stroke, |ny| ≈ 1 means horizontal stroke
        // Positive contrast: thicken vertical, thin horizontal
        const verticalness = an.nx * an.nx;
        const horizontalness = an.ny * an.ny;
        const contrastOffset = factor * (verticalness - horizontalness);
        c.x = Math.round(c.x + an.nx * contrastOffset);
        c.y = Math.round(c.y + an.ny * contrastOffset);
      }
      const cp1 = getNormalOffset(cmdIdx, 'cp1');
      if (cp1 && c.x1 !== undefined && c.y1 !== undefined) {
        const verticalness = cp1.nx * cp1.nx;
        const horizontalness = cp1.ny * cp1.ny;
        const contrastOffset = factor * (verticalness - horizontalness);
        c.x1 = Math.round(c.x1 + cp1.nx * contrastOffset);
        c.y1 = Math.round(c.y1 + cp1.ny * contrastOffset);
      }
      const cp2 = getNormalOffset(cmdIdx, 'cp2');
      if (cp2 && c.x2 !== undefined && c.y2 !== undefined) {
        const verticalness = cp2.nx * cp2.nx;
        const horizontalness = cp2.ny * cp2.ny;
        const contrastOffset = factor * (verticalness - horizontalness);
        c.x2 = Math.round(c.x2 + cp2.nx * contrastOffset);
        c.y2 = Math.round(c.y2 + cp2.ny * contrastOffset);
      }
    }

    // Ink Trap: at acute interior joints, pull points inward along normal
    if (tools.inkTrap !== 0 && outlineNormals && inkTrapSharpness) {
      const an = outlineNormals.get(cmdIdx);
      const dot = inkTrapSharpness.get(cmdIdx);
      if (an && dot !== undefined && dot < 0.3 && c.x !== undefined && c.y !== undefined) {
        const trapDepth = (tools.inkTrap / 100) * upm * 0.02 * (1 - dot);
        c.x = Math.round(c.x - an.nx * trapDepth);
        c.y = Math.round(c.y - an.ny * trapDepth);
      }
    }

    // Serif: at extrema/terminal points, add small lateral extensions
    // by shifting the point and its neighbors along the tangent direction
    if (tools.serif !== 0 && outlineNormals) {
      const an = outlineNormals.get(cmdIdx);
      if (an && c.x !== undefined && c.y !== undefined) {
        // Tangent direction is perpendicular to normal
        const tx = an.ny;
        const ty = -an.nx;
        // Detect terminal points: near baseline, x-height, ascender, or descender
        const isTerminal =
          Math.abs(c.y) < upm * 0.04 ||
          Math.abs(c.y - xHeightApprox) < upm * 0.04 ||
          Math.abs(c.y - font.ascender) < upm * 0.04 ||
          Math.abs(c.y - font.descender) < upm * 0.04;
        // Only apply to points on mostly-vertical strokes (normal mostly horizontal)
        const isVerticalStroke = Math.abs(an.nx) > 0.7;
        if (isTerminal && isVerticalStroke) {
          const serifSize = (tools.serif / 100) * upm * 0.04;
          c.x = Math.round(c.x + tx * serifSize * Math.sign(an.nx));
          c.y = Math.round(c.y + ty * serifSize * Math.sign(an.nx));
        }
      }
    }

    // Roundness: scale control point handles relative to their owning anchor
    // Positive = more curvature (handles extend), negative = flatter (handles contract)
    if (tools.roundness !== 0 && (cmd.type === 'C' || cmd.type === 'Q')) {
      const factor = tools.roundness / 100;

      // Find the previous endpoint (start anchor of this segment)
      let prevX = c.x ?? 0, prevY = c.y ?? 0;
      for (let k = cmdIdx - 1; k >= 0; k--) {
        const prev = cmds[k];
        if (prev.x !== undefined && prev.y !== undefined) {
          prevX = prev.x;
          prevY = prev.y;
          break;
        }
      }

      if (cmd.type === 'C' && c.x1 !== undefined && c.y1 !== undefined) {
        // cp1 belongs to start anchor → scale relative to prevX/prevY
        const hx = c.x1 - prevX;
        const hy = c.y1 - prevY;
        c.x1 = Math.round(prevX + hx * (1 + factor));
        c.y1 = Math.round(prevY + hy * (1 + factor));
      }
      if (cmd.type === 'C' && c.x2 !== undefined && c.y2 !== undefined && c.x !== undefined && c.y !== undefined) {
        // cp2 belongs to end anchor → scale relative to endpoint
        const hx = c.x2 - c.x;
        const hy = c.y2 - c.y;
        c.x2 = Math.round(c.x + hx * (1 + factor));
        c.y2 = Math.round(c.y + hy * (1 + factor));
      }
      if (cmd.type === 'Q' && c.x1 !== undefined && c.y1 !== undefined && c.x !== undefined && c.y !== undefined) {
        // Quadratic: single CP — scale relative to the midpoint of the two anchors
        const midX = (prevX + c.x) / 2;
        const midY = (prevY + c.y) / 2;
        const hx = c.x1 - midX;
        const hy = c.y1 - midY;
        c.x1 = Math.round(midX + hx * (1 + factor));
        c.y1 = Math.round(midY + hy * (1 + factor));
      }
    }

    return c;
  });

  // Smooth: applied as a post-pass at every anchor point in every contour.
  // Uses contour command indices directly to ensure all junctions are processed.
  // - Curve-curve: equalizes handle lengths and blends toward collinearity.
  // - Curve-line / line-curve: blends the curve handle toward the line direction.
  if (tools.smooth > 0) {
    const blendBase = Math.min(1, (tools.smooth / 1000) * 0.9);
    const iterations = 2; // Run twice for more consistent effect across anchors
    const ranges = getContourRanges(result);

    for (let iter = 0; iter < iterations; iter++) {
      for (const { start, end } of ranges) {
        const contour = result.slice(start, end + 1);
        const n = contour.length;
        const hasZ = contour[n - 1]?.type === 'Z';
        const lastAnchorIdx = n - (hasZ ? 2 : 1); // last command with endpoint before Z
        if (lastAnchorIdx < 0) continue;

        for (let a = 0; a <= lastAnchorIdx; a++) {
          const currCmd = contour[a];
          if (currCmd.type === 'Z') continue;
          const ax = currCmd.x ?? 0;
          const ay = currCmd.y ?? 0;

          // Segment that ENDS at this anchor (incoming)
          const inSegIdx = (a === 0 && hasZ) ? lastAnchorIdx : a;
          const inSeg = contour[inSegIdx];
          // Segment that STARTS at this anchor (outgoing) — skip M
          const outSegIdx = (a === lastAnchorIdx && hasZ) ? 1 : a + 1;
          const outSeg = contour[outSegIdx];
          if (!outSeg || outSeg.type === 'Z') continue;

          // Prev/next anchor positions for line-direction (start of inSeg, end of outSeg)
          const prevIdx = inSegIdx > 0 ? inSegIdx - 1 : (hasZ ? lastAnchorIdx - 1 : 0);
          const prevX = (prevIdx >= 0 ? contour[prevIdx] : contour[0])?.x ?? ax;
          const prevY = (prevIdx >= 0 ? contour[prevIdx] : contour[0])?.y ?? ay;
          const nextX = outSeg.x ?? ax;
          const nextY = outSeg.y ?? ay;

          let inHx = 0, inHy = 0, inLen = 0;
          let hasInHandle = false;
          if (inSeg.type === 'C' && inSeg.x2 !== undefined && inSeg.y2 !== undefined) {
            inHx = inSeg.x2 - ax;
            inHy = inSeg.y2 - ay;
            inLen = Math.sqrt(inHx * inHx + inHy * inHy);
            hasInHandle = inLen > 0.5;
          } else if (inSeg.type === 'Q' && inSeg.x1 !== undefined && inSeg.y1 !== undefined) {
            inHx = inSeg.x1 - ax;
            inHy = inSeg.y1 - ay;
            inLen = Math.sqrt(inHx * inHx + inHy * inHy);
            hasInHandle = inLen > 0.5;
          }

          let outHx = 0, outHy = 0, outLen = 0;
          let hasOutHandle = false;
          if (outSeg.type === 'C' && outSeg.x1 !== undefined && outSeg.y1 !== undefined) {
            outHx = outSeg.x1 - ax;
            outHy = outSeg.y1 - ay;
            outLen = Math.sqrt(outHx * outHx + outHy * outHy);
            hasOutHandle = outLen > 0.5;
          } else if (outSeg.type === 'Q' && outSeg.x1 !== undefined && outSeg.y1 !== undefined) {
            outHx = outSeg.x1 - ax;
            outHy = outSeg.y1 - ay;
            outLen = Math.sqrt(outHx * outHx + outHy * outHy);
            hasOutHandle = outLen > 0.5;
          }

          const lineInDx = ax - prevX;
          const lineInDy = ay - prevY;
          const lineInLen = Math.sqrt(lineInDx * lineInDx + lineInDy * lineInDy);
          const lineOutDx = nextX - ax;
          const lineOutDy = nextY - ay;
          const lineOutLen = Math.sqrt(lineOutDx * lineOutDx + lineOutDy * lineOutDy);
          const prevIsLine = inSeg.type === 'L' || inSeg.type === 'M';
          const nextIsLine = outSeg.type === 'L';

          if (hasInHandle && hasOutHandle) {
            const avgLen = (inLen + outLen) / 2;
            const d1x = outHx / outLen;
            const d1y = outHy / outLen;
            const d2x = inHx / inLen;
            const d2y = inHy / inLen;
            const smoothDirX = d1x - d2x;
            const smoothDirY = d1y - d2y;
            const smoothLen = Math.sqrt(smoothDirX * smoothDirX + smoothDirY * smoothDirY);
            if (smoothLen > 0.001) {
              const tx = smoothDirX / smoothLen;
              const ty = smoothDirY / smoothLen;
              const outTargetX = ax + tx * avgLen;
              const outTargetY = ay + ty * avgLen;
              const inTargetX = ax - tx * avgLen;
              const inTargetY = ay - ty * avgLen;
              if (inSeg.type === 'C' && inSeg.x2 !== undefined && inSeg.y2 !== undefined) {
                inSeg.x2 = Math.round(inSeg.x2 + (inTargetX - inSeg.x2) * blendBase);
                inSeg.y2 = Math.round(inSeg.y2 + (inTargetY - inSeg.y2) * blendBase);
              } else if (inSeg.type === 'Q' && inSeg.x1 !== undefined && inSeg.y1 !== undefined) {
                inSeg.x1 = Math.round(inSeg.x1 + (inTargetX - inSeg.x1) * blendBase);
                inSeg.y1 = Math.round(inSeg.y1 + (inTargetY - inSeg.y1) * blendBase);
              }
              if (outSeg.type === 'C' && outSeg.x1 !== undefined && outSeg.y1 !== undefined) {
                outSeg.x1 = Math.round(outSeg.x1 + (outTargetX - outSeg.x1) * blendBase);
                outSeg.y1 = Math.round(outSeg.y1 + (outTargetY - outSeg.y1) * blendBase);
              } else if (outSeg.type === 'Q' && outSeg.x1 !== undefined && outSeg.y1 !== undefined) {
                outSeg.x1 = Math.round(outSeg.x1 + (outTargetX - outSeg.x1) * blendBase);
                outSeg.y1 = Math.round(outSeg.y1 + (outTargetY - outSeg.y1) * blendBase);
              }
            }
          } else if (hasInHandle && nextIsLine && lineOutLen > 0.5) {
            const lx = lineOutDx / lineOutLen;
            const ly = lineOutDy / lineOutLen;
            const inTargetX = ax - lx * inLen;
            const inTargetY = ay - ly * inLen;
            if (inSeg.type === 'C' && inSeg.x2 !== undefined && inSeg.y2 !== undefined) {
              inSeg.x2 = Math.round(inSeg.x2 + (inTargetX - inSeg.x2) * blendBase);
              inSeg.y2 = Math.round(inSeg.y2 + (inTargetY - inSeg.y2) * blendBase);
            } else if (inSeg.type === 'Q' && inSeg.x1 !== undefined && inSeg.y1 !== undefined) {
              inSeg.x1 = Math.round(inSeg.x1 + (inTargetX - inSeg.x1) * blendBase);
              inSeg.y1 = Math.round(inSeg.y1 + (inTargetY - inSeg.y1) * blendBase);
            }
          } else if (hasOutHandle && prevIsLine && lineInLen > 0.5) {
            const lx = lineInDx / lineInLen;
            const ly = lineInDy / lineInLen;
            const outTargetX = ax + lx * outLen;
            const outTargetY = ay + ly * outLen;
            if (outSeg.type === 'C' && outSeg.x1 !== undefined && outSeg.y1 !== undefined) {
              outSeg.x1 = Math.round(outSeg.x1 + (outTargetX - outSeg.x1) * blendBase);
              outSeg.y1 = Math.round(outSeg.y1 + (outTargetY - outSeg.y1) * blendBase);
            } else if (outSeg.type === 'Q' && outSeg.x1 !== undefined && outSeg.y1 !== undefined) {
              outSeg.x1 = Math.round(outSeg.x1 + (outTargetX - outSeg.x1) * blendBase);
              outSeg.y1 = Math.round(outSeg.y1 + (outTargetY - outSeg.y1) * blendBase);
            }
          }
        }
      }
    }
  }

  // Spacing: shift glyph horizontally and adjust advance width
  if (tools.spacing !== 0) {
    const spacingDelta = Math.round((tools.spacing / 100) * upm * 0.1);
    const halfShift = Math.round(spacingDelta / 2);
    // Add equal sidebearing on both sides
    for (const c of result) {
      if (c.x !== undefined) c.x += halfShift;
      if (c.x1 !== undefined) c.x1 += halfShift;
      if (c.x2 !== undefined) c.x2 += halfShift;
    }
    advDelta += spacingDelta;
  }

  // Width also contributes to advance width
  if (tools.width !== 0) {
    advDelta += Math.round((tools.width / 100) * glyphW);
  }

  return { commands: result, advanceWidthDelta: advDelta };
}

// --- Boolean Indent (Clip) ---
// Uses polygon-clipping for robust intersection: indent ∩ fill region.
// Result: hole contours that only cut into fills, never create fill outside.

import polygonClipping from 'polygon-clipping';

function sampleCubicBezier(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number, steps: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push([
      mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
    ]);
  }
  return pts;
}

function sampleQuadBezier(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, steps: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push([
      mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
      mt * mt * y0 + 2 * mt * t * y1 + t * t * y2,
    ]);
  }
  return pts;
}

function contourToGeoJSONRing(
  commands: PathCommand[], start: number, end: number, samplesPerCurve = 40,
): [number, number][] {
  const ring: [number, number][] = [];
  let cx = 0, cy = 0;
  for (let i = start; i <= end; i++) {
    const cmd = commands[i];
    if (cmd.type === 'M') {
      cx = cmd.x ?? 0;
      cy = cmd.y ?? 0;
      ring.push([cx, cy]);
    } else if (cmd.type === 'L') {
      cx = cmd.x ?? cx;
      cy = cmd.y ?? cy;
      ring.push([cx, cy]);
    } else if (cmd.type === 'Q') {
      const samples = sampleQuadBezier(cx, cy, cmd.x1 ?? cx, cmd.y1 ?? cy, cmd.x ?? cx, cmd.y ?? cy, samplesPerCurve);
      ring.push(...samples);
      cx = cmd.x ?? cx;
      cy = cmd.y ?? cy;
    } else if (cmd.type === 'C') {
      const samples = sampleCubicBezier(cx, cy, cmd.x1 ?? cx, cmd.y1 ?? cy, cmd.x2 ?? cx, cmd.y2 ?? cy, cmd.x ?? cx, cmd.y ?? cy, samplesPerCurve);
      ring.push(...samples);
      cx = cmd.x ?? cx;
      cy = cmd.y ?? cy;
    }
  }
  return ring;
}

function ringToHoleCommands(ring: [number, number][]): PathCommand[] {
  if (ring.length < 3) return [];
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  const pts = area < 0 ? [...ring].reverse() : [...ring];
  const cmds: PathCommand[] = [{ type: 'M', x: Math.round(pts[0][0]), y: Math.round(pts[0][1]) }];
  for (let i = 1; i < pts.length; i++) {
    cmds.push({ type: 'L', x: Math.round(pts[i][0]), y: Math.round(pts[i][1]) } as PathCommand);
  }
  cmds.push({ type: 'Z' });
  return cmds;
}

export function makeIndent(commands: PathCommand[], indentContourIndices: number[]): PathCommand[] {
  const ranges = getContourRanges(commands);

  const fillPolygons: [number, number][][][] = [];
  for (let ci = 0; ci < ranges.length; ci++) {
    if (!indentContourIndices.includes(ci)) {
      const ring = contourToGeoJSONRing(commands, ranges[ci].start, ranges[ci].end, 40);
      if (ring.length >= 3) {
        fillPolygons.push([ring]);
      }
    }
  }
  if (fillPolygons.length === 0) return commands;

  let unionOfFills: [number, number][][][] = [fillPolygons[0]];
  for (let i = 1; i < fillPolygons.length; i++) {
    const u = polygonClipping.union(unionOfFills, [fillPolygons[i]]);
    unionOfFills = u.length > 0 ? u : unionOfFills;
  }

  const newContours: PathCommand[] = [];
  const sorted = [...indentContourIndices].sort((a, b) => b - a);

  for (const indentCi of indentContourIndices) {
    if (indentCi < 0 || indentCi >= ranges.length) continue;
    const indentRing = contourToGeoJSONRing(commands, ranges[indentCi].start, ranges[indentCi].end, 40);
    if (indentRing.length < 3) continue;

    const indentPoly: [number, number][][] = [indentRing];
    const intersectionResult = polygonClipping.intersection(unionOfFills, indentPoly);

    if (intersectionResult.length === 0) continue;

    for (const poly of intersectionResult) {
      for (const ring of poly) {
        if (ring.length >= 3) {
          newContours.push(...ringToHoleCommands(ring));
        }
      }
    }
  }

  let result = commands.map(c => ({ ...c }));
  for (const ci of sorted) {
    if (ci < 0 || ci >= ranges.length) continue;
    const r = ranges[ci];
    result.splice(r.start, r.end - r.start + 1);
  }
  result.push(...newContours);
  return result;
}
