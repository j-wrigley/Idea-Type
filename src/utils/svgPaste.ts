import type { PathCommand } from 'opentype.js';
import svgpath from 'svgpath';

const KAPPA = 0.5522847498;

/**
 * Try to extract SVG content from clipboard data (HTML or plain text).
 * Returns the parsed SVG Document element or null.
 */
function extractSvgDocument(html: string, text: string): Document | null {
  const parser = new DOMParser();

  // Try HTML clipboard first — Figma/Illustrator put SVG inside HTML
  if (html) {
    const doc = parser.parseFromString(html, 'text/html');
    const svg = doc.querySelector('svg');
    if (svg) {
      const svgStr = new XMLSerializer().serializeToString(svg);
      return parser.parseFromString(svgStr, 'image/svg+xml');
    }
  }

  // Fall back to plain text — might be raw SVG markup
  if (text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')) {
      const doc = parser.parseFromString(trimmed, 'image/svg+xml');
      if (!doc.querySelector('parsererror')) return doc;
    }
    // Also try wrapping in <svg> — some apps copy just the inner SVG elements
    if (trimmed.startsWith('<path') || trimmed.startsWith('<g') || trimmed.startsWith('<rect') || trimmed.startsWith('<circle') || trimmed.startsWith('<ellipse')) {
      const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>`;
      const doc = parser.parseFromString(wrapped, 'image/svg+xml');
      if (!doc.querySelector('parsererror')) return doc;
    }
  }

  return null;
}

/**
 * Collect the accumulated `transform` attribute string from an element
 * up through its ancestors (stopping at the <svg> root).
 */
function getAccumulatedTransform(el: Element): string {
  const transforms: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== 'svg') {
    const t = cur.getAttribute('transform');
    if (t) transforms.unshift(t);
    cur = cur.parentElement;
  }
  return transforms.join(' ');
}

/**
 * Convert an SVG <rect> element to an SVG path `d` string.
 */
function rectToPathD(el: Element): string {
  const x = parseFloat(el.getAttribute('x') || '0');
  const y = parseFloat(el.getAttribute('y') || '0');
  const w = parseFloat(el.getAttribute('width') || '0');
  const h = parseFloat(el.getAttribute('height') || '0');
  const rx = Math.min(parseFloat(el.getAttribute('rx') || '0'), w / 2);
  const ry = Math.min(parseFloat(el.getAttribute('ry') || rx.toString()), h / 2);

  if (rx > 0 || ry > 0) {
    return `M${x + rx},${y} L${x + w - rx},${y} `
      + `A${rx},${ry} 0 0 1 ${x + w},${y + ry} `
      + `L${x + w},${y + h - ry} `
      + `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} `
      + `L${x + rx},${y + h} `
      + `A${rx},${ry} 0 0 1 ${x},${y + h - ry} `
      + `L${x},${y + ry} `
      + `A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
  }
  return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
}

/**
 * Convert an SVG <circle> or <ellipse> to an SVG path `d` string.
 */
function ellipseToPathD(el: Element): string {
  let cx: number, cy: number, rx: number, ry: number;
  if (el.tagName === 'circle') {
    cx = parseFloat(el.getAttribute('cx') || '0');
    cy = parseFloat(el.getAttribute('cy') || '0');
    rx = ry = parseFloat(el.getAttribute('r') || '0');
  } else {
    cx = parseFloat(el.getAttribute('cx') || '0');
    cy = parseFloat(el.getAttribute('cy') || '0');
    rx = parseFloat(el.getAttribute('rx') || '0');
    ry = parseFloat(el.getAttribute('ry') || '0');
  }
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return `M${cx},${cy - ry} `
    + `C${cx + kx},${cy - ry} ${cx + rx},${cy - ky} ${cx + rx},${cy} `
    + `C${cx + rx},${cy + ky} ${cx + kx},${cy + ry} ${cx},${cy + ry} `
    + `C${cx - kx},${cy + ry} ${cx - rx},${cy + ky} ${cx - rx},${cy} `
    + `C${cx - rx},${cy - ky} ${cx - kx},${cy - ry} ${cx},${cy - ry} Z`;
}

/**
 * Convert <polygon> or <polyline> to an SVG path `d` string.
 */
