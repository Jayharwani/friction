/**
 * Build an internal URL that respects the deploy base path.
 *
 * The site is served from https://jayharwani.github.io/friction/, so a hardcoded
 * `/problems/foo` works in dev and 404s in production. Every internal href and
 * asset path must go through this function. See spec 0.6.
 */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}
