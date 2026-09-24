/**
 * The sub-navigation's active tab, and the rule that slides under it.
 *
 * Which section is current comes from an IntersectionObserver on the sections
 * themselves, not from a scroll handler: the browser already knows where
 * things are, and asking it every frame is the expensive way to find out.
 *
 * The rootMargin puts the decision line a third of the way down the viewport,
 * so a section counts as current when its heading has arrived rather than
 * when its last pixel has.
 */
export function initSubNav(): void {
  const nav = document.querySelector<HTMLElement>('[data-subnav]');
  const indicator = nav?.querySelector<HTMLElement>('[data-tab-indicator]');
  if (!nav || !indicator) return;

  const tabs = [...nav.querySelectorAll<HTMLAnchorElement>('[data-tab]')];
  const sections = tabs
    .map((t) => document.getElementById(t.dataset.tab!))
    .filter((s): s is HTMLElement => s !== null);

  const place = (tab: HTMLAnchorElement): void => {
    const box = tab.getBoundingClientRect();
    const within = nav.getBoundingClientRect();
    indicator.style.setProperty('--ind-w', `${box.width}px`);
    indicator.style.setProperty('--ind-x', `${box.left - within.left + nav.scrollLeft}px`);
  };

  const mark = (id: string): void => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === id;
      if (on) {
        tab.setAttribute('aria-current', 'true');
        place(tab);
      } else {
        tab.removeAttribute('aria-current');
      }
    }
  };

  if (sections.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      /* The topmost section currently crossing the line wins, so scrolling
         back up moves the indicator back rather than leaving it stranded. */
      const live = entries.filter((e) => e.isIntersecting);
      if (live.length === 0) return;
      live.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      mark(live[0]!.target.id);
    },
    { rootMargin: '-30% 0px -60% 0px' },
  );

  for (const section of sections) observer.observe(section);
  mark(sections[0]!.id);

  /* Geist is wider than the fallback, so every tab moves when it lands. */
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      const current = tabs.find((t) => t.hasAttribute('aria-current'));
      if (current) place(current);
    });
  }

  document.addEventListener('astro:before-swap', () => observer.disconnect(), { once: true });
}
