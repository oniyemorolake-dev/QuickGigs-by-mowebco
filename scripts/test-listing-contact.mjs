/**
 * Checks analyzeListingContact (supabase/functions/_shared/off-platform.ts)
 * against scripts/listing-contact-cases.json. The same cases are used to check
 * public.qg_text_has_contact() in SQL — the two must agree.
 *
 * Run: node scripts/test-listing-contact.mjs   (needs esbuild: npx esbuild)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = process.env.ESBUILD || 'esbuild';
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-')), 'off-platform.mjs');
execFileSync(esbuild, [
  path.join(root, 'supabase/functions/_shared/off-platform.ts'),
  '--format=esm', '--outfile=' + out, '--log-level=error',
]);
const { analyzeListingContact } = await import(pathToFileURL(out).href);
const cases = JSON.parse(fs.readFileSync(path.join(root, 'scripts/listing-contact-cases.json'), 'utf8'));

let failed = 0;
for (const [text, expected] of cases) {
  const got = analyzeListingContact(text).blocked;
  if (got !== expected) { failed++; console.log(`FAIL expected ${expected} got ${got}: ${text}`); }
}
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} cases pass`);
process.exit(failed ? 1 : 0);
