import type { EditablePoint } from '../types';
import type { PathCommand } from 'opentype.js';

const HIT_RADIUS = 10;
const SEGMENT_HIT_RADIUS = 6;

export function getEditablePoints(commands: PathCommand[]): EditablePoint[] {
  const points: EditablePoint[] = [];

  // Pre-scan: for each closed contour, find the M start and the last
  // command before Z. If the last command's endpoint coincides with M,
  // skip it to avoid a duplicate anchor at the contour start.
  // Also skip any command whose endpoint duplicates the immediately
  // preceding command's endpoint.
  const skipEndpoint = new Set<number>();
  let contourMoveIdx = -1;
  const TOLERANCE = 1;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === 'M') {
      contourMoveIdx = i;
    } else if (cmd.type === 'Z' && contourMoveIdx >= 0) {
      const mCmd = commands[contourMoveIdx];
      if (mCmd.x !== undefined && mCmd.y !== undefined) {
        // Find the last drawing command before Z
        for (let j = i - 1; j > contourMoveIdx; j--) {
          const prev = commands[j];
          if (prev.x !== undefined && prev.y !== undefined &&
              Math.abs(prev.x - mCmd.x) < TOLERANCE &&
              Math.abs(prev.y - mCmd.y) < TOLERANCE &&
              prev.type !== 'M') {
            skipEndpoint.add(j);
          }
          break;
        }
      }
      contourMoveIdx = -1;
    }
  }

  // Second pass: skip consecutive on-curve anchors at the same position
  let prevAnchorX: number | undefined;
  let prevAnchorY: number | undefined;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === 'M' || cmd.type === 'Z') {
      prevAnchorX = cmd.x;
      prevAnchorY = cmd.y;
      continue;
    }
    if (cmd.x !== undefined && cmd.y !== undefined &&
        prevAnchorX !== undefined && prevAnchorY !== undefined &&
        (cmd.type === 'L' || cmd.type === 'M') &&
        Math.abs(cmd.x - prevAnchorX) < TOLERANCE &&
        Math.abs(cmd.y - prevAnchorY) < TOLERANCE) {
      skipEndpoint.add(i);
    }
    if (cmd.x !== undefined && cmd.y !== undefined) {
      prevAnchorX = cmd.x;
      prevAnchorY = cmd.y;
    }
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.type === 'Z') continue;

    if (
      (cmd.type === 'Q' || cmd.type === 'C') &&
      cmd.x1 !== undefined &&
      cmd.y1 !== undefined
    ) {
      points.push({
        commandIndex: i,
        field: 'cp1',
        x: cmd.x1,
        y: cmd.y1,
        isOnCurve: false,
      });
    }

    if (cmd.type === 'C' && cmd.x2 !== undefined && cmd.y2 !== undefined) {
      points.push({
        commandIndex: i,
        field: 'cp2',
        x: cmd.x2,
        y: cmd.y2,
        isOnCurve: false,
      });
    }

    if (cmd.x !== undefined && cmd.y !== undefined && !skipEndpoint.has(i)) {
      points.push({
        commandIndex: i,
        field: 'end',
        x: cmd.x,
        y: cmd.y,
        isOnCurve: true,
      });
    }
  }

  return points;
}

export function findPointAtScreenPos(
  points: EditablePoint[],
  screenX: number,
  screenY: number,
  glyphToScreen: (gx: number, gy: number) => { x: number; y: number },
): EditablePoint | null {
  let closest: EditablePoint | null = null;
  let closestDist = HIT_RADIUS;

  for (const pt of points) {
    const screen = glyphToScreen(pt.x, pt.y);
    const dx = screen.x - screenX;
    const dy = screen.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = pt;
    }
  }

  return closest;
}

export function findPointsInRect(
  points: EditablePoint[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  glyphToScreen: (gx: number, gy: number) => { x: number; y: number },
): EditablePoint[] {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  return points.filter((pt) => {
    const screen = glyphToScreen(pt.x, pt.y);
    return screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom;
  });
}

function distToLineSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function sampleBezierQ(
  ax: number, ay: number,
  cx: number, cy: number,
  bx: number, by: number,
  steps: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * ax + 2 * u * t * cx + t * t * bx,
      y: u * u * ay + 2 * u * t * cy + t * t * by,
    });
  }
  return pts;
}

