import type { PathCommand } from 'opentype.js';
import type { SegmentDef } from '../types';

/**
 * Fit a segment definition's open path so that its first point maps to
 * targetStart and its last point maps to targetEnd.  Returns a new
 * PathCommand[] (without the leading M — ready to splice into an
 * existing contour).
 */
export function fitSegmentBetweenPoints(
  segDef: SegmentDef,
  targetStart: { x: number; y: number },
  targetEnd: { x: number; y: number },
  flip = false,
): PathCommand[] {
  const cmds = segDef.commands;
  if (cmds.length < 2) return [];

  const first = cmds[0];
  const last = cmds[cmds.length - 1];
  if (first.x === undefined || first.y === undefined) return [];
  if (last.x === undefined || last.y === undefined) return [];

  const srcStart = { x: first.x, y: first.y };
  const srcEnd = { x: last.x, y: last.y };

  const srcDx = srcEnd.x - srcStart.x;
  const srcDy = srcEnd.y - srcStart.y;
  const srcLen = Math.sqrt(srcDx * srcDx + srcDy * srcDy);
  if (srcLen < 0.001) return [];

  const tgtDx = targetEnd.x - targetStart.x;
  const tgtDy = targetEnd.y - targetStart.y;
  const tgtLen = Math.sqrt(tgtDx * tgtDx + tgtDy * tgtDy);
  if (tgtLen < 0.001) return [];

  const scale = tgtLen / srcLen;

  const srcAngle = Math.atan2(srcDy, srcDx);
  const tgtAngle = Math.atan2(tgtDy, tgtDx);
  const rotation = tgtAngle - srcAngle;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // When flipped, negate the perpendicular (Y) component in local space
  // before applying rotation+scale — mirrors the segment across the
  // start→end baseline.
  const ySign = flip ? -1 : 1;

  function xform(x: number, y: number): { x: number; y: number } {
    const dx = x - srcStart.x;
    const dy = (y - srcStart.y) * ySign;
    const sx = dx * scale;
    const sy = dy * scale;
    return {
      x: Math.round(sx * cos - sy * sin + targetStart.x),
      y: Math.round(sx * sin + sy * cos + targetStart.y),
    };
  }

  // Skip the leading M — the caller already has the start point in the path
  const result: PathCommand[] = [];
  for (let i = 1; i < cmds.length; i++) {
    const cmd = cmds[i];
    const out: PathCommand = { type: cmd.type };

    if (cmd.x !== undefined && cmd.y !== undefined) {
      const p = xform(cmd.x, cmd.y);
      out.x = p.x;
      out.y = p.y;
    }
    if (cmd.x1 !== undefined && cmd.y1 !== undefined) {
      const p = xform(cmd.x1, cmd.y1);
      out.x1 = p.x;
      out.y1 = p.y;
    }
    if (cmd.x2 !== undefined && cmd.y2 !== undefined) {
      const p = xform(cmd.x2, cmd.y2);
      out.x2 = p.x;
      out.y2 = p.y;
    }

    result.push(out);
  }

  return result;
}

/**
 * Given the full glyph commands and a pair of command indices representing
 * two on-curve anchor points, replace the path between them with the
 * fitted segment commands.
 *
 * startIdx and endIdx are the command indices of the two on-curve nodes.
 * They must be in the same contour and startIdx < endIdx.
 *
 * Returns the new commands array.
 */
export function applySegmentToPath(
  commands: PathCommand[],
  startIdx: number,
  endIdx: number,
  segDef: SegmentDef,
  flip = false,
): PathCommand[] | null {
  if (startIdx >= endIdx) return null;
  if (startIdx < 0 || endIdx >= commands.length) return null;

  const startCmd = commands[startIdx];
  const endCmd = commands[endIdx];

  if (startCmd.x === undefined || startCmd.y === undefined) return null;
  if (endCmd.x === undefined || endCmd.y === undefined) return null;

  const targetStart = { x: startCmd.x, y: startCmd.y };
  const targetEnd = { x: endCmd.x, y: endCmd.y };

  const fitted = fitSegmentBetweenPoints(segDef, targetStart, targetEnd, flip);
  if (fitted.length === 0) return null;

  // Replace commands (startIdx+1 ... endIdx) with the fitted segment.
  // We keep startIdx (the start anchor point) and replace everything up to
  // and including endIdx.  The last command in fitted will land on endIdx's
  // position, so it replaces endIdx.
  const before = commands.slice(0, startIdx + 1);
  const after = commands.slice(endIdx + 1);

  return [...before, ...fitted, ...after];
}

/**
 * Create a SegmentDef from a set of consecutive commands extracted from
 * a path.  The commands should form an open path (M ... without Z).
 * They are normalized so the start is at (0,0).
 */
export function createSegmentFromCommands(
  name: string,
  cmds: PathCommand[],
  category: SegmentDef['category'] = 'custom',
): { commands: PathCommand[]; name: string; category: SegmentDef['category'] } | null {
  if (cmds.length < 2) return null;

  const first = cmds[0];
  if (first.x === undefined || first.y === undefined) return null;

  const ox = first.x;
  const oy = first.y;

  const normalized: PathCommand[] = cmds.map(c => {
    const out: PathCommand = { type: c.type };
    if (c.x !== undefined && c.y !== undefined) {
      out.x = Math.round(c.x - ox);
      out.y = Math.round(c.y - oy);
    }
    if (c.x1 !== undefined && c.y1 !== undefined) {
      out.x1 = Math.round(c.x1 - ox);
      out.y1 = Math.round(c.y1 - oy);
    }
    if (c.x2 !== undefined && c.y2 !== undefined) {
      out.x2 = Math.round(c.x2 - ox);
      out.y2 = Math.round(c.y2 - oy);
    }
    return out;
  });

  // Ensure starts with M
  if (normalized[0].type !== 'M') {
    normalized.unshift({ type: 'M', x: 0, y: 0 });
  }

  // Strip trailing Z if present
  if (normalized[normalized.length - 1].type === 'Z') {
    normalized.pop();
  }

  return { commands: normalized, name, category };
}