function polygonToPathD(el: Element): string {
  const points = (el.getAttribute('points') || '').trim();
  if (!points) return '';
  const pairs = points.split(/[\s,]+/);
  const coords: string[] = [];
  for (let i = 0; i < pairs.length - 1; i += 2) {
    coords.push(`${pairs[i]},${pairs[i + 1]}`);
  }
  if (coords.length === 0) return '';
  const d = `M${coords[0]} ` + coords.slice(1).map(c => `L${c}`).join(' ');
  return el.tagName === 'polygon' ? d + ' Z' : d;
}

/**
 * Convert <line> to an SVG path `d` string.
 */
function lineToPathD(el: Element): string {
  const x1 = el.getAttribute('x1') || '0';
  const y1 = el.getAttribute('y1') || '0';
  const x2 = el.getAttribute('x2') || '0';
  const y2 = el.getAttribute('y2') || '0';
  return `M${x1},${y1} L${x2},${y2}`;
}

interface ShapeElement {
  d: string;
  transform: string;
}

/**
 * Walk the SVG DOM and collect all shape elements as path `d` strings
 * with their accumulated transforms.
 */
function collectShapes(doc: Document): ShapeElement[] {
  const shapes: ShapeElement[] = [];
  const svgEl = doc.documentElement;

  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    let d: string | null = null;

    switch (tag) {
      case 'path':
        d = el.getAttribute('d');
        break;
      case 'rect':
        d = rectToPathD(el);
        break;
      case 'circle':
      case 'ellipse':
        d = ellipseToPathD(el);
        break;
      case 'polygon':
      case 'polyline':
        d = polygonToPathD(el);
        break;
      case 'line':
        d = lineToPathD(el);
        break;
    }

    if (d && d.trim()) {
      shapes.push({ d, transform: getAccumulatedTransform(el) });
    }

    for (let i = 0; i < el.children.length; i++) {
      walk(el.children[i]);
    }
  };

  walk(svgEl);
  return shapes;
}

/**
 * Normalize an SVG path `d` string with an optional transform,
 * returning PathCommand[]. Uses svgpath to handle relative commands,
 * arcs, and shorthand curves.
 */
function normalizePathD(d: string, transformStr: string): PathCommand[] {
  let sp = svgpath(d).abs().unarc().unshort();
  if (transformStr) {
    sp = sp.transform(transformStr).abs();
  }

  const commands: PathCommand[] = [];
  // Track current position for H/V → L conversion
  let curX = 0, curY = 0;

  sp.iterate(function (seg, _index, _x, _y) {
    const cmd = seg[0];
    switch (cmd) {
      case 'M':
        curX = seg[1]; curY = seg[2];
        commands.push({ type: 'M', x: seg[1], y: seg[2] });
        break;
      case 'L':
        curX = seg[1]; curY = seg[2];
        commands.push({ type: 'L', x: seg[1], y: seg[2] });
        break;
      case 'H':
        curX = seg[1];
        commands.push({ type: 'L', x: curX, y: curY });
        break;
      case 'V':
        curY = seg[1];
        commands.push({ type: 'L', x: curX, y: curY });
        break;
      case 'Q':
        curX = seg[3]; curY = seg[4];
        commands.push({ type: 'Q', x1: seg[1], y1: seg[2], x: seg[3], y: seg[4] });
        break;
      case 'C':
        curX = seg[5]; curY = seg[6];
        commands.push({ type: 'C', x1: seg[1], y1: seg[2], x2: seg[3], y2: seg[4], x: seg[5], y: seg[6] });
        break;
      case 'Z':
      case 'z':
        commands.push({ type: 'Z' });
        break;
    }
  });

  return commands;
}

/**
 * Parse SVG content from clipboard data and return PathCommand[].
 * Returns null if no SVG content is found.
 */
export function parseSvgFromClipboard(html: string, text: string): PathCommand[] | null {
  const doc = extractSvgDocument(html, text);
  if (doc) {
    const shapes = collectShapes(doc);
    if (shapes.length > 0) {
      const allCommands: PathCommand[] = [];
      for (const shape of shapes) {
        const cmds = normalizePathD(shape.d, shape.transform);
        allCommands.push(...cmds);
      }
      if (allCommands.length > 0) return allCommands;
    }
  }

  // Last resort: try parsing plain text as a raw SVG path d-string
  if (text) {
    const trimmed = text.trim();
    if (/^[Mm]\s*[\d.-]/.test(trimmed)) {
      try {
        const cmds = normalizePathD(trimmed, '');
        if (cmds.length > 0) return cmds;
      } catch { /* not valid path data */ }
    }
  }

  return null;
}

