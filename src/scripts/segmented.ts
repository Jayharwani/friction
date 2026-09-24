/**
 * The segmented group's sliding fill.
 *
 * The fill is placed from the selected segment's own box rather than from an
 * index, because the segments are not equal widths — "Everything" is wider
 * than "Build it" — and an index-based slide lands in the wrong place the
 * moment a count changes the label's length.
 *
 * Under a reduced-motion preference the fill still moves; it simply moves
 * instantly, because the CSS transition that would animate it does not exist
 * there. Nothing here needs to know about the preference.
 */
export function initSegmented(): void {
  for (const group of document.querySelectorAll<HTMLElement>('[data-segmented]')) {
    const fill = group.querySelector<HTMLElement>('[data-seg-fill]');
    const options = [...group.querySelectorAll<HTMLLabelElement>('[data-seg-opt]')];
    if (!fill || options.length === 0) continue;

    const place = (): void => {
      const chosen = options.find((o) => o.querySelector<HTMLInputElement>('input')?.checked);
      if (!chosen) return;
      const box = chosen.getBoundingClientRect();
      const within = group.getBoundingClientRect();
      fill.style.setProperty('--seg-w', `${box.width}px`);
      fill.style.setProperty('--seg-x', `${box.left - within.left}px`);
    };

    for (const option of options) {
      option.querySelector('input')?.addEventListener('change', place);
    }

    /*
     * Twice, deliberately. The first call places the fill from the boxes as
     * they are at parse time; the second runs after the web font has landed,
     * because Geist is wider than the fallback and every segment moves when
     * it swaps in.
     */
    place();
    if (document.fonts?.ready) void document.fonts.ready.then(place);

    const observer = new ResizeObserver(place);
    observer.observe(group);
  }
}
