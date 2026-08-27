/**
 * The tempo mark: one hourglass in a 24×24 box. The tray rasterises it, and
 * the screenshot sheet reads this file to paint the same glyph at menu bar
 * sizes — which is the only way to review the art, since a menu bar can't be
 * screenshotted. The rail wore it as an SVG until `2e49a48` dropped that icon;
 * nothing renders it as SVG today.
 *
 * Filled rather than stroked on purpose. macOS scales a tray icon to 18 points
 * high, where a hairline hints badly and all but disappears against a busy menu
 * bar; a solid glyph stays legible at that size and takes a tint cleanly, which
 * is the whole point of it changing colour while a task runs.
 */
export const MARK_BOX = 24;

/**
 * Caps top and bottom, two chambers meeting at a neck — one closed contour, so
 * it fills with no winding rules to think about.
 *
 * The proportions are the whole design. The caps are heavy slabs that overhang
 * the chambers, because at 18 points they are the only part that never blurs.
 * The taper runs six units down against five across, steep enough to read as a
 * funnel: a shallower one turns the two chambers into wide wedges and the
 * glyph into a bowtie. The neck is a real channel rather than a point, for the
 * same reason — a pinch a device pixel wide closes up entirely once antialiased.
 */
export const MARK_PATH =
  "M3 2 H21 V5 H18.5 L13.2 11 V13 L18.5 19 H21 V22 H3 V19 H5.5 L10.8 13 V11 L5.5 5 H3 Z";

/**
 * Draws the mark into a canvas, `px` square, and hands back the context so the
 * caller can read the pixels out. One fill, the whole glyph.
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
