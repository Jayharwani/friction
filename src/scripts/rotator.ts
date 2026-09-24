/**
 * The hero card's rotation.
 *
 * Eight seconds, and it stops for anything that suggests someone is reading
 * it: a pointer over it, focus inside it, a hidden tab, or a reduced-motion
 * preference. A card that changes under a reader mid-sentence is worse than
 * one that never changes at all.
 */
const EVERY = 8000;

export function initRotator(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-rotator]')) {
    const slots = [...root.querySelectorAll<HTMLElement>('[data-slot]')];
    if (slots.length < 2) continue;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) continue;

    let at = 0;
    let timer: number | undefined;
    let held = false;

    const show = (next: number): void => {
      slots[at]?.removeAttribute('data-on');
      slots[at]?.setAttribute('aria-hidden', 'true');
      at = next % slots.length;
      slots[at]?.setAttribute('data-on', '');
      slots[at]?.removeAttribute('aria-hidden');
    };

    const tick = (): void => {
      if (!held && !document.hidden) show(at + 1);
      timer = window.setTimeout(tick, EVERY);
    };

    const hold = (): void => {
      held = true;
    };
    const release = (): void => {
      held = false;
    };

    root.addEventListener('pointerenter', hold);
    root.addEventListener('pointerleave', release);
    root.addEventListener('focusin', hold);
    root.addEventListener('focusout', release);

    timer = window.setTimeout(tick, EVERY);

    document.addEventListener(
      'astro:before-swap',
      () => {
        if (timer !== undefined) window.clearTimeout(timer);
      },
      { once: true },
    );
  }
}
