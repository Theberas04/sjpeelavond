#!/usr/bin/env node
/**
 * maak-iconen.mjs — de app-iconen van Sjpeelavond, uit één bron (public/favicon.svg).
 *
 * Chromium tekent ze op de gevraagde maat en levert ze met een doorzichtige
 * achtergrond; de uitsnede wordt met een clip opgeëist, want `--screenshot` op de
 * opdrachtregel levert de maat van het *venster* en niet die van het tekenvlak
 * (bij een venster van 192 px hoog is het vlak 105 px, en dan wordt het kunstwerk
 * onderaan afgesneden).
 *
 *   node tools/maak-iconen.mjs
 *
 * De uitkomst hoort in git (android/app/src/main/res/); dit script is de bron.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBrowser, verbind, wacht } from '../scripts/cdp-hulp.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HIER, '..');
const RES = path.join(ROOT, 'android/app/src/main/res');
const BRON = path.join(ROOT, 'public/favicon.svg');

const MATEN = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const VOORGROND = 432; // adaptief voorgrondstuk, altijd 432 px
const VEILIGE_ZONE = 0.62; // het kunstwerk binnen de middelste 62 procent

const svg = readFileSync(BRON, 'utf8');
// Het adaptieve voorgrondstuk is alleen het kunstwerk: de rode plaat komt uit de kleur.
const alleenNoot = svg
  .split('\n')
  .filter((regel) => !regel.includes('width="64" height="64" rx="16"'))
  .join('\n');

function paginaHtml(kunstSvg, maat, kunst, rond = false) {
  return `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: ${maat}px; height: ${maat}px; background: transparent; }
  .vlak { width: ${maat}px; height: ${maat}px; display: flex; align-items: center; justify-content: center;
          ${rond ? 'border-radius: 50%; overflow: hidden;' : ''} }
  .kunst { width: ${kunst}px; height: ${kunst}px; }
  .kunst svg { width: 100%; height: 100%; display: block; }
</style>
<div class="vlak"><div class="kunst">${kunstSvg}</div></div>`;
}

/** Leest de maat uit de PNG zelf, zodat de controle niet van een aanname afhangt. */
function pngMaat(pad) {
  const kop = readFileSync(pad).subarray(16, 24);
  return { breedte: kop.readUInt32BE(0), hoogte: kop.readUInt32BE(4) };
}

const { chrome, doel } = await startBrowser({ breedte: 600, hoogte: 600 });
const { stuur, ws } = await verbind(doel);
await stuur('Page.enable');
await stuur('Runtime.enable');
// Zonder deze override krijgt elk beeld een witte achtergrond in plaats van niets.
await stuur('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

let fouten = 0;
async function teken(html, maat, bestand) {
  await stuur('Emulation.setDeviceMetricsOverride', { width: maat, height: maat, deviceScaleFactor: 1, mobile: false });
  await stuur('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
  await wacht(300);
  const antwoord = await stuur('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: maat, height: maat, scale: 1 },
    captureBeyondViewport: false,
    fromSurface: true,
  });
  if (antwoord.error) {
    console.error(`  ! uitsnede mislukt voor ${bestand}: ${JSON.stringify(antwoord.error)}`);
    fouten++;
    return;
  }
  mkdirSync(path.dirname(bestand), { recursive: true });
  writeFileSync(bestand, Buffer.from(antwoord.result.data, 'base64'));
  const gemeten = pngMaat(bestand);
  if (gemeten.breedte !== maat || gemeten.hoogte !== maat) {
    console.error(`  ! ${path.basename(bestand)} is ${gemeten.breedte}x${gemeten.hoogte}, verwacht ${maat}x${maat}`);
    fouten++;
  }
}

console.log(`Chromium: ${chrome.spawnfile || 'eigen Chromium'}`);
for (const [dichtheid, maat] of Object.entries(MATEN)) {
  const map = path.join(RES, `mipmap-${dichtheid}`);
  await teken(paginaHtml(svg, maat, maat), maat, path.join(map, 'ic_launcher.png'));
  await teken(paginaHtml(svg, maat, maat, true), maat, path.join(map, 'ic_launcher_round.png'));
  console.log(`  mipmap-${dichtheid}: ic_launcher.png + ic_launcher_round.png (${maat}px)`);
}

const kunst = Math.round(VOORGROND * VEILIGE_ZONE);
await teken(paginaHtml(alleenNoot, VOORGROND, kunst), VOORGROND, path.join(RES, 'drawable-nodpi/ic_launcher_foreground.png'));
console.log(`  drawable-nodpi: ic_launcher_foreground.png (${VOORGROND}px, kunst ${kunst}px)`);

const adaptief = path.join(RES, 'mipmap-anydpi-v26');
mkdirSync(adaptief, { recursive: true });
for (const naam of ['ic_launcher', 'ic_launcher_round']) {
  writeFileSync(
    path.join(adaptief, `${naam}.xml`),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptief icoon: de noot op de rode plaat. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`,
  );
  console.log(`  mipmap-anydpi-v26/${naam}.xml`);
}

ws.close();
chrome.kill('SIGKILL');
console.log(fouten === 0 ? 'Iconen klaar.' : `Iconen klaar met ${fouten} fout(en).`);
process.exit(fouten === 0 ? 0 : 1);
