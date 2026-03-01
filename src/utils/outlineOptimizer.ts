import type { PathCommand } from 'opentype.js';

/**
 * Lossless conversion of quadratic bezier (Q) commands to cubic (C) commands.
 * Formula: Q(P0, CP, P2) -> C(P0, P0 + 2/3*(CP-P0), P2 + 2/3*(CP-P2), P2)
 */
export function quadraticToCubic(commands: PathCommand[]): PathCommand[] {
  const result: PathCommand[] = [];
  let curX = 0, curY = 0;

  for (const cmd of commands) {
    if (cmd.type === 'Q' &&
        cmd.x1 !== undefined && cmd.y1 !== undefined &&
        cmd.x !== undefined && cmd.y !== undefined) {
      const cpx = cmd.x1, cpy = cmd.y1;
      const endX = cmd.x, endY = cmd.y;

      result.push({
        type: 'C',
        x1: curX + (2 / 3) * (cpx - curX),
        y1: curY + (2 / 3) * (cpy - curY),
        x2: endX + (2 / 3) * (cpx - endX),
        y2: endY + (2 / 3) * (cpy - endY),
        x: endX,
        y: endY,
      } as PathCommand);
      curX = endX;
      curY = endY;
    } else {
      result.push({ ...cmd });
      if (cmd.x !== undefined && cmd.y !== undefined) {
        curX = cmd.x;
        curY = cmd.y;
      }
    }
  }
  return result;
}

function evalCubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function approxArcLength(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
): number {
  let len = 0;
  let px = p0x, py = p0y;
  const STEPS = 12;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = evalCubic(p0x, p1x, p2x, p3x, t);
    const y = evalCubic(p0y, p1y, p2y, p3y, t);
    const dx = x - px, dy = y - py;
    len += Math.sqrt(dx * dx + dy * dy);
    px = x; py = y;
  }
  return len;
}

function isExtremumPoint(
  x: number, y: number,
  minX: number, minY: number, maxX: number, maxY: number,
  tolerance: number,
): boolean {
  return (
    Math.abs(x - minX) < tolerance ||
    Math.abs(x - maxX) < tolerance ||
    Math.abs(y - minY) < tolerance ||
    Math.abs(y - maxY) < tolerance
  );
}

function areTangentsSmooth(
  t1x: number, t1y: number,
  t2x: number, t2y: number,
  threshold: number,
): boolean {
  const len1 = Math.sqrt(t1x * t1x + t1y * t1y);
  const len2 = Math.sqrt(t2x * t2x + t2y * t2y);
  if (len1 < 0.001 || len2 < 0.001) return true;
  const dot = (t1x / len1) * (t2x / len2) + (t1y / len1) * (t2y / len2);
  return dot > threshold;
}

interface CurveSegment {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
}

interface SamplePoint {
  x: number;
  y: number;
  u: number; // parameterization in [0, 1]
}

/**
 * Sample dense points along a chain of cubic segments, parameterized
 * by cumulative arc length normalized to [0, 1].
 */
function sampleChain(chain: CurveSegment[], samplesPerCurve: number): SamplePoint[] {
  const arcLengths: number[] = [];
  let totalArc = 0;
  for (const c of chain) {
    const a = approxArcLength(c.p0x, c.p0y, c.p1x, c.p1y, c.p2x, c.p2y, c.p3x, c.p3y);
    totalArc += a;
    arcLengths.push(totalArc);
  }
  if (totalArc < 0.001) return [];

  const points: SamplePoint[] = [];
  for (let ci = 0; ci < chain.length; ci++) {
    const c = chain[ci];
    const arcBefore = ci > 0 ? arcLengths[ci - 1] : 0;
    const arcThis = arcLengths[ci] - arcBefore;

    for (let s = 1; s < samplesPerCurve; s++) {
      const localT = s / samplesPerCurve;
      points.push({
        x: evalCubic(c.p0x, c.p1x, c.p2x, c.p3x, localT),
        y: evalCubic(c.p0y, c.p1y, c.p2y, c.p3y, localT),
        u: (arcBefore + localT * arcThis) / totalArc,
      });
    }
  }
  return points;
}

