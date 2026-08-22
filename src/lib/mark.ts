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
 * The caps overhang the chambers by three units a side and run heavier than
 * the rest of the glyph. Both exist for the same reason: at 18 points the neck
 * is a couple of device pixels wide and goes soft first, so it's the caps'
 * weight and the ledge's overhang that keep a viewer reading "hourglass"
 * rather than "bowtie" once the neck itself has blurred out.
 */
export const MARK_PATH =
  "M4 2 H20 V5.6 H17 L13.5 11.5 V12.5 L17 18.4 H20 V22 H4 V18.4 H7 L10.5 12.5 V11.5 L7 5.6 H4 Z";

// The coordinates below retrace MARK_PATH's own geometry — caps, ledges, neck
// — so the drained icon can never step outside the solid glyph's silhouette.
// Kept in step with the string above by hand; there are only the two shapes,
// and deriving one from the other would cost more than it'd guard against.
const MARGIN = 2;
const CAP_L = 4;
const CAP_R = 20;
const CAP_BOTTOM = 5.6; // bottom edge of the top cap; MARK_BOX - CAP_BOTTOM is the bottom cap's top edge
const LEDGE_L = 7;
const LEDGE_R = 17;
const NECK_L = 10.5;
const NECK_R = 13.5;
const NECK_TOP = 11.5;
const NECK_BOTTOM = 12.5;
const CENTER_X = (NECK_L + NECK_R) / 2;
const NECK_HALF = (NECK_R - NECK_L) / 2;
const LEDGE_HALF = (LEDGE_R - LEDGE_L) / 2;

/**
 * A chamber's outer edge tapers in a straight line from the neck to the ledge.
 * `t` walks that taper — 0 at the neck, 1 at the ledge — for either chamber,
 * since both share the same taper and differ only in which way is "up".
 */
function halfWidthAt(t: number): number {
  return NECK_HALF + t * (LEDGE_HALF - NECK_HALF);
}

function yAt(t: number, top: boolean): number {
  return top
    ? NECK_TOP + t * (CAP_BOTTOM - NECK_TOP)
    : NECK_BOTTOM + t * (MARK_BOX - CAP_BOTTOM - NECK_BOTTOM);
}

/**
 * How much of one chamber's taper reads as sand versus glass, for a given
 * progress through an estimate. The top chamber empties toward its neck as
 * progress climbs — what's left sits right above the funnel, same as a real
 * glass draining. The bottom fills toward its neck from the base, the sand
 * that's landed there. Pure and DOM-free, so the rule pins without a canvas.
 */
export function fillExtent(
  progress: number,
  top: boolean,
): { from: number; to: number } {
  const clamped = Math.min(1, Math.max(0, progress));
  return top ? { from: 0, to: 1 - clamped } : { from: 1 - clamped, to: 1 };
}

/** The ring's inner edge, as a fraction of the outer half-width at that same
 *  taper point — thin enough to read as glass, never thin enough to vanish. */
const WALL = 0.55;

/**
 * Traces one chamber's wall into `p`: the full trapezoid, then a smaller one
 * nested inside it wound the opposite way, which is what hollows the middle
 * out under the canvas's default nonzero fill rule. Always drawn regardless
 * of progress — a chamber with nothing in it still has glass around it.
 */
function ringInto(p: Path2D, top: boolean): void {
  const outerAt = (t: number) => {
    const hw = halfWidthAt(t);
    return { l: CENTER_X - hw, r: CENTER_X + hw, y: yAt(t, top) };
  };
  const innerAt = (t: number) => {
    const hw = halfWidthAt(t) * WALL;
    return { l: CENTER_X - hw, r: CENTER_X + hw, y: yAt(t, top) };
  };

  const o0 = outerAt(0);
  const o1 = outerAt(1);
  p.moveTo(o0.l, o0.y);
  p.lineTo(o1.l, o1.y);
  p.lineTo(o1.r, o1.y);
  p.lineTo(o0.r, o0.y);
  p.closePath();

  const i0 = innerAt(0);
  const i1 = innerAt(1);
  // Reversed relative to the outer trace on purpose — opposite winding is
  // the hole.
  p.moveTo(i0.r, i0.y);
  p.lineTo(i1.r, i1.y);
  p.lineTo(i1.l, i1.y);
  p.lineTo(i0.l, i0.y);
  p.closePath();
}

