import type { Font, PathCommand } from 'opentype.js';
import { Font as FEFont, type FontEditor, type TTF } from 'fonteditor-core';
import type { ComponentDef, ComponentInstance, GlyphComponents } from '../types';

export interface ExportOptions {
  familyName: string;
  styleName: string;
  version: string;
  copyright: string;
  designer: string;
  description: string;
  license: string;
  format: 'ttf' | 'woff';
  hinting: boolean;
}

function safeUnicode(u: unknown): number[] {
  if (Array.isArray(u)) return u;
  if (typeof u === 'number') return [u];
  return [];
}

function detectFontType(buffer: ArrayBuffer): FontEditor.FontType {
  const view = new DataView(buffer);
  const sig = view.getUint32(0);
  if (sig === 0x00010000 || sig === 0x74727565) return 'ttf';
  if (sig === 0x4F54544F) return 'otf';
  if (sig === 0x774F4646) return 'woff';
  if (sig === 0x774F4632) return 'woff2';
  return 'ttf';
}

/**
 * Convert a cubic bezier (p0, cp1, cp2, p3) to one or more quadratic bezier
 * segments. Uses adaptive subdivision: if the single-quadratic approximation
 * error exceeds `tolerance`, the cubic is split at t=0.5 and each half is
 * converted recursively.
 */
function cubicToQuadratic(
  p0x: number, p0y: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  p3x: number, p3y: number,
  tolerance: number,
  depth: number,
): TTF.Point[] {
  const qx = (3 * cp1x - p0x + 3 * cp2x - p3x) / 4;
  const qy = (3 * cp1y - p0y + 3 * cp2y - p3y) / 4;

  // Measure error at t=0.5 between original cubic and the quadratic approximation
  const ct = 0.5;
  const cs = 0.5;
  const cubicMidX = cs * cs * cs * p0x + 3 * cs * cs * ct * cp1x + 3 * cs * ct * ct * cp2x + ct * ct * ct * p3x;
  const cubicMidY = cs * cs * cs * p0y + 3 * cs * cs * ct * cp1y + 3 * cs * ct * ct * cp2y + ct * ct * ct * p3y;
  const quadMidX = 0.25 * p0x + 0.5 * qx + 0.25 * p3x;
  const quadMidY = 0.25 * p0y + 0.5 * qy + 0.25 * p3y;

  const errSq = (cubicMidX - quadMidX) ** 2 + (cubicMidY - quadMidY) ** 2;

  if (errSq <= tolerance * tolerance || depth >= 8) {
    return [
      { x: Math.round(qx), y: Math.round(qy), onCurve: false },
      { x: Math.round(p3x), y: Math.round(p3y), onCurve: true },
    ];
  }

  // De Casteljau split at t=0.5
  const m01x = (p0x + cp1x) / 2, m01y = (p0y + cp1y) / 2;
  const m12x = (cp1x + cp2x) / 2, m12y = (cp1y + cp2y) / 2;
  const m23x = (cp2x + p3x) / 2, m23y = (cp2y + p3y) / 2;
  const m012x = (m01x + m12x) / 2, m012y = (m01y + m12y) / 2;
  const m123x = (m12x + m23x) / 2, m123y = (m12y + m23y) / 2;
  const mx = (m012x + m123x) / 2, my = (m012y + m123y) / 2;

  const left = cubicToQuadratic(p0x, p0y, m01x, m01y, m012x, m012y, mx, my, tolerance, depth + 1);
  const right = cubicToQuadratic(mx, my, m123x, m123y, m23x, m23y, p3x, p3y, tolerance, depth + 1);
  return [...left, ...right];
}

/**
 * Convert opentype.js PathCommand[] to fonteditor-core contour format.
 */
