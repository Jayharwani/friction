/**
 * RSS: new problems from the last four runs (spec 6.1).
 *
 * Hand-written rather than pulling in a feed package — it is a few lines of
 * XML and the stack list does not include one.
 *
 * "New" means the run in which a problem was first scored, which is the first
 * entry in its history. That is the moment it appeared on the site, and history
 * entries are never rewritten.
 */
import type { APIContext } from 'astro';
import { getProblems, getRuns, platformsLabel } from '../lib/data';
import { url } from '../lib/url';

const RUNS_IN_FEED = 4;

/** Escape the five XML entities. Review text routinely contains & and <. */
function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(context: APIContext): Promise<Response> {
  const site = context.site?.href.replace(/\/$/, '') ?? '';
  const link = (path: string) => `${site}${url(path)}`;

  const recentRuns = new Set(getRuns().slice(0, RUNS_IN_FEED).map((r) => r.date));

  const items = getProblems()
    .filter((p) => {
      const firstScored = p.history[0]?.date;
      return firstScored !== undefined && recentRuns.has(firstScored);
    })
    .sort((a, b) => {
      const byDate = (b.history[0]?.date ?? '').localeCompare(a.history[0]?.date ?? '');
      return byDate !== 0 ? byDate : b.score - a.score;
    });

  const entries = items
    .map((p) => {
      const first = p.history[0]!;
      const description = `${p.summary} Scored ${p.score} of 100 from ${p.evidence.length} reviews across ${platformsLabel(p.platforms)}. Verdict: ${p.verdict}.`;
      return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(link(`/problems/${p.slug}`))}</link>
      <guid isPermaLink="true">${xml(link(`/problems/${p.slug}`))}</guid>
      <pubDate>${new Date(`${first.date}T12:00:00Z`).toUTCString()}</pubDate>
      <category>${xml(p.category)}</category>
      <description>${xml(description)}</description>
    </item>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Friction</title>
    <link>${xml(link('/'))}</link>
    <description>Recurring complaints about widely used mobile apps, scored from public app store reviews.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${entries}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
