/**
 * neem-demo-op.mjs — neemt een demo-opname van Sjpeelavond op (MP4) met echte kliks en een cursor.
 *
 * Werkwijze: een lus maakt elke ~90 ms een schermafbeelding terwijl een tweede lus de app
 * doorloopt met echte pointergebeurtenissen. Daarna zet ffmpeg de beelden met de echte
 * tijdsverschillen achter elkaar.
 *
 *   BASE=http://127.0.0.1:8099 node scripts/neem-demo-op.mjs docs/demo.mp4
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBrowser, verbind, klik, wacht, schermafbeelding, CURSOR } from './cdp-hulp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const UIT = path.resolve(process.argv[2] || 'docs/demo.mp4');
const FRAMES = path.join(path.dirname(UIT), '.frames');
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const spelers = ['Tom', 'Ilse', 'Sanne', 'Joep'];
const { chrome, doel } = await startBrowser({ breedte: 1440, hoogte: 900 });
const { stuur, js, ws } = await verbind(doel);

await stuur('Page.enable');
await stuur('Runtime.enable');
await stuur('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await stuur('Page.navigate', { url: BASE });
await wacht(2200);
await js(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return true;
})()`);
await stuur('Page.reload', { ignoreCache: true });
await wacht(2000);
await js(CURSOR);
await js(`(() => { window.__fouten = []; window.addEventListener('error', (e) => window.__fouten.push(String(e.message))); return true; })()`);

// ── opnamelus ─────────────────────────────────────────────────────────────
const frames = [];
let stoppen = false;
async function opnemen() {
  while (!stoppen) {
    const tijd = Date.now();
    try {
      const antwoord = await stuur('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true });
      if (antwoord.error) throw new Error(JSON.stringify(antwoord.error));
      const naam = `f${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(path.join(FRAMES, naam), Buffer.from(antwoord.result.data, 'base64'));
      frames.push({ naam, tijd });
    } catch (fout) {
      // Een herlaad-moment laat het antwoord vallen; dat is één gemist beeld, geen ramp.
      if (frames.length === 0) console.error('  ! schermafbeelding mislukt:', fout.message);
    }
    await wacht(90);
  }
}
// ── het script dat de app doorloopt ───────────────────────────────────────
const stap = async (omschrijving, fn, pauze = 1400) => {
  console.log(`  ${omschrijving}`);
  try {
    await fn();
  } catch (fout) {
    console.log(`    (overgeslagen: ${fout.message})`);
  }
  await wacht(pauze);
};

await stap('startpagina', async () => {
  await js(`(() => { localStorage.removeItem('sjpeelavond.spel.v1'); location.reload(); return true; })()`);
  await wacht(2000);
}, 2200);

// Pas hier beginnen met opnemen: een schermafbeelding die tijdens een herlaadbeurt
// onderweg is, wordt door Chromium weggegooid en laat de lus eeuwig wachten.
const opname = opnemen();
console.log('  (opname loopt)');

await stap('scrollen over de spellen', () => js(`window.scrollTo({ top: 420, behavior: 'smooth' })`), 1600);
await stap('terug naar boven', () => js(`window.scrollTo({ top: 0, behavior: 'smooth' })`), 1200);

await stap("Tijdlijn kiezen", () => klik(js, '[data-act="kies-spel"][data-spel="tijdlijn"]'), 1600);

await stap('namen invullen', async () => {
  await js(`(() => {
    const velden = document.querySelectorAll('#spelerslijst input');
    const namen = ${JSON.stringify(spelers)};
    velden.forEach((veld, i) => { if (namen[i] === undefined) return; veld.value = namen[i]; veld.dispatchEvent(new Event('input', { bubbles: true })); });
    return true;
  })()`);
  await wacht(600);
  await klik(js, '[data-act="speler-weg"][data-speler="3"]').catch(() => {});
  await klik(js, '[data-act="speler-weg"][data-speler="3"]').catch(() => {});
  await klik(js, '[data-act="speler-weg"][data-speler="3"]').catch(() => {});
}, 1200);

await stap('spelen maar', () => klik(js, '#start-spel'), 2800);

for (let beurt = 0; beurt < 4; beurt++) {
  await stap(`beurt ${beurt + 1}: kaart trekken`, async () => {
    if (await js(`!!document.querySelector('[data-act="trek"]')`)) await klik(js, '[data-act="trek"]');
  }, 2000);
  await stap('plek kiezen', async () => {
    const aantal = await js(`document.querySelectorAll('[data-act="kies-plek"]').length`);
    if (!aantal) return;
    const plek = Math.min(aantal - 1, Math.max(1, Math.round(aantal / 2)));
    await klik(js, `[data-act="kies-plek"][data-plek="${plek}"]`);
    await wacht(500);
    await klik(js, '[data-act="leg-neer"]');
  }, 2400);
  await stap('volgende speler', async () => {
    if (await js(`!!document.querySelector('[data-act="volgende"]')`)) await klik(js, '[data-act="volgende"]');
  }, 1100);
}

await stap('muzieklijst openen', async () => {
  await klik(js, '#tabs button[data-view="muziek"]');
  await wacht(1500);
}, 2000);
await stap('zoeken in de lijst', async () => {
  await js(`(() => { const v = document.querySelector('#muziek-zoek'); v.value = 'rowwen'; v.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await klik(js, '#muziek-laden');
  await wacht(1400);
}, 2200);

await stap("Hittepetit starten", async () => {
  await js(`(() => { localStorage.removeItem('sjpeelavond.spel.v1'); location.reload(); return true; })()`);
  await wacht(2000);
  await klik(js, '[data-act="kies-spel"][data-spel="hittepetit"]');
  await wacht(1200);
  await js(`(() => {
    const velden = document.querySelectorAll('#spelerslijst input');
    const namen = ${JSON.stringify(spelers)};
    velden.forEach((veld, i) => { if (namen[i] === undefined) return; veld.value = namen[i]; veld.dispatchEvent(new Event('input', { bubbles: true })); });
    return true;
  })()`);
  await wacht(500);
  await klik(js, '#start-spel');
  await wacht(2600);
}, 1200);

for (let beurt = 0; beurt < 3; beurt++) {
  await stap(`Hittepetit beurt ${beurt + 1}`, async () => {
    if (await js(`!!document.querySelector('[data-act="trek"]')`)) await klik(js, '[data-act="trek"]');
    await wacht(1800);
    const aantal = await js(`document.querySelectorAll('[data-act="kies-plek"]').length`);
    if (aantal) {
      await klik(js, `[data-act="kies-plek"][data-plek="${Math.min(aantal - 1, 1)}"]`);
      await wacht(500);
      await klik(js, '[data-act="leg-neer"]');
      await wacht(1800);
    }
    if (await js(`!!document.querySelector('[data-act="volgende"]')`)) await klik(js, '[data-act="volgende"]');
  }, 900);
}

await stap('uitleg bekijken', async () => {
  await klik(js, '#tabs button[data-view="uitleg"]');
  await wacht(1600);
  await js(`window.scrollTo({ top: 520, behavior: 'smooth' })`);
}, 2200);

await stap('einde', () => js(`window.scrollTo({ top: 0, behavior: 'smooth' })`), 1400);

stoppen = true;
await opname;
console.log(`  ${frames.length} beelden opgenomen`);

// ── frames.txt met de echte tijdsverschillen ──────────────────────────────
const regels = [];
for (let i = 0; i < frames.length; i++) {
  const duur = i + 1 < frames.length ? Math.max(0.02, (frames[i + 1].tijd - frames[i].tijd) / 1000) : 0.7;
  regels.push(`file '${path.join(FRAMES, frames[i].naam)}'`);
  regels.push(`duration ${duur.toFixed(3)}`);
}
if (frames.length) regels.push(`file '${path.join(FRAMES, frames[frames.length - 1].naam)}'`);
const lijstbestand = path.join(FRAMES, 'frames.txt');
writeFileSync(lijstbestand, regels.join('\n') + '\n', 'utf8');

mkdirSync(path.dirname(UIT), { recursive: true });
const uitkomst = spawnSync(
  'ffmpeg',
  [
    '-y', '-f', 'concat', '-safe', '0', '-i', lijstbestand,
    '-vf', 'scale=1440:900:flags=lanczos,fps=12',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    UIT,
  ],
  { encoding: 'utf8' },
);
if (uitkomst.status !== 0) console.error(uitkomst.stderr?.slice(-1200));
const fouten = await js(`window.__fouten || []`).catch(() => []);
console.log('JS-fouten tijdens de opname:', JSON.stringify(fouten));
ws.close();
chrome.kill('SIGKILL');
console.log(`Klaar: ${path.relative(process.cwd(), UIT)}`);