/**
 * Transform pasted SVG commands into glyph coordinate space:
 * - Flip Y axis (SVG Y-down → glyph Y-up)
 * - Scale to fit within the ascender height
 * - Position at x=0
 */
export function fitToGlyphSpace(
  commands: PathCommand[],
  upm: number,
  ascender: number,
): PathCommand[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of commands) {
    if (c.x !== undefined && c.y !== undefined) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    if (c.x1 !== undefined && c.y1 !== undefined) {
      if (c.x1 < minX) minX = c.x1;
      if (c.y1 < minY) minY = c.y1;
      if (c.x1 > maxX) maxX = c.x1;
      if (c.y1 > maxY) maxY = c.y1;
    }
    if (c.x2 !== undefined && c.y2 !== undefined) {
      if (c.x2 < minX) minX = c.x2;
      if (c.y2 < minY) minY = c.y2;
      if (c.x2 > maxX) maxX = c.x2;
      if (c.y2 > maxY) maxY = c.y2;
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) return commands;

  const svgW = maxX - minX || 1;
  const svgH = maxY - minY || 1;

  // Scale to fit within ascender height, preserving aspect ratio
  const targetH = ascender > 0 ? ascender : upm * 0.8;
  const scale = targetH / svgH;
  const scaledW = svgW * scale;

  return commands.map(c => {
    const out: PathCommand = { type: c.type };

    const transformX = (x: number) => Math.round((x - minX) * scale);
    // Flip Y: SVG y=minY maps to glyph y=ascender, y=maxY maps to y=0
    const transformY = (y: number) => Math.round(targetH - (y - minY) * scale);

    if (c.x !== undefined && c.y !== undefined) {
      out.x = transformX(c.x);
      out.y = transformY(c.y);
    }
    if (c.x1 !== undefined && c.y1 !== undefined) {
      out.x1 = transformX(c.x1);
      out.y1 = transformY(c.y1);
    }
    if (c.x2 !== undefined && c.y2 !== undefined) {
      out.x2 = transformX(c.x2);
      out.y2 = transformY(c.y2);
    }

    return out;
  });
}

/**
 * Convert PathCommands (glyph coordinates, Y-up) to an SVG string.
 * Flips Y so the result is a standard SVG (Y-down).
 */
/**
 * Convert PathCommands (glyph coordinates, Y-up) to an SVG string.
 * Flips Y so the result is a standard SVG (Y-down).
 * If `fvePayload` is provided, it's embedded as a `data-fve` attribute
 * on the root <svg> element for lossless cross-window paste.
 */
export function commandsToSvg(
  commands: PathCommand[],
  ascender: number,
  fvePayload?: string,
): string {
  if (commands.length === 0) return '';

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of commands) {
    for (const [x, y] of [[c.x, c.y], [c.x1, c.y1], [c.x2, c.y2]]) {
      if (x !== undefined && y !== undefined) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        const flipped = ascender - y;
        if (flipped < minY) minY = flipped;
        if (flipped > maxY) maxY = flipped;
      }
    }
  }

  const flipY = (y: number) => ascender - y;

  const parts: string[] = [];
  for (const c of commands) {
    switch (c.type) {
      case 'M': parts.push(`M${c.x} ${flipY(c.y!)}`); break;
      case 'L': parts.push(`L${c.x} ${flipY(c.y!)}`); break;
      case 'Q': parts.push(`Q${c.x1} ${flipY(c.y1!)},${c.x} ${flipY(c.y!)}`); break;
      case 'C': parts.push(`C${c.x1} ${flipY(c.y1!)},${c.x2} ${flipY(c.y2!)},${c.x} ${flipY(c.y!)}`); break;
      case 'Z': parts.push('Z'); break;
    }
  }

  const d = parts.join(' ');
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;

  const dataAttr = fvePayload
    ? ` data-fve="${fvePayload.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}"${dataAttr}><path d="${d}" fill="black"/></svg>`;
}

/**
 * Try to extract embedded FVE commands from an SVG string
 * that was written by our copy handler.
 */
export function extractFvePayload(svgText: string): { type: string; commands: PathCommand[] } | null {
  const match = svgText.match(/data-fve="([^"]*)"/);
  if (!match) return null;
  try {
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
