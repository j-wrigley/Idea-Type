declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface PathConstructor {
    new (): Path;
  }

  export class Path {
    constructor();
    commands: PathCommand[];
    fill: string | null;
    stroke: string | null;
    strokeWidth: number;
    unitsPerEm: number;
    draw(ctx: CanvasRenderingContext2D): void;
    toPathData(decimalPlaces?: number): string;
    toSVG(decimalPlaces?: number): string;
  }

  export interface GlyphOptions {
    name?: string;
    unicode?: number;
    unicodes?: number[];
    advanceWidth?: number;
    leftSideBearing?: number;
    path?: Path;
  }

  export class Glyph {
    constructor(options: GlyphOptions);
    index: number;
    name: string | null;
    unicode: number | undefined;
    unicodes: number[];
    advanceWidth: number | undefined;
    leftSideBearing: number | undefined;
    path: Path;
    getPath(x?: number, y?: number, fontSize?: number): Path;
    draw(ctx: CanvasRenderingContext2D, x?: number, y?: number, fontSize?: number): void;
    getBoundingBox(): BoundingBox;
  }

  export interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  export class GlyphSet {
    constructor(font: Font, glyphs: Glyph[]);
    length: number;
    get(index: number): Glyph;
    push(index: number, loader: object): void;
  }

  export interface FontOptions {
    familyName: string;
    styleName: string;
    unitsPerEm?: number;
    ascender?: number;
    descender?: number;
    glyphs?: Glyph[];
  }

  export class Font {
    constructor(options: FontOptions);
    names: Record<string, Record<string, string>>;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: GlyphSet;
    encoding: unknown;
    tables: Record<string, unknown>;
    kerningPairs: Record<string, number>;
    getKerningValue(leftGlyph: Glyph | number, rightGlyph: Glyph | number): number;
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean }): Path;
    draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number): void;
    toArrayBuffer(): ArrayBuffer;
    download(fileName?: string): void;
    charToGlyph(char: string): Glyph;
    stringToGlyphs(str: string): Glyph[];
  }

  export function parse(buffer: ArrayBuffer | Buffer): Font;
  export function load(url: string, callback?: (err: Error | null, font?: Font) => void): Promise<Font>;

  const opentype: {
    parse: typeof parse;
    load: typeof load;
    Font: typeof Font;
    Glyph: typeof Glyph;
    Path: typeof Path;
  };

  export default opentype;
}
