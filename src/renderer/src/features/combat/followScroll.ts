// The Combat log card's follow decision, extracted pure so it is testable without a DOM.
//
// THE RULE: the log FOLLOWS (auto-scrolls on append) only while the reader is at the bottom.
// The moment they scroll up to read something, their position is theirs — an append must not
// move it (the 0.10.0 report this fixes: "keep jumping to the bottom so you can't scroll up").
// Scrolling back to the bottom resumes following. Nothing is modal and nothing needs a click.

/**
 * Is this scroll position "at the bottom" for follow purposes?
 *
 * The threshold absorbs sub-pixel scroll rounding and the odd in-flight append: a reader one
 * wheel-notch up is DELIBERATELY not at the bottom (a notch is ~50-100px), while fractional
 * differences from zoom or DPI never count as scrolled-up.
 */
export const FOLLOW_THRESHOLD_PX = 24

export function isAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= FOLLOW_THRESHOLD_PX
}