/**
 * Least-squares cubic bezier fit with endpoint tangent constraints.
 * Based on the Graphics Gems curve fitting algorithm.
 *
 * Given sample points and tangent directions at start/end, finds the
 * optimal handle lengths (alpha1, alpha2) that minimize the sum of
 * squared distances from samples to the fitted curve.
 *
 * P1 = start + alpha1 * t1  (departing tangent)
 * P2 = end   + alpha2 * t2  (arriving tangent, pointing backward)
 */
function fitCubicLeastSquares(
  points: SamplePoint[],
  startX: number, startY: number,
  endX: number, endY: number,
  t1x: number, t1y: number,
  t2x: number, t2y: number,
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } | null {
  if (points.length === 0) return null;

  let C11 = 0, C12 = 0, C22 = 0, X1 = 0, X2 = 0;

  for (const p of points) {
    const u = p.u;
    const mu = 1 - u;
    const B0 = mu * mu * mu;
    const B1 = 3 * mu * mu * u;
    const B2 = 3 * mu * u * u;
    const B3 = u * u * u;

    // Residual: what the curve needs to add beyond the P0/P3 interpolation
    const ex = p.x - (B0 + B1) * startX - (B2 + B3) * endX;
    const ey = p.y - (B0 + B1) * startY - (B2 + B3) * endY;

    // Basis vectors for the two unknowns (alpha1, alpha2)
    const a1x = B1 * t1x, a1y = B1 * t1y;
    const a2x = B2 * t2x, a2y = B2 * t2y;

    C11 += a1x * a1x + a1y * a1y;
    C12 += a1x * a2x + a1y * a2y;
    C22 += a2x * a2x + a2y * a2y;
    X1  += a1x * ex  + a1y * ey;
    X2  += a2x * ex  + a2y * ey;
  }

  const det = C11 * C22 - C12 * C12;
  if (Math.abs(det) < 1e-12) return null;

  const alpha1 = (X1 * C22 - X2 * C12) / det;
  const alpha2 = (X2 * C11 - X1 * C12) / det;

  // Both alphas should be positive (handles extend forward from their endpoints)
  if (alpha1 < 0.01 || alpha2 < 0.01) return null;

  return {
    cp1x: startX + alpha1 * t1x,
    cp1y: startY + alpha1 * t1y,
    cp2x: endX + alpha2 * t2x,
    cp2y: endY + alpha2 * t2y,
  };
}

/**
 * Compute the maximum squared error between a fitted cubic and the original
 * chain of cubic segments.
 */
function computeMaxErrorSq(
  chain: CurveSegment[],
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  samplesPerCurve: number,
): number {
  const startX = chain[0].p0x, startY = chain[0].p0y;
  const last = chain[chain.length - 1];
  const endX = last.p3x, endY = last.p3y;

  const arcLengths: number[] = [];
  let totalArc = 0;
  for (const c of chain) {
    totalArc += approxArcLength(c.p0x, c.p0y, c.p1x, c.p1y, c.p2x, c.p2y, c.p3x, c.p3y);
    arcLengths.push(totalArc);
  }
  if (totalArc < 0.001) return 0;

  let maxErrSq = 0;

  for (let ci = 0; ci < chain.length; ci++) {
    const c = chain[ci];
    const arcBefore = ci > 0 ? arcLengths[ci - 1] : 0;
    const arcThis = arcLengths[ci] - arcBefore;

    for (let s = 1; s < samplesPerCurve; s++) {
      const localT = s / samplesPerCurve;
      const ox = evalCubic(c.p0x, c.p1x, c.p2x, c.p3x, localT);
      const oy = evalCubic(c.p0y, c.p1y, c.p2y, c.p3y, localT);

      const globalT = (arcBefore + localT * arcThis) / totalArc;
      const mx = evalCubic(startX, cp1x, cp2x, endX, globalT);
      const my = evalCubic(startY, cp1y, cp2y, endY, globalT);

      const dx = ox - mx, dy = oy - my;
      const sq = dx * dx + dy * dy;
      if (sq > maxErrSq) maxErrSq = sq;
    }
  }

  return maxErrSq;
}

/**
 * Try to fit a single cubic to a chain of cubic segments using least-squares.
 * Falls back to heuristic tangent-ratio fitting if LS produces a bad result.
 */
