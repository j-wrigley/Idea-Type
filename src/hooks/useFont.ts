import { useState, useCallback, useRef } from 'react';
import opentype, { type Font } from 'opentype.js';
import type { FontState } from '../types';

export function useFont() {
  const [fontState, setFontState] = useState<FontState>({
    font: null,
    fileName: '',
    selectedGlyphIndex: null,
    originalBuffer: null,
    modifiedGlyphs: new Set(),
  });

  const modifiedRef = useRef<Set<number>>(new Set());

  const loadFont = useCallback(async () => {
    const result = await window.electronAPI.openFontFile();
    if (!result) return;

    const font = opentype.parse(result.buffer);
    modifiedRef.current = new Set();
    setFontState({
      font,
      fileName: result.fileName,
      selectedGlyphIndex: null,
      originalBuffer: result.buffer.slice(0),
      modifiedGlyphs: modifiedRef.current,
    });
  }, []);

  const loadFontFromBuffer = useCallback((buffer: ArrayBuffer, fileName: string) => {
    const font = opentype.parse(buffer);
    modifiedRef.current = new Set();
    setFontState({
      font,
      fileName,
      selectedGlyphIndex: null,
      originalBuffer: buffer.slice(0),
      modifiedGlyphs: modifiedRef.current,
    });
  }, []);

  const createNewFont = useCallback(() => {
    const glyphs: opentype.Glyph[] = [];

    glyphs.push(new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 650,
      path: new opentype.Path(),
    }));

    // Basic Latin: space (32) through tilde (126)
    for (let code = 32; code <= 126; code++) {
      const char = String.fromCharCode(code);
      const name = code === 32 ? 'space' : char;
      glyphs.push(new opentype.Glyph({
        name,
        unicode: code,
        advanceWidth: code === 32 ? 250 : 600,
        path: new opentype.Path(),
      }));
    }

    const font = new opentype.Font({
      familyName: 'Untitled',
      styleName: 'Regular',
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      glyphs,
    });
    modifiedRef.current = new Set();
    setFontState({
      font,
      fileName: 'Untitled.ttf',
      selectedGlyphIndex: null,
      originalBuffer: null,
      modifiedGlyphs: modifiedRef.current,
    });
  }, []);

  const selectGlyph = useCallback((index: number) => {
    setFontState((prev) => ({ ...prev, selectedGlyphIndex: index }));
  }, []);

  const updateFont = useCallback((font: Font) => {
    setFontState((prev) => ({ ...prev, font }));
  }, []);

  const markGlyphModified = useCallback((index: number) => {
    modifiedRef.current.add(index);
  }, []);

  const markAllGlyphsModified = useCallback(() => {
    if (!fontState.font) return;
    for (let i = 0; i < fontState.font.glyphs.length; i++) {
      modifiedRef.current.add(i);
    }
  }, [fontState.font]);

  return {
    fontState,
    loadFont,
    loadFontFromBuffer,
    createNewFont,
    selectGlyph,
    updateFont,
    markGlyphModified,
    markAllGlyphsModified,
  };
}