function sampleBezierC(
  ax: number, ay: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  bx: number, by: number,
  steps: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx,
      y: u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by,
    });
  }
  return pts;
}

export interface SegmentHit {
  commandIndex: number;
  t: number;
}

export function findSegmentAtScreenPos(
  commands: PathCommand[],
  screenX: number,
  screenY: number,
  glyphToScreen: (gx: number, gy: number) => { x: number; y: number },
): SegmentHit | null {
  let prevX = 0;
  let prevY = 0;
  let bestDist = SEGMENT_HIT_RADIUS;
  let bestHit: SegmentHit | null = null;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
      prevX = cmd.x;
      prevY = cmd.y;
      continue;
    }

    if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
      const a = glyphToScreen(prevX, prevY);
      const b = glyphToScreen(cmd.x, cmd.y);
      const d = distToLineSegment(screenX, screenY, a.x, a.y, b.x, b.y);
      if (d < bestDist) {
        bestDist = d;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((screenX - a.x) * dx + (screenY - a.y) * dy) / lenSq)) : 0.5;
        bestHit = { commandIndex: i, t };
      }
      prevX = cmd.x;
      prevY = cmd.y;
    }

    if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
      const samples = sampleBezierQ(prevX, prevY, cmd.x1, cmd.y1, cmd.x, cmd.y, 20);
      for (let s = 0; s < samples.length - 1; s++) {
        const a = glyphToScreen(samples[s].x, samples[s].y);
        const b = glyphToScreen(samples[s + 1].x, samples[s + 1].y);
        const d = distToLineSegment(screenX, screenY, a.x, a.y, b.x, b.y);
        if (d < bestDist) {
          bestDist = d;
          bestHit = { commandIndex: i, t: (s + 0.5) / 20 };
        }
      }
      prevX = cmd.x;
      prevY = cmd.y;
    }

    if (
      cmd.type === 'C' &&
      cmd.x1 !== undefined && cmd.y1 !== undefined &&
      cmd.x2 !== undefined && cmd.y2 !== undefined &&
      cmd.x !== undefined && cmd.y !== undefined
    ) {
      const samples = sampleBezierC(prevX, prevY, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, 20);
      for (let s = 0; s < samples.length - 1; s++) {
        const a = glyphToScreen(samples[s].x, samples[s].y);
        const b = glyphToScreen(samples[s + 1].x, samples[s + 1].y);
        const d = distToLineSegment(screenX, screenY, a.x, a.y, b.x, b.y);
        if (d < bestDist) {
          bestDist = d;
          bestHit = { commandIndex: i, t: (s + 0.5) / 20 };
        }
      }
      prevX = cmd.x;
      prevY = cmd.y;
    }

    if (cmd.type === 'Z') {
      prevX = 0;
      prevY = 0;
    }
  }

  return bestHit;
}

