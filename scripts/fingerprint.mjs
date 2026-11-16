// City fingerprint (T36): `npm run fingerprint [-- <mapId>] [--write]`
// Generates the city headless, prints grouped hashes and compares them with scripts/fingerprint.<map>.txt.
// --write refreshes the baseline (only when a task changes the city on purpose; say why in the progress log).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const write = args.includes('--write');
const id = args.find((a) => !a.startsWith('--')) ?? 'montreal';
process.env.NEON_MAP = id;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
let code = 0;
try {
  const { fingerprint } = await server.ssrLoadModule('/scripts/fingerprintCore.ts');
  const t0 = performance.now();
  const lines = fingerprint(id);
  const ms = Math.round(performance.now() - t0);
  const file = join(root, 'scripts', `fingerprint.${id}.txt`);
  const out = lines.join('\n') + '\n';
  console.log(out + `(${ms} ms)`);
  if (write) {
    writeFileSync(file, out);
    console.log(`baseline written: ${file}`);
  } else if (!existsSync(file)) {
    console.log('no baseline yet (run with --write)');
  } else {
    // Compare by group name (first word), so an added or removed group shows as just that group
    const byName = (ls) => new Map(ls.map((l) => [l.split(/\s+/)[0], l]));
    const was = byName(readFileSync(file, 'utf8').trim().split('\n'));
    const now = byName(lines);
    const names = [...new Set([...was.keys(), ...now.keys()])].filter((k) => was.get(k) !== now.get(k));
    if (names.length) {
      console.log('FINGERPRINT CHANGED:');
      for (const k of names) console.log(`  was  ${was.get(k) ?? `${k} (missing)`}\n  now  ${now.get(k) ?? `${k} (missing)`}`);
      code = 1;
    } else console.log('fingerprint matches baseline');
  }
} finally {
  await server.close();
}
process.exit(code);
