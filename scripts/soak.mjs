// Headless traffic soak (T37): `npm run soak [-- <mapId>] [--seeds=3] [--minutes=5] [--write]`
// Deterministic: prints per-seed counts and compares them with scripts/soak.<map>.txt (3 x 5 min runs only).
// Exits 1 on any AI red-light run, or when the results differ from the baseline. Pure refactors must match
// it exactly; AI changes may move it (refresh with --write and note why), but never toward more red runs or
// AI collisions.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (k, d) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const id = args.find((a) => !a.startsWith('--')) ?? 'montreal';
const seeds = opt('seeds', 3);
const minutes = opt('minutes', 5);
const write = args.includes('--write');
const standard = seeds === 3 && minutes === 5;
process.env.NEON_MAP = id;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
let bad = false;
const lines = [];
try {
  const { soak } = await server.ssrLoadModule('/scripts/soakCore.ts');
  console.log(`soak ${id}: ${seeds} seed(s) x ${minutes} min`);
  for (let s = 0; s < seeds; s++) {
    const r = soak(id, 1000 + s, minutes * 60);
    bad ||= r.redRuns > 0;
    const line = `seed ${r.seed}: red runs ${r.redRuns}/${r.crossings}, AI collisions ${r.aiCollisions}, parked hits ${r.parkedHits}, off-road ${(r.offRoad * 100).toFixed(2)}%, cars ${r.cars.toFixed(1)}`;
    lines.push(line);
    console.log(`${line}, ${r.msPerStep.toFixed(2)} ms/step`);
    for (const l of r.collisionLog) console.log(`  ${l}`);
  }
} finally {
  await server.close();
}
const file = join(root, 'scripts', `soak.${id}.txt`);
if (!standard) console.log('(not the standard 3 x 5 min run: no baseline check)');
else if (write) {
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`baseline written: ${file}`);
} else if (!existsSync(file)) console.log('no baseline yet (run with --write)');
else {
  const base = readFileSync(file, 'utf8').trim().split('\n');
  if (base.join('\n') === lines.join('\n')) console.log('soak matches baseline');
  else {
    bad = true;
    console.log('SOAK CHANGED vs baseline:');
    base.forEach((b, i) => b !== lines[i] && console.log(`  was  ${b}\n  now  ${lines[i] ?? '(missing)'}`));
  }
}
if (bad) console.log('FAIL');
process.exit(bad ? 1 : 0);
