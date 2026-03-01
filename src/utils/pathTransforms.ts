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

export function applyDesignTools(
  commands: PathCommand[],
  tools: DesignToolValues,
  font: { unitsPerEm: number; ascender: number; descender: number },
): { commands: PathCommand[]; advanceWidthDelta: number } {
  if (commands.length === 0) {
    return { commands, advanceWidthDelta: 0 };
  }

  const bounds = getGlyphBounds(commands);
  const { cx, cy, minX, maxX, minY, maxY } = bounds;
  const upm = font.unitsPerEm;
  const glyphW = maxX - minX || 1;
  const glyphH = maxY - minY || 1;
  const xHeightApprox = font.ascender * 0.72;

  // Pre-compute normals for weight and contrast
  let outlineNormals: Map<number, { nx: number; ny: number }> | null = null;
  let cpNormals: Map<number, { field: 'cp1' | 'cp2'; nx: number; ny: number }[]> | null = null;
  if (tools.weight !== 0 || tools.contrast !== 0 || tools.inkTrap !== 0 || tools.serif !== 0) {
    outlineNormals = computeOutlineNormals(commands);
    cpNormals = computeControlPointNormals(commands, outlineNormals);
  }

  // Classify points for roundness
  const { anchorIndices } = buildAnchorGraph(commands);

  // Precompute ink trap sharpness per point (dot product of neighbor normals)
  let inkTrapSharpness: Map<number, number> | null = null;
  if (tools.inkTrap !== 0 && outlineNormals) {
    inkTrapSharpness = new Map();
    const ranges = getContourRanges(commands);
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
  const result = commands.map((cmd, cmdIdx) => {
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
        const prev = commands[k];
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
