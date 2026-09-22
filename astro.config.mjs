// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// The site deploys to https://jayharwani.github.io/friction/, not a domain root.
// `base` is what makes src/lib/url.ts resolve correctly in production.
// See spec 0.6 — every internal link must be built from import.meta.env.BASE_URL.
//
// Deviation from spec (rule 0.1): the spec's stack table pins Astro 5, but Astro 7
// is current and the Tailwind 4 setup below is the one the current docs prescribe
// (@tailwindcss/vite, not the retired @astrojs/tailwind integration).
// Declared once because `redirects` does NOT get `base` applied to it: a
// destination of '/how-it-works' emits a meta-refresh to the domain root,
// which is a 404 on a project page. Verified against the deployed site.
const BASE = '/friction';

export default defineConfig({
  site: 'https://jayharwani.github.io',
  base: BASE,
  output: 'static',
  trailingSlash: 'ignore',
  // /methodology was the route until the page was rebuilt around its graphics.
  // A static build emits a meta-refresh page, which is enough for a link that
  // may be in someone's history.
  redirects: {
    '/methodology': `${BASE}/how-it-works`,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  // /og is the source board for the social card, not a destination.
  integrations: [sitemap({ filter: (page) => !page.includes('/og') })],
});