function commandsToContours(commands: PathCommand[]): TTF.Contour[] {
  const contours: TTF.Contour[] = [];
  let current: TTF.Point[] = [];
  let cx = 0, cy = 0;

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      if (current.length > 0) contours.push(current);
      current = [{ x: Math.round(cmd.x!), y: Math.round(cmd.y!), onCurve: true }];
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'L') {
      current.push({ x: Math.round(cmd.x!), y: Math.round(cmd.y!), onCurve: true });
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'Q') {
      current.push(
        { x: Math.round(cmd.x1!), y: Math.round(cmd.y1!), onCurve: false },
        { x: Math.round(cmd.x!), y: Math.round(cmd.y!), onCurve: true },
      );
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'C') {
      const pts = cubicToQuadratic(cx, cy, cmd.x1!, cmd.y1!, cmd.x2!, cmd.y2!, cmd.x!, cmd.y!, 1.0, 0);
      current.push(...pts);
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === 'Z') {
      if (current.length > 0) {
        contours.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) contours.push(current);
  return contours;
}

/**
 * Build a binary kern table (format 0) from opentype.js kerningPairs.
 * Format: https://developer.apple.com/fonts/TrueType-Reference-Manual/RM06/Chap6kern.html
 */
function buildKernTable(kerningPairs: Record<string, number>): number[] {
  const pairs: { left: number; right: number; value: number }[] = [];
  for (const key of Object.keys(kerningPairs)) {
    const val = kerningPairs[key];
    if (val === 0) continue;
    const parts = key.split(',');
    if (parts.length !== 2) continue;
    const left = parseInt(parts[0]);
    const right = parseInt(parts[1]);
    if (isNaN(left) || isNaN(right)) continue;
    pairs.push({ left, right, value: val });
  }
  if (pairs.length === 0) return [];

  pairs.sort((a, b) => a.left !== b.left ? a.left - b.left : a.right - b.right);

  const nPairs = pairs.length;
  const entrySelector = Math.floor(Math.log2(nPairs));
  const searchRange = Math.pow(2, entrySelector) * 6;
  const rangeShift = nPairs * 6 - searchRange;
  const subtableLength = 14 + nPairs * 6;

  const buf = new ArrayBuffer(4 + subtableLength);
  const view = new DataView(buf);
  let off = 0;

  // Kern table header
  view.setUint16(off, 0); off += 2;       // version
  view.setUint16(off, 1); off += 2;       // nTables

  // Subtable header
  view.setUint16(off, 0); off += 2;       // subtable version
  view.setUint16(off, subtableLength); off += 2; // length
  view.setUint16(off, 0x0001); off += 2;  // coverage: horizontal, format 0

  // Format 0 header
  view.setUint16(off, nPairs); off += 2;
  view.setUint16(off, searchRange); off += 2;
  view.setUint16(off, entrySelector); off += 2;
  view.setUint16(off, rangeShift); off += 2;

  for (const p of pairs) {
    view.setUint16(off, p.left); off += 2;
    view.setUint16(off, p.right); off += 2;
    view.setInt16(off, Math.max(-32768, Math.min(32767, p.value))); off += 2;
  }

  return Array.from(new Uint8Array(buf));
}

function computeBounds(contours: TTF.Contour[]): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.x > xMax) xMax = p.x;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (!isFinite(xMin)) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  return { xMin, yMin, xMax, yMax };
}

/**
 * Build a fresh fonteditor-core TTFObject from the opentype.js Font.
 * Used when there's no original buffer (e.g. font created from scratch).
 */