function tryMergeChain(
  chain: CurveSegment[],
  tolSq: number,
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } | null {
  if (chain.length < 2) return null;

  const first = chain[0];
  const last = chain[chain.length - 1];
  const startX = first.p0x, startY = first.p0y;
  const endX = last.p3x, endY = last.p3y;

  // Departing tangent (unit vector from P0 toward P1)
  let depX = first.p1x - first.p0x;
  let depY = first.p1y - first.p0y;
  let depLen = Math.sqrt(depX * depX + depY * depY);
  if (depLen < 0.001) {
    // Degenerate cp1: use the chord to the first endpoint as tangent
    depX = first.p3x - first.p0x;
    depY = first.p3y - first.p0y;
    depLen = Math.sqrt(depX * depX + depY * depY);
    if (depLen < 0.001) return null;
  }
  const t1x = depX / depLen, t1y = depY / depLen;

  // Arriving tangent (unit vector from P3 toward P2 — points backward)
  let arrX = last.p2x - last.p3x;
  let arrY = last.p2y - last.p3y;
  let arrLen = Math.sqrt(arrX * arrX + arrY * arrY);
  if (arrLen < 0.001) {
    arrX = last.p0x - last.p3x;
    arrY = last.p0y - last.p3y;
    arrLen = Math.sqrt(arrX * arrX + arrY * arrY);
    if (arrLen < 0.001) return null;
  }
  const t2x = arrX / arrLen, t2y = arrY / arrLen;

  const SAMPLES = 16;
  const samples = sampleChain(chain, SAMPLES);

  // Attempt 1: Least-squares fit
  const lsFit = fitCubicLeastSquares(samples, startX, startY, endX, endY, t1x, t1y, t2x, t2y);
  if (lsFit) {
    const err = computeMaxErrorSq(chain, lsFit.cp1x, lsFit.cp1y, lsFit.cp2x, lsFit.cp2y, SAMPLES);
    if (err <= tolSq) return lsFit;
  }

  // Attempt 2: Heuristic tangent-ratio fitting as fallback
  let totalArc = 0;
  for (const c of chain) {
    totalArc += approxArcLength(c.p0x, c.p0y, c.p1x, c.p1y, c.p2x, c.p2y, c.p3x, c.p3y);
  }
  const firstArc = approxArcLength(first.p0x, first.p0y, first.p1x, first.p1y, first.p2x, first.p2y, first.p3x, first.p3y);
  const lastArc = approxArcLength(last.p0x, last.p0y, last.p1x, last.p1y, last.p2x, last.p2y, last.p3x, last.p3y);
  const h1Len = (depLen / (firstArc || 1)) * totalArc;
  const h2Len = (arrLen / (lastArc || 1)) * totalArc;

  const hcp1x = startX + t1x * h1Len;
  const hcp1y = startY + t1y * h1Len;
  const hcp2x = endX + t2x * h2Len;
  const hcp2y = endY + t2y * h2Len;

  const hErr = computeMaxErrorSq(chain, hcp1x, hcp1y, hcp2x, hcp2y, SAMPLES);
  if (hErr <= tolSq) return { cp1x: hcp1x, cp1y: hcp1y, cp2x: hcp2x, cp2y: hcp2y };

  return null;
}

/**
 * Simplify nearly-straight cubic curves to line segments.
 */
function simplifyStraightCurves(commands: PathCommand[], tolerance: number): PathCommand[] {
  const result: PathCommand[] = [];
  let curX = 0, curY = 0;

  for (const cmd of commands) {
    if (cmd.type === 'C' &&
        cmd.x1 !== undefined && cmd.y1 !== undefined &&
        cmd.x2 !== undefined && cmd.y2 !== undefined &&
        cmd.x !== undefined && cmd.y !== undefined) {
      const dx = cmd.x - curX;
      const dy = cmd.y - curY;
      const segLen = Math.sqrt(dx * dx + dy * dy);

      if (segLen < 0.001) {
        curX = cmd.x;
        curY = cmd.y;
        result.push({ ...cmd });
        continue;
      }

      const nx = -dy / segLen, ny = dx / segLen;
      const d1 = Math.abs((cmd.x1 - curX) * nx + (cmd.y1 - curY) * ny);
      const d2 = Math.abs((cmd.x2 - curX) * nx + (cmd.y2 - curY) * ny);

      if (d1 < tolerance && d2 < tolerance) {
        result.push({ type: 'L', x: cmd.x, y: cmd.y } as PathCommand);
      } else {
        result.push({ ...cmd });
      }
      curX = cmd.x;
      curY = cmd.y;
    } else {
      result.push({ ...cmd });
      if (cmd.x !== undefined && cmd.y !== undefined) {
        curX = cmd.x;
        curY = cmd.y;
      }
    }
  }
  return result;
}

