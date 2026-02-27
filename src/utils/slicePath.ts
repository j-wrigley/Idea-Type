import type { PathCommand } from 'opentype.js';
import { getContourRanges } from './pathTransforms';
import { splitSegmentAtT } from './hitTesting';

export interface LinePathIntersection {
  contourIndex: number;
  segmentIndex: number;
  t: number;
  x: number;
  y: number;
  orderAlongLine: number;
}

function lineLineIntersection(
  l1x1: number, l1y1: number, l1x2: number, l1y2: number,
  l2x1: number, l2y1: number, l2x2: number, l2y2: number,
): { t: number; s: number } | null {
  const dx1 = l1x2 - l1x1;
  const dy1 = l1y2 - l1y1;
  const dx2 = l2x2 - l2x1;
  const dy2 = l2y2 - l2y1;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((l2x1 - l1x1) * dy2 - (l2y1 - l1y1) * dx2) / denom;
  const s = ((l2x1 - l1x1) * dy1 - (l2y1 - l1y1) * dx1) / denom;
  if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
    return { t, s };
  }
  return null;
}

function sampleQuadratic(
  ax: number, ay: number, cx: number, cy: number, bx: number, by: number,
  steps: number,
): { x: number; y: number; t: number }[] {
  const pts: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * ax + 2 * u * t * cx + t * t * bx,
      y: u * u * ay + 2 * u * t * cy + t * t * by,
      t,
    });
  }
  return pts;
}

function sampleCubic(
  ax: number, ay: number,
  c1x: number, c1y: number, c2x: number, c2y: number,
  bx: number, by: number,
  steps: number,
): { x: number; y: number; t: number }[] {
  const pts: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx,
      y: u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by,
      t,
    });
  }
  return pts;
}

/**
 * Find all intersections of a line segment with a path.
 * Returns intersections sorted by position along the slice line.
 */
export function findLinePathIntersections(
  lineX1: number, lineY1: number, lineX2: number, lineY2: number,
  commands: PathCommand[],
): LinePathIntersection[] {
  const intersections: LinePathIntersection[] = [];
  const ranges = getContourRanges(commands);

  for (let ci = 0; ci < ranges.length; ci++) {
    const { start, end } = ranges[ci];
    let prevX = 0, prevY = 0;

    for (let i = start; i <= end; i++) {
      const cmd = commands[i];

      if (cmd.type === 'M' && cmd.x !== undefined && cmd.y !== undefined) {
        prevX = cmd.x;
        prevY = cmd.y;
        continue;
      }

      if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
        const hit = lineLineIntersection(
          lineX1, lineY1, lineX2, lineY2,
          prevX, prevY, cmd.x, cmd.y,
        );
        if (hit) {
          const x = Math.round(prevX + hit.s * (cmd.x - prevX));
          const y = Math.round(prevY + hit.s * (cmd.y - prevY));
          intersections.push({
            contourIndex: ci,
            segmentIndex: i,
            t: hit.s,
            x, y,
            orderAlongLine: hit.t,
          });
        }
        prevX = cmd.x;
        prevY = cmd.y;
      }

      if (cmd.type === 'Q' && cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.x !== undefined && cmd.y !== undefined) {
        const samples = sampleQuadratic(prevX, prevY, cmd.x1, cmd.y1, cmd.x, cmd.y, 32);
        for (let s = 0; s < samples.length - 1; s++) {
          const a = samples[s];
          const b = samples[s + 1];
          const hit = lineLineIntersection(
            lineX1, lineY1, lineX2, lineY2,
            a.x, a.y, b.x, b.y,
          );
          if (hit) {
            const segT = a.t + hit.s * (b.t - a.t);
            const x = Math.round(a.x + hit.s * (b.x - a.x));
            const y = Math.round(a.y + hit.s * (b.y - a.y));
            intersections.push({
              contourIndex: ci,
              segmentIndex: i,
              t: segT,
              x, y,
              orderAlongLine: hit.t,
            });
            break;
          }
        }
        prevX = cmd.x;
        prevY = cmd.y;
      }

      if (cmd.type === 'C' &&
        cmd.x1 !== undefined && cmd.y1 !== undefined &&
        cmd.x2 !== undefined && cmd.y2 !== undefined &&
        cmd.x !== undefined && cmd.y !== undefined) {
        const samples = sampleCubic(
          prevX, prevY, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, 32,
        );
        for (let s = 0; s < samples.length - 1; s++) {
          const a = samples[s];
          const b = samples[s + 1];
          const hit = lineLineIntersection(
            lineX1, lineY1, lineX2, lineY2,
            a.x, a.y, b.x, b.y,
          );
          if (hit) {
            const segT = a.t + hit.s * (b.t - a.t);
            const x = Math.round(a.x + hit.s * (b.x - a.x));
            const y = Math.round(a.y + hit.s * (b.y - a.y));
            intersections.push({
              contourIndex: ci,
              segmentIndex: i,
              t: segT,
              x, y,
              orderAlongLine: hit.t,
            });
            break;
          }
        }
        prevX = cmd.x;
        prevY = cmd.y;
      }

      if (cmd.type === 'Z') {
        const moveCmd = commands[start];
        if (moveCmd?.type === 'M' && moveCmd.x !== undefined && moveCmd.y !== undefined) {
          const hit = lineLineIntersection(
            lineX1, lineY1, lineX2, lineY2,
            prevX, prevY, moveCmd.x, moveCmd.y,
          );
          if (hit) {
            const x = Math.round(prevX + hit.s * (moveCmd.x - prevX));
            const y = Math.round(prevY + hit.s * (moveCmd.y - prevY));
            intersections.push({
              contourIndex: ci,
              segmentIndex: i,
              t: hit.s,
              x, y,
              orderAlongLine: hit.t,
            });
          }
        }
        prevX = 0;
        prevY = 0;
      }
    }
  }

  intersections.sort((a, b) => a.orderAlongLine - b.orderAlongLine);
  return intersections;
}

