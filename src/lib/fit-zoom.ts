/**
 * What "Fit" means, and the bounds every zoom obeys.
 *
 * Its own module so the rule can be tested without mounting an editor -- the
 * arithmetic is the part that was wrong, and it needs no Tiptap to be wrong in.
 */

/**
 * The smallest zoom an author may CHOOSE.
 *
 * Does not apply to the fit: a pane narrower than a quarter of the paper should
 * still show the whole page, unreadable but whole, rather than clamp and let it
 * overflow the one thing a paged canvas exists to prevent.
 */
export const ZOOM_MIN = 0.25;

/** The ceiling, for a chosen zoom AND for the fit -- one zoom limit, not two. */
export const ZOOM_MAX = 4;

/**
 * The scale at which a page of `paperPx` fills `availablePx`.
 *
 * ⚠️ It MAGNIFIES, and until #2390 it did not -- the result was capped at 1, so
 * a pane wider than the paper left the page at actual size with the control
 * still reading "Fit". Reported exactly that way: "I select Fit, then resize to
 * full screen -- it still shows Fit, but the page stays small."
 *
 * The cap that was removed was defended on the grounds that magnifying
 * misrepresents how much fits on a page. That is a good argument for what
 * ACTUAL SIZE means and none at all for what FIT means: an author who picks fit
 * has asked for the page to fill the space, the way it does in Word, and a
 * control that silently declines is worse than one that is not offered. Actual
 * size is still one click away -- it is the option named by number.
 *
 * Returns 1 for a measurement that has not happened yet (a zero or negative
 * width), because an editor that has not been laid out should render at actual
 * size rather than at whatever a division by nothing produces.
 */
export function fitZoomFor(availablePx: number, paperPx: number, ceiling: number = ZOOM_MAX): number {
    if (!(paperPx > 0) || !(availablePx > 0)) return 1;

    return Math.min(ceiling, availablePx / paperPx);
}