/**
 * Remove collinear intermediate points on consecutive line segments.
 */
function simplifyCollinearLines(commands: PathCommand[], tolerance: number): PathCommand[] {
  const result: PathCommand[] = [];
  let i = 0;

  while (i < commands.length) {
    const cmd = commands[i];

    if (cmd.type !== 'L' || cmd.x === undefined || cmd.y === undefined) {
      result.push({ ...cmd });
      i++;
      continue;
    }

    let j = i + 1;
    while (j < commands.length && commands[j].type === 'L' &&
           commands[j].x !== undefined && commands[j].y !== undefined) {
      j++;
    }

    if (j === i + 1) {
      result.push({ ...cmd });
      i++;
      continue;
    }

    let startX = 0, startY = 0;
    for (let k = result.length - 1; k >= 0; k--) {
      if (result[k].x !== undefined && result[k].y !== undefined) {
        startX = result[k].x!;
        startY = result[k].y!;
        break;
      }
    }

    const pts: { x: number; y: number; idx: number }[] = [{ x: startX, y: startY, idx: -1 }];
    for (let k = i; k < j; k++) {
      pts.push({ x: commands[k].x!, y: commands[k].y!, idx: k });
    }

    const keep = new Set<number>();
    keep.add(j - 1);

    let anchor = 0;
    for (let k = 2; k < pts.length; k++) {
      const ax = pts[anchor].x, ay = pts[anchor].y;
      const bx = pts[k].x, by = pts[k].y;
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;
      const nx = -dy / len, ny = dx / len;

      let maxDist = 0;
      for (let m = anchor + 1; m < k; m++) {
        const d = Math.abs((pts[m].x - ax) * nx + (pts[m].y - ay) * ny);
        if (d > maxDist) maxDist = d;
      }

      if (maxDist > tolerance) {
        keep.add(pts[k - 1].idx);
        anchor = k - 1;
      }
    }

    for (let k = i; k < j; k++) {
      if (keep.has(k)) {
        result.push({ ...commands[k] });
      }
    }

    i = j;
  }

  return result;
}

/**
 * Compute actual per-contour extrema from the cubic curves' derivative roots,
 * not just on-curve point positions. Returns tighter bounding boxes.
 */
