/**
 * The tempo mark: one hourglass in a 24×24 box. The rail wears it as an SVG and
 * the tray rasterises it, so there is a single piece of art and the menu bar can
 * never drift away from the window.
 *
 * Filled rather than stroked on purpose. macOS scales a tray icon to 18 points
 * high, where a hairline hints badly and all but disappears against a busy menu
 * bar; a solid glyph stays legible at that size and takes a tint cleanly, which
 * is the whole point of it changing colour while a task runs.
 */
export const MARK_BOX = 24;

/**
 * Caps top and bottom, two chambers meeting at a short neck — one closed
 * contour, so it fills with no winding rules to think about.
 *
 * The caps deliberately overhang the chambers by two units a side. That ledge
 * is the whole difference between an hourglass and a bowtie: without it the two
 * triangles dominate the silhouette and the frame disappears.
 */
export const MARK_PATH =
  "M4 2 H20 V4.8 H18 L13 11.4 V12.6 L18 19.2 H20 V22 H4 V19.2 H6 L11 12.6 V11.4 L6 4.8 H4 Z";

/**
 * Draws the mark into a canvas, `px` square, and hands back the context so the
 * caller can read the pixels out.
 *
 * Deliberately knows nothing about Tauri. The tray rasterises through here, and
 * so does the screenshot sheet — which is the only way to look at menu bar art
 * without a menu bar.
 */
export function paint(
  canvas: HTMLCanvasElement,
  color: string,
  px: number,
): CanvasRenderingContext2D | null {
  canvas.width = px;
  canvas.height = px;

  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  ctx.clearRect(0, 0, px, px);
  ctx.scale(px / MARK_BOX, px / MARK_BOX);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(MARK_PATH));
  return ctx;
}
