/**
 * Paper weights on screen, from the "Screen view" section of docs/drawing-standard.md.
 * The screen is a print preview at the sheet scale that follows the zoom.
 */
export function pxPerPaperMm(pixelsPerMeter: number, scale: number): number {
  return (pixelsPerMeter * scale) / 1000
}

export function screenStrokePx(weightMm: number, pixelsPerMeter: number, scale: number): number {
  return Math.max(1, weightMm * pxPerPaperMm(pixelsPerMeter, scale))
}

export function screenTextPx(heightMm: number, pixelsPerMeter: number, scale: number): number {
  return Math.max(10, heightMm * pxPerPaperMm(pixelsPerMeter, scale))
}