export function splitSegmentAtT(
  commands: PathCommand[],
  segmentIndex: number,
  t: number,
): PathCommand[] {
  const cmd = commands[segmentIndex];
  const result = [...commands];

  let prevX = 0;
  let prevY = 0;
  for (let i = segmentIndex - 1; i >= 0; i--) {
    const c = commands[i];
    if (c.x !== undefined && c.y !== undefined) {
      prevX = c.x;
      prevY = c.y;
      break;
    }
  }

  if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
    const mx = Math.round(prevX + t * (cmd.x - prevX));
    const my = Math.round(prevY + t * (cmd.y - prevY));
    const newPoint: PathCommand = { type: 'L', x: mx, y: my };
    result.splice(segmentIndex, 0, newPoint);
    return result;
  }

  if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
    const u = 1 - t;
    const q0x = u * prevX + t * cmd.x1;
    const q0y = u * prevY + t * cmd.y1;
    const q1x = u * cmd.x1 + t * cmd.x;
    const q1y = u * cmd.y1 + t * cmd.y;
    const midX = u * q0x + t * q1x;
    const midY = u * q0y + t * q1y;

    const first: PathCommand = { type: 'Q', x1: Math.round(q0x), y1: Math.round(q0y), x: Math.round(midX), y: Math.round(midY) };
    const second: PathCommand = { type: 'Q', x1: Math.round(q1x), y1: Math.round(q1y), x: cmd.x, y: cmd.y };
    result.splice(segmentIndex, 1, first, second);
    return result;
  }

  if (
    cmd.type === 'C' &&
    cmd.x1 !== undefined && cmd.y1 !== undefined &&
    cmd.x2 !== undefined && cmd.y2 !== undefined &&
    cmd.x !== undefined && cmd.y !== undefined
  ) {
    const u = 1 - t;
    const b0x = u * prevX + t * cmd.x1;
    const b0y = u * prevY + t * cmd.y1;
    const b1x = u * cmd.x1 + t * cmd.x2;
    const b1y = u * cmd.y1 + t * cmd.y2;
    const b2x = u * cmd.x2 + t * cmd.x;
    const b2y = u * cmd.y2 + t * cmd.y;

    const c0x = u * b0x + t * b1x;
    const c0y = u * b0y + t * b1y;
    const c1x = u * b1x + t * b2x;
    const c1y = u * b1y + t * b2y;

    const midX = u * c0x + t * c1x;
    const midY = u * c0y + t * c1y;

    const first: PathCommand = {
      type: 'C',
      x1: Math.round(b0x), y1: Math.round(b0y),
      x2: Math.round(c0x), y2: Math.round(c0y),
      x: Math.round(midX), y: Math.round(midY),
    };
    const second: PathCommand = {
      type: 'C',
      x1: Math.round(c1x), y1: Math.round(c1y),
      x2: Math.round(b2x), y2: Math.round(b2y),
      x: cmd.x, y: cmd.y,
    };
    result.splice(segmentIndex, 1, first, second);
    return result;
  }

  return result;
}

export function promoteSegment(
  commands: PathCommand[],
  commandIndex: number,
): PathCommand[] {
  const cmd = commands[commandIndex];
  const result = [...commands];

  if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
    let prevX = 0;
    let prevY = 0;
    for (let i = commandIndex - 1; i >= 0; i--) {
      const c = commands[i];
      if (c.x !== undefined && c.y !== undefined) {
        prevX = c.x;
        prevY = c.y;
        break;
      }
    }
    // Place control point on the line at 1/2 so the shape doesn't change
    const mx = Math.round(prevX + 0.5 * (cmd.x - prevX));
    const my = Math.round(prevY + 0.5 * (cmd.y - prevY));
    result[commandIndex] = { type: 'Q', x1: mx, y1: my, x: cmd.x, y: cmd.y };
    return result;
  }

  if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
    let prevX = 0;
    let prevY = 0;
    for (let i = commandIndex - 1; i >= 0; i--) {
      const c = commands[i];
      if (c.x !== undefined && c.y !== undefined) {
        prevX = c.x;
        prevY = c.y;
        break;
      }
    }
    // Lossless Q->C conversion
    const cp1x = Math.round(prevX + (2 / 3) * (cmd.x1 - prevX));
    const cp1y = Math.round(prevY + (2 / 3) * (cmd.y1 - prevY));
    const cp2x = Math.round(cmd.x + (2 / 3) * (cmd.x1 - cmd.x));
    const cp2y = Math.round(cmd.y + (2 / 3) * (cmd.y1 - cmd.y));
    result[commandIndex] = { type: 'C', x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x: cmd.x, y: cmd.y };
    return result;
  }

  return result;
}