function computeContourExtrema(commands: PathCommand[]): Map<number, { xs: number[]; ys: number[] }> {
  const extrema = new Map<number, { xs: number[]; ys: number[] }>();
  let contourIdx = -1;
  let curX = 0, curY = 0;

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      contourIdx++;
      extrema.set(contourIdx, { xs: [], ys: [] });
      if (cmd.x !== undefined && cmd.y !== undefined) {
        extrema.get(contourIdx)!.xs.push(cmd.x);
        extrema.get(contourIdx)!.ys.push(cmd.y);
        curX = cmd.x; curY = cmd.y;
      }
      continue;
    }

    if (contourIdx < 0) continue;
    const ext = extrema.get(contourIdx)!;

    if (cmd.type === 'L' && cmd.x !== undefined && cmd.y !== undefined) {
      ext.xs.push(cmd.x);
      ext.ys.push(cmd.y);
      curX = cmd.x; curY = cmd.y;
    } else if (cmd.type === 'C' &&
               cmd.x1 !== undefined && cmd.y1 !== undefined &&
               cmd.x2 !== undefined && cmd.y2 !== undefined &&
               cmd.x !== undefined && cmd.y !== undefined) {
      ext.xs.push(cmd.x);
      ext.ys.push(cmd.y);

      // Find t values where derivative = 0 for x and y
      // Derivative of cubic: 3(1-t)^2(p1-p0) + 6(1-t)t(p2-p1) + 3t^2(p3-p2)
      // = at^2 + bt + c where a=3(-p0+3p1-3p2+p3), b=6(p0-2p1+p2), c=3(p1-p0)
      for (const [v0, v1, v2, v3] of [
        [curX, cmd.x1, cmd.x2, cmd.x],
        [curY, cmd.y1, cmd.y2, cmd.y],
      ]) {
        const a = 3 * (-v0 + 3 * v1 - 3 * v2 + v3);
        const b = 6 * (v0 - 2 * v1 + v2);
        const c = 3 * (v1 - v0);
        const disc = b * b - 4 * a * c;

        if (Math.abs(a) < 1e-10) {
          if (Math.abs(b) > 1e-10) {
            const t = -c / b;
            if (t > 0.01 && t < 0.99) {
              const isX = v0 === curX;
              const val = evalCubic(v0, v1, v2, v3, t);
              if (isX) ext.xs.push(val); else ext.ys.push(val);
            }
          }
        } else if (disc >= 0) {
          const sqrtDisc = Math.sqrt(disc);
          for (const t of [(-b + sqrtDisc) / (2 * a), (-b - sqrtDisc) / (2 * a)]) {
            if (t > 0.01 && t < 0.99) {
              const isX = v0 === curX;
              const val = evalCubic(v0, v1, v2, v3, t);
              if (isX) ext.xs.push(val); else ext.ys.push(val);
            }
          }
        }
      }
      curX = cmd.x; curY = cmd.y;
    } else if (cmd.x !== undefined && cmd.y !== undefined) {
      curX = cmd.x; curY = cmd.y;
    }
  }

  return extrema;
}

/**
 * Merge consecutive cubic curves that share smooth junctions.
 * Uses least-squares curve fitting for better results on long chains.
 */
export function mergeAdjacentCubics(
  commands: PathCommand[],
  tolerance: number,
  extremaTolerance: number,
  tangentThreshold: number,
): PathCommand[] {
  const result: PathCommand[] = [];
  let curX = 0, curY = 0;

  // Compute true contour extrema from curve derivatives
  const contourExtrema = computeContourExtrema(commands);

  // Build contour bounding boxes from the true extrema
  const contourBounds: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  let contourIdx = -1;
  const cmdContour: number[] = [];

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      contourIdx++;
      const ext = contourExtrema.get(contourIdx);
      if (ext && ext.xs.length > 0 && ext.ys.length > 0) {
        contourBounds.push({
          minX: Math.min(...ext.xs),
          minY: Math.min(...ext.ys),
          maxX: Math.max(...ext.xs),
          maxY: Math.max(...ext.ys),
        });
      } else {
        contourBounds.push({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      }
    }
    cmdContour.push(contourIdx);
  }

  const tolSq = tolerance * tolerance;
  let i = 0;

  while (i < commands.length) {
    const cmdA = commands[i];

    if (cmdA.type !== 'C' ||
        cmdA.x1 === undefined || cmdA.y1 === undefined ||
        cmdA.x2 === undefined || cmdA.y2 === undefined ||
        cmdA.x === undefined || cmdA.y === undefined) {
      result.push({ ...cmdA });
      if (cmdA.x !== undefined && cmdA.y !== undefined) {
        curX = cmdA.x;
        curY = cmdA.y;
      }
      i++;
      continue;
    }

    const chain: CurveSegment[] = [{
      p0x: curX, p0y: curY,
      p1x: cmdA.x1, p1y: cmdA.y1,
      p2x: cmdA.x2, p2y: cmdA.y2,
      p3x: cmdA.x, p3y: cmdA.y,
    }];

    let chainEnd = cmdA.x;
    let chainEndY = cmdA.y;
    let j = i + 1;
    let lastGoodMerge: { cp1x: number; cp1y: number; cp2x: number; cp2y: number } | null = null;
    let lastGoodJ = i + 1;

    while (j < commands.length) {
      const cmdB = commands[j];

      if (cmdB.type !== 'C' ||
          cmdB.x1 === undefined || cmdB.y1 === undefined ||
          cmdB.x2 === undefined || cmdB.y2 === undefined ||
          cmdB.x === undefined || cmdB.y === undefined) {
        break;
      }

      if (cmdContour[j] !== cmdContour[i]) break;

      const ci = cmdContour[j];
      const bounds = ci >= 0 && ci < contourBounds.length ? contourBounds[ci] : null;
      if (bounds && isExtremumPoint(
        chainEnd, chainEndY,
        bounds.minX, bounds.minY, bounds.maxX, bounds.maxY,
        extremaTolerance,
      )) {
        break;
      }

      const lastCurve = chain[chain.length - 1];
      const arriveX = lastCurve.p3x - lastCurve.p2x;
      const arriveY = lastCurve.p3y - lastCurve.p2y;
      const departX = cmdB.x1 - chainEnd;
      const departY = cmdB.y1 - chainEndY;

      if (!areTangentsSmooth(arriveX, arriveY, departX, departY, tangentThreshold)) {
        break;
      }

      const newSeg: CurveSegment = {
        p0x: chainEnd, p0y: chainEndY,
        p1x: cmdB.x1, p1y: cmdB.y1,
        p2x: cmdB.x2, p2y: cmdB.y2,
        p3x: cmdB.x, p3y: cmdB.y,
      };
      chain.push(newSeg);

      const merged = tryMergeChain(chain, tolSq);
      if (merged) {
        lastGoodMerge = merged;
        lastGoodJ = j + 1;
        chainEnd = cmdB.x;
        chainEndY = cmdB.y;
        j++;
      } else {
        chain.pop();
        break;
      }
    }

    if (lastGoodMerge && lastGoodJ > i + 1) {
      // Emit the merged curve
      const mergedChainEnd = chain[chain.length - 1];
      result.push({
        type: 'C',
        x1: lastGoodMerge.cp1x, y1: lastGoodMerge.cp1y,
        x2: lastGoodMerge.cp2x, y2: lastGoodMerge.cp2y,
        x: mergedChainEnd.p3x,
        y: mergedChainEnd.p3y,
      } as PathCommand);
      curX = mergedChainEnd.p3x;
      curY = mergedChainEnd.p3y;
      i = lastGoodJ;
    } else {
      // No merge possible, emit original
      result.push({
        type: 'C',
        x1: cmdA.x1, y1: cmdA.y1,
        x2: cmdA.x2, y2: cmdA.y2,
        x: cmdA.x, y: cmdA.y,
      } as PathCommand);
      curX = cmdA.x;
      curY = cmdA.y;
      i++;
    }
  }

  return result;
}

