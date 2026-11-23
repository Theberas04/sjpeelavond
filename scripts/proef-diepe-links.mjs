/**
 * proef-diepe-links.mjs — natrekken dat een diepe link werkt terwijl de app al openstaat.
 *
 * De Android-schil opent een scherm met `am start -e scherm <naam>`; de pagina krijgt dan
 * alleen een ander hekje in het adres en laadt niet opnieuw. Zonder een hashchange-
 * luisteraar bleef de app op het oude scherm staan (dat gebeurde op de emulator).
 *
 * Vereist een draaiende app (standaard http://127.0.0.1:8099) en de gebundelde Chromium:
 *   BASE=http://127.0.0.1:8099 node scripts/proef-diepe-links.mjs
 */
import { startBrowser, verbind, wacht } from './cdp-hulp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const SCHERMEN = [
  ['#instellen', 'view-instellen'],
  ['#uitleg', 'view-uitleg'],
  ['#scannen', 'view-scannen'],
  ['#muziek', 'view-muziek'],
  ['#spel', 'view-spel'],
];

const { doel } = await startBrowser({ breedte: 1200, hoogte: 900 });
const { stuur, js, ws } = await verbind(doel);

const zichtbaar = () =>
  js("Array.prototype.filter.call(document.querySelectorAll('#app > section'), (s) => !s.hidden).map((s) => s.id).join(',')");

await js(`location.href = '${BASE}/index.html'`);
await wacht(4000);
console.log(`bij het openen: ${await zichtbaar()}`);

let goed = true;
for (const [hekje, verwacht] of SCHERMEN) {
  await js(`location.hash = '${hekje}'`);
  await wacht(2200);
  const nu = await zichtbaar();
  const ok = nu === verwacht;
  goed = goed && ok;
  console.log(`  ${hekje.padEnd(12)} -> ${nu}${ok ? '' : `  FOUT (verwacht ${verwacht})`}`);
}

console.log(goed ? 'Alle diepe links openen het juiste scherm.' : 'Niet in orde.');
try {
  ws.close();
} catch {
  /* niets aan te doen */
}
process.exit(goed ? 0 : 1);
