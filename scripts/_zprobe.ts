import { z } from 'zod';
console.log('zod version:', (z as any).version ?? 'n/a');
// url validator
const A = z.object({ u: z.url() });
console.log('z.url ok:', A.safeParse({ u: 'https://x.com' }).success, '| bad:', A.safeParse({ u: 'nope' }).success);
// https-only refinement
const H = z.url().refine(v => v.startsWith('https://'), 'must be https');
console.log('https refine, http rejected:', !H.safeParse('http://x.com').success);
// enum
const E = z.enum(['Onboarding', 'Other']);
console.log('enum ok:', E.safeParse('Other').success, '| bad:', E.safeParse('Nope').success);
// string constraints
const S = z.string().min(1).max(5);
console.log('max ok:', S.safeParse('abcde').success, '| over:', S.safeParse('abcdef').success);
// int range
const R = z.number().int().min(1).max(5);
console.log('int range 1..5 ->', R.safeParse(3).success, R.safeParse(6).success);
// error shape
const bad = z.object({ a: z.string() }).safeParse({ a: 1 });
if (!bad.success) {
  console.log('issues is array:', Array.isArray(bad.error.issues), '| first:', JSON.stringify(bad.error.issues[0]));
  console.log('prettifyError available:', typeof (z as any).prettifyError);
  console.log('pretty:\n' + (z as any).prettifyError(bad.error));
}
// array max + nullable
const N = z.object({ x: z.string().nullable(), arr: z.array(z.string()).max(3) });
console.log('nullable ok:', N.safeParse({ x: null, arr: [] }).success);