function buildFreshTTFObject(otFont: Font): TTF.TTFObject {
  const glyphs: TTF.Glyph[] = [];
  for (let i = 0; i < otFont.glyphs.length; i++) {
    const g = otFont.glyphs.get(i);
    const contours = commandsToContours(g.path.commands);
    const bounds = computeBounds(contours);
    glyphs.push({
      contours,
      ...bounds,
      advanceWidth: g.advanceWidth ?? otFont.unitsPerEm,
      leftSideBearing: bounds.xMin,
      name: g.name || `.glyph${i}`,
      unicode: (g.unicode !== undefined && g.unicode > 0) ? [g.unicode] : [],
    });
  }

  const ttfObj: TTF.TTFObject = {
    version: 1,
    numTables: 0,
    searchRange: 0,
    entrySelector: 0,
    rangeShift: 0,
    head: {
      version: 1,
      fontRevision: 1,
      checkSumAdjustment: 0,
      magickNumber: 0x5F0F3CF5,
      flags: 11,
      unitsPerEm: otFont.unitsPerEm,
      unitsPerE: otFont.unitsPerEm,
      created: 0,
      modified: 0,
      xMin: 0,
      yMin: 0,
      xMax: 0,
      yMax: 0,
      macStyle: 0,
      lowestRecPPEM: 8,
      fontDirectionHint: 2,
      indexToLocFormat: 0,
      glyphDataFormat: 0,
    },
    glyf: glyphs,
    cmap: {},
    name: {
      fontFamily: otFont.names.fontFamily?.en || 'Untitled',
      fontSubFamily: otFont.names.fontSubfamily?.en || 'Regular',
      uniqueSubFamily: '',
      version: otFont.names.version?.en || 'Version 1.0',
    },
    hhea: {
      version: 1,
      ascent: otFont.ascender,
      descent: otFont.descender,
      lineGap: 0,
      advanceWidthMax: 0,
      minLeftSideBearing: 0,
      minRightSideBearing: 0,
      xMaxExtent: 0,
      caretSlopeRise: 1,
      caretSlopeRun: 0,
      caretOffset: 0,
      reserved0: 0,
      reserved1: 0,
      reserved2: 0,
      reserved3: 0,
      metricDataFormat: 0,
      numOfLongHorMetrics: glyphs.length,
    },
    post: {
      italicAngle: 0,
      postoints: 0,
      underlinePosition: -100,
      underlineThickness: 50,
      isFixedPitch: 0,
      minMemType42: 0,
      maxMemType42: 0,
      minMemType1: 0,
      maxMemType1: 0,
      format: 2,
    },
    maxp: {
      version: 1,
      numGlyphs: glyphs.length,
      maxPoints: 0,
      maxContours: 0,
      maxCompositePoints: 0,
      maxCompositeContours: 0,
      maxZones: 2,
      maxTwilightPoints: 0,
      maxStorage: 0,
      maxFunctionDefs: 0,
      maxStackElements: 0,
      maxSizeOfInstructions: 0,
      maxComponentElements: 0,
      maxComponentDepth: 0,
    },
    'OS/2': {
      version: 4,
      xAvgCharWidth: 0,
      usWeightClass: 400,
      usWidthClass: 5,
      fsType: 0,
      ySubscriptXSize: Math.round(otFont.unitsPerEm * 0.65),
      ySubscriptYSize: Math.round(otFont.unitsPerEm * 0.6),
      ySubscriptXOffset: 0,
      ySubscriptYOffset: Math.round(otFont.unitsPerEm * 0.075),
      ySuperscriptXSize: Math.round(otFont.unitsPerEm * 0.65),
      ySuperscriptYSize: Math.round(otFont.unitsPerEm * 0.6),
      ySuperscriptXOffset: 0,
      ySuperscriptYOffset: Math.round(otFont.unitsPerEm * 0.35),
      yStrikeoutSize: 50,
      yStrikeoutPosition: Math.round(otFont.unitsPerEm * 0.3),
      sFamilyClass: 0,
      bFamilyType: 0,
      bSerifStyle: 0,
      bWeight: 0,
      bProportion: 0,
      bContrast: 0,
      bStrokeVariation: 0,
      bArmStyle: 0,
      bLetterform: 0,
      bMidline: 0,
      bXHeight: 0,
      ulUnicodeRange1: 0,
      ulUnicodeRange2: 0,
      ulUnicodeRange3: 0,
      ulUnicodeRange4: 0,
      achVendID: '',
      fsSelection: 0x0040,
      usFirstCharIndex: 0x20,
      usLastCharIndex: 0xFFFF,
      sTypoAscender: otFont.ascender,
      sTypoDescender: otFont.descender,
      sTypoLineGap: 0,
      usWinAscent: otFont.ascender,
      usWinDescent: Math.abs(otFont.descender),
      ulCodePageRange1: 0,
      ulCodePageRange2: 0,
      sxHeight: Math.round(otFont.unitsPerEm * 0.5),
      sCapHeight: Math.round(otFont.unitsPerEm * 0.7),
      usDefaultChar: 0,
      usBreakChar: 0x20,
      usMaxContext: 0,
    },
  };

  // Build cmap from glyph unicodes
  for (let i = 0; i < glyphs.length; i++) {
    for (const u of glyphs[i].unicode) {
      if (u > 0) ttfObj.cmap[u] = i;
    }
  }

  return ttfObj;
}