export function demoteSegment(
  commands: PathCommand[],
  commandIndex: number,
): PathCommand[] {
  const cmd = commands[commandIndex];
  const result = [...commands];

  if (cmd.type === 'C' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x2 !== undefined && cmd.y2 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
    let prevX = 0, prevY = 0;
    for (let i = commandIndex - 1; i >= 0; i--) {
      const c = commands[i];
      if (c.x !== undefined && c.y !== undefined) {
        prevX = c.x; prevY = c.y;
        break;
      }
    }
    // Best-fit quadratic control point from cubic:
    // The cubic's midpoint at t=0.5 should match the quadratic's midpoint at t=0.5.
    // Q(0.5) = 0.25*P0 + 0.5*CP + 0.25*P3
    // C(0.5) = 0.125*P0 + 0.375*CP1 + 0.375*CP2 + 0.125*P3
    // Solving: CP = 0.75*(CP1 + CP2) - 0.25*(P0 + P3) ... but simpler:
    // use the standard 3/4 rule: CP = (3*CP1 + 3*CP2 - P0 - P3) / 4
    // which minimizes the max deviation for most curves.
    const cpX = Math.round((3 * cmd.x1 + 3 * cmd.x2 - prevX - cmd.x) / 4);
    const cpY = Math.round((3 * cmd.y1 + 3 * cmd.y2 - prevY - cmd.y) / 4);
    result[commandIndex] = { type: 'Q', x1: cpX, y1: cpY, x: cmd.x, y: cmd.y };
    return result;
  }

  if (cmd.type === 'Q' && cmd.x !== undefined && cmd.y !== undefined) {
    result[commandIndex] = { type: 'L', x: cmd.x, y: cmd.y };
    return result;
  }

  return result;
}

export function convertSegmentToType(
  commands: PathCommand[],
  commandIndex: number,
  targetType: 'L' | 'Q' | 'C',
): PathCommand[] {
  const cmd = commands[commandIndex];
  if (cmd.type === targetType || cmd.type === 'M' || cmd.type === 'Z') return commands;

  const typeOrder = ['L', 'Q', 'C'];
  const currentOrder = typeOrder.indexOf(cmd.type);
  const targetOrder = typeOrder.indexOf(targetType);

  let result = commands;
  if (targetOrder > currentOrder) {
    for (let i = currentOrder; i < targetOrder; i++) {
      result = promoteSegment(result, commandIndex);
    }
  } else {
    for (let i = currentOrder; i > targetOrder; i--) {
      result = demoteSegment(result, commandIndex);
    }
  }
  return result;
}

export function deletePoints(
  commands: PathCommand[],
  selectedPoints: EditablePoint[],
): PathCommand[] {
  const deleteEndpoints = new Set<number>();
  const demoteCpFields = new Map<number, Set<string>>();

  for (const pt of selectedPoints) {
    if (pt.field === 'end') {
      deleteEndpoints.add(pt.commandIndex);
    } else {
      if (!demoteCpFields.has(pt.commandIndex)) {
        demoteCpFields.set(pt.commandIndex, new Set());
      }
      demoteCpFields.get(pt.commandIndex)!.add(pt.field);
    }
  }

  const result: PathCommand[] = [];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    if (deleteEndpoints.has(i)) {
      if (cmd.type === 'M') {
        const nextIdx = i + 1;
        if (nextIdx < commands.length && commands[nextIdx].type !== 'M' && commands[nextIdx].type !== 'Z') {
          const next = commands[nextIdx];
          if (next.x !== undefined && next.y !== undefined) {
            result.push({ type: 'M', x: next.x, y: next.y });
            deleteEndpoints.add(nextIdx);
          }
        }
      }
      continue;
    }

    if (demoteCpFields.has(i)) {
      const fields = demoteCpFields.get(i)!;
      if (cmd.type === 'C') {
        if (fields.has('cp1') && fields.has('cp2')) {
          result.push({ type: 'L', x: cmd.x, y: cmd.y });
        } else if (fields.has('cp1')) {
          result.push({ type: 'Q', x1: cmd.x2, y1: cmd.y2, x: cmd.x, y: cmd.y });
        } else {
          result.push({ type: 'Q', x1: cmd.x1, y1: cmd.y1, x: cmd.x, y: cmd.y });
        }
      } else if (cmd.type === 'Q') {
        result.push({ type: 'L', x: cmd.x, y: cmd.y });
      } else {
        result.push(cmd);
      }
      continue;
    }

    result.push(cmd);
  }

  return result;
}