/** The frame: both caps, the neck, and both chambers' hollow rings. Always
 *  solid — what a chamber's sand fills over, not what carries the progress. */
function framePath(): Path2D {
  const p = new Path2D();
  p.rect(CAP_L, MARGIN, CAP_R - CAP_L, CAP_BOTTOM - MARGIN);
  p.rect(CAP_L, MARK_BOX - CAP_BOTTOM, CAP_R - CAP_L, CAP_BOTTOM - MARGIN);
  p.rect(NECK_L, NECK_TOP, NECK_R - NECK_L, NECK_BOTTOM - NECK_TOP);
  ringInto(p, true);
  ringInto(p, false);
  return p;
}

/** Adds the trapezoid between two taper fractions of one chamber, at full
 *  chamber width — the region that actually holds sand. */
function fillChamber(p: Path2D, top: boolean, from: number, to: number): void {
  if (to <= from) return; // nothing to draw — an empty chamber is just its ring
  const at = (t: number) => {
    const hw = halfWidthAt(t);
    return { l: CENTER_X - hw, r: CENTER_X + hw, y: yAt(t, top) };
  };
  const a = at(from);
  const b = at(to);
  p.moveTo(a.l, a.y);
  p.lineTo(b.l, b.y);
  p.lineTo(b.r, b.y);
  p.lineTo(a.r, a.y);
  p.closePath();
}

function chamberFillPath(progress: number): Path2D {
  const p = new Path2D();
  const top = fillExtent(progress, true);
  const bottom = fillExtent(progress, false);
  fillChamber(p, true, top.from, top.to);
  fillChamber(p, false, bottom.from, bottom.to);
  return p;
}

/** Distinct drain levels the tray paints, not counting the bucket-less "no
 *  estimate" glyph. Roughly eight, so the icon moves in steps a viewer can
 *  actually notice rather than one imperceptible pixel at a time. */
export const DRAIN_STEPS = 8;

/**
 * Collapses a continuous progress figure to one of `DRAIN_STEPS` levels, so
 * the tray repaints on a real change in how full the glass looks rather than
 * on every tick — the same minute-grained discipline the title and menu
 * already keep. `null` — no estimate to measure against — passes straight
 * through: there's no progress to show, not a zero one, and the caller reads
 * that back as "draw the plain glyph."
 */
export function drainBucket(progress: number | null): number | null {
  if (progress === null) return null;
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.round(clamped * DRAIN_STEPS);
}

/**
 * Draws the mark into a canvas, `px` square, and hands back the context so the
 * caller can read the pixels out.
 *
 * `progress` is how far a running task is through its estimate, 0 to 1 — sand
 * draining from the top chamber into the bottom. `null` (the default) means
 * there's no estimate to measure against, so the plain solid glyph is drawn
 * instead of a chamber split that would be inventing a figure.
 *
 * Deliberately knows nothing about Tauri. The tray rasterises through here, and
 * so does the screenshot sheet — which is the only way to look at menu bar art
 * without a menu bar.
 */
export function paint(
  canvas: HTMLCanvasElement,
  color: string,
  px: number,
  progress: number | null = null,
): CanvasRenderingContext2D | null {
  canvas.width = px;
  canvas.height = px;

  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  ctx.clearRect(0, 0, px, px);
  ctx.scale(px / MARK_BOX, px / MARK_BOX);
  ctx.fillStyle = color;

  if (progress === null) {
    ctx.fill(new Path2D(MARK_PATH));
  } else {
    // Two fills, not one combined path: the ring's hole and the sand region
    // it sits inside would cancel each other out under a shared nonzero fill
    // if they were wound into the same path and happened to overlap.
    ctx.fill(framePath());
    ctx.fill(chamberFillPath(progress));
  }

  return ctx;
}