/**
 * Optimize path commands for cleaner, more editable outlines.
 * 1. Convert all quadratic beziers to cubics (lossless)
 * 2. Simplify near-straight curves to lines
 * 3. Merge adjacent cubics with smooth junctions (least-squares, multi-pass)
 * 4. Remove collinear intermediate line points
 */
export function optimizeOutlines(
  commands: PathCommand[],
  unitsPerEm: number,
): PathCommand[] {
  if (commands.length === 0) return commands;

  let hasQ = false;
  let hasC = false;
  for (const cmd of commands) {
    if (cmd.type === 'Q') hasQ = true;
    if (cmd.type === 'C') hasC = true;
  }

  if (!hasQ && !hasC) return commands;

  // Stage 1: Q -> C conversion (lossless)
  let result = hasQ ? quadraticToCubic(commands) : commands.map(c => ({ ...c }));

  // Tolerances scaled to the font's unit space (for 1000 UPM: 2, 2, 1.5, 0.5)
  const curveTolerance = Math.max(2.0, unitsPerEm * 0.002);
  const straightTolerance = Math.max(2.0, unitsPerEm * 0.002);
  const extremaTolerance = Math.max(1.5, unitsPerEm * 0.0015);
  const lineTolerance = Math.max(0.5, unitsPerEm * 0.0005);
  const tangentThreshold = 0.80;

  // Stage 2: Convert near-straight cubics to lines
  result = simplifyStraightCurves(result, straightTolerance);

  // Stage 3: Multi-pass curve merging
  const MAX_PASSES = 5;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = result.length;
    result = mergeAdjacentCubics(result, curveTolerance, extremaTolerance, tangentThreshold);
    if (result.length >= before) break;
  }

  // Stage 4: Remove collinear intermediate line points
  result = simplifyCollinearLines(result, lineTolerance);

  return result;
}
