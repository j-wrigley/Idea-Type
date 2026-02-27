export interface CoordMapper {
  glyphToScreen: (gx: number, gy: number) => { x: number; y: number };
  screenToGlyph: (sx: number, sy: number) => { x: number; y: number };
  scale: number;
  originX: number;
  originY: number;
}

export function createCoordMapper(
  canvasWidth: number,
  canvasHeight: number,
  unitsPerEm: number,
  zoom: number,
  panX: number,
  panY: number,
  ascender: number,
): CoordMapper {
  const baseScale = (canvasHeight * 0.65) / unitsPerEm;
  const scale = baseScale * zoom;

  const originX = canvasWidth * 0.25 + panX;
  const originY = canvasHeight * 0.12 + ascender * scale + panY;

  function glyphToScreen(gx: number, gy: number) {
    return {
      x: originX + gx * scale,
      y: originY - gy * scale,
    };
  }

  function screenToGlyph(sx: number, sy: number) {
    return {
      x: (sx - originX) / scale,
      y: (originY - sy) / scale,
    };
  }

  return { glyphToScreen, screenToGlyph, scale, originX, originY };
}