function resolveComponentInstances(
  instances: ComponentInstance[],
  library: ComponentDef[],
): PathCommand[] {
  const result: PathCommand[] = [];
  for (const inst of instances) {
    const def = library.find(c => c.id === inst.componentId);
    if (!def) continue;
    const rad = (inst.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    for (const cmd of def.commands) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = { ...cmd };
      const xform = (x: number, y: number) => ({
        x: Math.round(x * inst.scaleX * cos - y * inst.scaleY * sin + inst.offsetX),
        y: Math.round(x * inst.scaleX * sin + y * inst.scaleY * cos + inst.offsetY),
      });
      if (c.x !== undefined && c.y !== undefined) {
        const p = xform(c.x, c.y);
        c.x = p.x; c.y = p.y;
      }
      if (c.x1 !== undefined) {
        const p = xform(c.x1, c.y1);
        c.x1 = p.x;
        c.y1 = p.y;
      }
      if (c.x2 !== undefined) {
        const p = xform(c.x2, c.y2);
        c.x2 = p.x;
        c.y2 = p.y;
      }
      result.push(c as PathCommand);
    }
  }
  return result;
}

export async function exportFont(
  otFont: Font,
  originalBuffer: ArrayBuffer | null,
  modifiedGlyphs: Set<number>,
  options: ExportOptions,
  glyphComponents?: GlyphComponents,
  componentLibrary?: ComponentDef[],
): Promise<ArrayBuffer> {
  let feFont: InstanceType<typeof FEFont>;

  if (originalBuffer && originalBuffer.byteLength > 0) {
    const inputType = detectFontType(originalBuffer);
    feFont = FEFont.create(originalBuffer, {
      type: inputType,
      hinting: options.hinting,
      kerning: true,
      compound2simple: true,
    });

    const ttfObj = feFont.get();

    // Decompose component instances into glyph paths before export
    if (glyphComponents && componentLibrary) {
      for (const [idxStr, instances] of Object.entries(glyphComponents)) {
        const idx = Number(idxStr);
        if (idx >= otFont.glyphs.length) continue;
        const resolved = resolveComponentInstances(instances, componentLibrary);
        if (resolved.length > 0) {
          const otGlyph = otFont.glyphs.get(idx);
          const existingCmds = [...otGlyph.path.commands];
          otGlyph.path.commands = [...existingCmds, ...resolved];
          modifiedGlyphs.add(idx);
        }
      }
    }

    // Apply only modified glyphs
    for (const idx of modifiedGlyphs) {
      if (idx >= otFont.glyphs.length) continue;
      const otGlyph = otFont.glyphs.get(idx);
      const contours = commandsToContours(otGlyph.path.commands);
      const bounds = computeBounds(contours);

      const feGlyph: TTF.Glyph = {
        contours,
        ...bounds,
        advanceWidth: otGlyph.advanceWidth ?? otFont.unitsPerEm,
        leftSideBearing: bounds.xMin,
        name: otGlyph.name || `.glyph${idx}`,
        unicode: (otGlyph.unicode !== undefined && otGlyph.unicode > 0) ? [otGlyph.unicode] : [],
      };

      if (idx < ttfObj.glyf.length) {
        // Preserve unicode from original if our glyph doesn't have one
        const origUnicode = safeUnicode(ttfObj.glyf[idx].unicode);
        if (feGlyph.unicode.length === 0 && origUnicode.length > 0) {
          feGlyph.unicode = origUnicode;
        }
        ttfObj.glyf[idx] = feGlyph;
      }
    }

    // Handle glyphs that were added beyond the original count
    for (let i = ttfObj.glyf.length; i < otFont.glyphs.length; i++) {
      const otGlyph = otFont.glyphs.get(i);
      const contours = commandsToContours(otGlyph.path.commands);
      const bounds = computeBounds(contours);
      ttfObj.glyf.push({
        contours,
        ...bounds,
        advanceWidth: otGlyph.advanceWidth ?? otFont.unitsPerEm,
        leftSideBearing: bounds.xMin,
        name: otGlyph.name || `.glyph${i}`,
        unicode: (otGlyph.unicode !== undefined && otGlyph.unicode > 0) ? [otGlyph.unicode] : [],
      });
    }

    // Rebuild cmap for any new/changed unicodes
    ttfObj.cmap = {};
    for (let i = 0; i < ttfObj.glyf.length; i++) {
      for (const u of safeUnicode(ttfObj.glyf[i].unicode)) {
        if (u > 0) ttfObj.cmap[u] = i;
      }
    }

    // Replace all metadata with user-provided values
    const postScript = options.familyName.replace(/\s+/g, '') + '-' + options.styleName.replace(/\s+/g, '');
    ttfObj.name = {
      fontFamily: options.familyName,
      fontSubFamily: options.styleName,
      uniqueSubFamily: `${options.familyName} ${options.styleName}`,
      version: options.version,
      postScriptName: postScript,
      fullName: `${options.familyName} ${options.styleName}`,
      copyright: options.copyright,
      designer: options.designer,
      description: options.description,
      licence: options.license,
    };

    // Build kern table from user's kerning pairs
    if (otFont.kerningPairs && Object.keys(otFont.kerningPairs).length > 0) {
      const kernBytes = buildKernTable(otFont.kerningPairs);
      if (kernBytes.length > 0) {
        (ttfObj as Record<string, unknown>).kern = kernBytes;
        // Remove GPOS to prevent it from overriding our kern pairs in renderers
        // that prefer GPOS kerning over the kern table
        delete (ttfObj as Record<string, unknown>).GPOS;
      }
    }

    feFont.set(ttfObj);
  } else {
    // Decompose component instances before building from scratch
    if (glyphComponents && componentLibrary) {
      for (const [idxStr, instances] of Object.entries(glyphComponents)) {
        const idx = Number(idxStr);
        if (idx >= otFont.glyphs.length) continue;
        const resolved = resolveComponentInstances(instances, componentLibrary);
        if (resolved.length > 0) {
          const otGlyph = otFont.glyphs.get(idx);
          otGlyph.path.commands = [...otGlyph.path.commands, ...resolved];
        }
      }
    }
    const ttfObj = buildFreshTTFObject(otFont);
    const postScript = options.familyName.replace(/\s+/g, '') + '-' + options.styleName.replace(/\s+/g, '');
    ttfObj.name = {
      fontFamily: options.familyName,
      fontSubFamily: options.styleName,
      uniqueSubFamily: `${options.familyName} ${options.styleName}`,
      version: options.version,
      postScriptName: postScript,
      fullName: `${options.familyName} ${options.styleName}`,
      copyright: options.copyright,
      designer: options.designer,
      description: options.description,
      licence: options.license,
    };

    // Build kern table from user's kerning pairs
    if (otFont.kerningPairs && Object.keys(otFont.kerningPairs).length > 0) {
      const kernBytes = buildKernTable(otFont.kerningPairs);
      if (kernBytes.length > 0) {
        (ttfObj as Record<string, unknown>).kern = kernBytes;
      }
    }

    feFont = FEFont.create();
    feFont.set(ttfObj);
  }

  const outputType = options.format;
  const result = feFont.write({
    type: outputType,
    hinting: options.hinting,
    kerning: true,
    writeZeroContoursGlyfData: true,
    toBuffer: false,
  });

  if (result instanceof ArrayBuffer) return result;
  if (typeof result === 'string') {
    const enc = new TextEncoder();
    return enc.encode(result).buffer as ArrayBuffer;
  }
  // Buffer (Node) → ArrayBuffer
  const buf = result as Buffer;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
