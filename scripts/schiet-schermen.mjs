/**
 * schiet-schermen.mjs — maakt de schermafbeeldingen voor de README en de projectpagina.
 *
 * Vereist een draaiende app (standaard http://127.0.0.1:8099) en de gebundelde Chromium.
 *   BASE=http://127.0.0.1:8099 node scripts/schiet-schermen.mjs docs/img
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { startBrowser, verbind, klik, wacht, schermafbeelding, CURSOR } from './cdp-hulp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const UIT = path.resolve(process.argv[2] || 'docs/img');
mkdirSync(UIT, { recursive: true });

const spelers = ['Tom', 'Ilse', 'Sanne', 'Joep'];

const { chrome, doel } = await startBrowser({ breedte: 1440, hoogte: 1000 });
const { stuur, js, ws } = await verbind(doel);

const schiet = async (naam) => {
  const grootte = await schermafbeelding(stuur, path.join(UIT, naam));
  console.log(`  ${naam} (${(grootte / 1024).toFixed(0)} kB)`);
};

async function naarStart() {
  await js(`(() => { localStorage.removeItem('sjpeelavond.spel.v1'); location.reload(); return true; })()`);
  await wacht(1600);
  for (let i = 0; i < 20; i++) {
    if (await js(`document.querySelectorAll('#spelkaarten .spelkaart').length >= 3`)) return;
    await wacht(300);
  }
  throw new Error('De startpagina kwam niet op');
}

async function vulSpelers() {
  await js(`(() => {
    const velden = document.querySelectorAll('#spelerslijst input');
    const namen = ${JSON.stringify(spelers)};
    velden.forEach((veld, i) => {
      if (namen[i] === undefined) return;
      veld.value = namen[i];
      veld.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return velden.length;
  })()`);
  await wacht(250);
}

async function trek() {
  await klik(js, '[data-act="trek"]');
  await wacht(1400);
}

async function legNeer(plek = 1) {
  await klik(js, `[data-act="kies-plek"][data-plek="${plek}"]`);
  await wacht(300);
  await klik(js, '[data-act="leg-neer"]');
  await wacht(1200);
}

async function volgende() {
  await klik(js, '[data-act="volgende"]');
  await wacht(500);
}

await stuur('Page.enable');
await stuur('Runtime.enable');
await stuur('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await stuur('Page.navigate', { url: BASE });
await wacht(2000);
await js(`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return true;
})()`);
await stuur('Page.reload', { ignoreCache: true });
await wacht(1800);
await js(CURSOR);

console.log('Startpagina ...');
await naarStart();
await schiet('start.png');

console.log('Spelers instellen ...');
await klik(js, '[data-act="kies-spel"][data-spel="tijdlijn"]');
await wacht(900);
await vulSpelers();
await schiet('instellen.png');

console.log('Tijdlijn spelen ...');
await klik(js, '#start-spel');
await wacht(2600);
await schiet('spel-trekken.png');

await trek();
await schiet('spel-plaatsen.png');

// Een paar beurten doorspelen zodat de tijdlijnen gevuld raken.
for (let ronde = 0; ronde < 3; ronde++) {
  for (let speler = 0; speler < 4; speler++) {
    if (await js(`!!document.querySelector('[data-act="trek"]')`)) await trek();
    if (await js(`!!document.querySelector('[data-act="leg-neer"]')`)) {
      const plek = await js(`document.querySelectorAll('[data-act="kies-plek"]').length`);
      await legNeer(Math.max(1, Math.floor(Math.random() * Math.max(1, plek - 1)) + 1));
    }
    if (ronde === 0 && speler === 0) await schiet('spel-onthuld.png');
    if (await js(`!!document.querySelector('[data-act="volgende"]')`)) await volgende();
  }
}
await schiet('spel-bord.png');

console.log("Raoj 's — Stop 's ...");
await naarStart();
await klik(js, '[data-act="kies-spel"][data-spel="raojs"]');
await wacht(900);
await vulSpelers();
await klik(js, '[data-variant="stops"]');
await wacht(300);
await klik(js, '#start-spel');
await wacht(2200);
await trek();
await schiet('stops.png');

console.log('Hittepetit ...');
await naarStart();
await klik(js, '[data-act="kies-spel"][data-spel="hittepetit"]');
await wacht(900);
await vulSpelers();
await klik(js, '#start-spel');
await wacht(2600);
await trek();
await schiet('hittepetit-plaatsen.png');
for (let ronde = 0; ronde < 2; ronde++) {
  for (let speler = 0; speler < 4; speler++) {
    if (await js(`!!document.querySelector('[data-act="trek"]')`)) await trek();
    if (await js(`!!document.querySelector('[data-act="leg-neer"]')`)) {
      const plek = await js(`document.querySelectorAll('[data-act="kies-plek"]').length`);
      await legNeer(Math.max(1, Math.floor(Math.random() * Math.max(1, plek - 1)) + 1));
    }
    if (await js(`!!document.querySelector('[data-act="volgende"]')`)) await volgende();
  }
}
await schiet('hittepetit-bord.png');

console.log('Muziek en uitleg ...');
await naarStart();
await klik(js, '#tabs button[data-view="muziek"]');
await wacht(1800);
await schiet('muziek.png');
await klik(js, '#tabs button[data-view="uitleg"]');
await wacht(900);
await schiet('uitleg.png');

console.log('Mobiel ...');
await stuur('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wacht(1200);
await naarStart();
await schiet('mobiel-start.png');
await klik(js, '[data-act="kies-spel"][data-spel="hittepetit"]');
await wacht(900);
await vulSpelers();
await klik(js, '#start-spel');
await wacht(2600);
await trek();
await schiet('mobiel-bord.png');

const meting = await js(`(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  // Alleen echt te breed telt: iets in een strook die je kunt schuiven (de tijdlijn) hoort
  // buiten het scherm te vallen en is geen fout.
  teBreed: [...document.querySelectorAll('body *')].filter((e) => {
    if (e.getBoundingClientRect().right <= window.innerWidth + 1) return false;
    for (let o = e.parentElement; o; o = o.parentElement) {
      const schuif = getComputedStyle(o).overflowX;
      if (schuif === 'auto' || schuif === 'scroll') return false;
    }
    return true;
  }).slice(0, 6).map((e) => e.tagName + '.' + String(e.className).slice(0, 40)),
  legeBeelden: [...document.images].filter((i) => !i.naturalWidth).length,
  beelden: document.images.length,
  fouten: window.__fouten || [],
}))()`);
console.log('meting:', JSON.stringify(meting));

ws.close();
chrome.kill('SIGKILL');
process.exit(meting.teBreed.length ? 2 : 0);