export function getPointAtCommand(cmd: PathCommand): { x: number; y: number } | null {
  if (cmd.x !== undefined && cmd.y !== undefined) return { x: cmd.x, y: cmd.y };
  return null;
}

/**
 * Slice the path with a line. Adds intersection points and splits contours that the line crosses.
 * For each contour with 2 intersections, splits it into two contours.
 */
export function slicePathWithLine(
  commands: PathCommand[],
  lineX1: number, lineY1: number, lineX2: number, lineY2: number,
): PathCommand[] {
  const intersections = findLinePathIntersections(lineX1, lineY1, lineX2, lineY2, commands);
  if (intersections.length < 2) return commands;

  const byContour = new Map<number, LinePathIntersection[]>();
  for (const hit of intersections) {
    const arr = byContour.get(hit.contourIndex) ?? [];
    arr.push(hit);
    byContour.set(hit.contourIndex, arr);
  }

  let result = [...commands];
  let ranges = getContourRanges(result);

  const contourIndices = Array.from(byContour.keys()).sort((a, b) => b - a);
  for (const ci of contourIndices) {
    const hits = byContour.get(ci)!;
    if (hits.length < 2) continue;
    const { start, end } = ranges[ci];
    const isClosed = result[end]?.type === 'Z';
    if (!isClosed) continue;

    const [h1, h2] = hits.slice(0, 2);
    const moveCmd = result[start];
    const moveX = moveCmd?.type === 'M' && moveCmd.x !== undefined ? moveCmd.x : 0;
    const moveY = moveCmd?.type === 'M' && moveCmd.y !== undefined ? moveCmd.y : 0;

    let seg1 = h1.segmentIndex;
    let seg2 = h2.segmentIndex;
    if (result[seg1]?.type === 'Z') {
      result = [...result.slice(0, seg1), { type: 'L', x: moveX, y: moveY }, ...result.slice(seg1)];
      if (seg2 >= seg1) seg2++;
      seg1 = seg1;
    }
    if (result[seg2]?.type === 'Z') {
      result = [...result.slice(0, seg2), { type: 'L', x: moveX, y: moveY }, ...result.slice(seg2)];
      if (seg1 >= seg2) seg1++;
      seg2 = seg2;
    }
    ranges = getContourRanges(result);

    const splitOrder = seg1 > seg2 ? [h2, h1] : [h1, h2];
    const [first, second] = splitOrder;
    const secondSeg = Math.max(seg1, seg2);
    const firstSeg = Math.min(seg1, seg2);

    result = splitSegmentAtT(result, secondSeg, second.t);
    const firstIdxAdjusted = firstSeg <= secondSeg ? firstSeg : firstSeg + 1;
    result = splitSegmentAtT(result, firstIdxAdjusted, first.t);

    ranges = getContourRanges(result);
    const contourRange = ranges[ci];
    if (!contourRange) continue;

    const contourCmds = result.slice(contourRange.start, contourRange.end + 1);
    const n = contourCmds.length - 1;

    const findCmdWithPoint = (x: number, y: number): number => {
      for (let i = 0; i < contourCmds.length; i++) {
        const c = contourCmds[i];
        const pt = getPointAtCommand(c);
        if (pt && Math.abs(pt.x - x) < 2 && Math.abs(pt.y - y) < 2) return i;
      }
      return -1;
    };

    const i1 = findCmdWithPoint(first.x, first.y);
    const i2 = findCmdWithPoint(second.x, second.y);
    if (i1 < 0 || i2 < 0 || i1 === i2) continue;

    const extractArc = (from: number, to: number): PathCommand[] => {
      const startPt = getPointAtCommand(contourCmds[from]);
      if (!startPt) return [];
      const out: PathCommand[] = [{ type: 'M', x: startPt.x, y: startPt.y }];
      let i = (from + 1) % n;
      while (true) {
        const c = contourCmds[i];
        if (c && c.type !== 'Z' && c.type !== 'M') {
          out.push({ ...c });
        }
        if (i === to) break;
        i = (i + 1) % n;
      }
      if (contourCmds[to]?.type === 'M') {
        const endPt = getPointAtCommand(contourCmds[to]);
        if (endPt) out.push({ type: 'L', x: endPt.x, y: endPt.y });
      }
      out.push({ type: 'Z' });
      return out;
    };

    const arc1 = extractArc(i1, i2);
    const arc2 = extractArc(i2, i1);

    if (arc1.length >= 3 && arc2.length >= 3) {
      const before = result.slice(0, contourRange.start);
      const after = result.slice(contourRange.end + 1);
      result = [...before, ...arc1, ...arc2, ...after];
      ranges = getContourRanges(result);
    }
  }

  return result;
}
