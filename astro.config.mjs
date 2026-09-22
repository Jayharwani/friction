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
export default defineConfig({
  site: 'https://jayharwani.github.io',
  base: '/friction',
  output: 'static',
  trailingSlash: 'ignore',
  // /methodology was the route until the page was rebuilt around its graphics.
  // A static build emits a meta-refresh page, which is enough for a link that
  // may be in someone's history.
  redirects: {
    '/methodology': '/how-it-works',
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [sitemap()],
});
