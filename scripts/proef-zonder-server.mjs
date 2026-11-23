#!/usr/bin/env node
/**
 * proef-zonder-server.mjs — bewijs dat de app zonder server werkt.
 *
 * De Android-app heeft geen Node-server: de pagina haalt de dataset uit de bundel en
 * lokaal.js doet het werk van de server. Deze proef zet die bundel op een eigen
 * bestandsserver, doet zich in de browser voor als de Android-schil (een nagemaakte
 * brug die net als de echte alleen Deezer en iTunes kent) en speelt een hele beurt:
 * spel kiezen, namen invullen, starten, kaart trekken, fragment ophalen, onthullen.
 *
 *   node scripts/proef-zonder-server.mjs [--beeld docs/img/apk-browser.png]
 *
 * Zonder deze proef is "de app werkt zonder server" een bewering in plaats van een
 * meting — en de emulatorrooktest in CI is de tweede, onafhankelijke controle.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startBrowser, verbind, wacht } from './cdp-hulp.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HIER, '..');
const BUNDEL = path.join(ROOT, 'android/app/src/main/assets');
const BEELD = (() => {
  const i = process.argv.indexOf('--beeld');
  return i >= 0 ? path.resolve(process.argv[i + 1]) : null;
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

if (!existsSync(path.join(BUNDEL, 'index.html'))) {
  console.error('De bundel ontbreekt; draai eerst: node scripts/sync-assets.mjs');
  process.exit(1);
}

/* ── de bundel op een eigen poort serveren (zoals de schil dat doet) ───── */

const server = createServer((verzoek, antwoord) => {
  let pad = decodeURIComponent(new URL(verzoek.url, 'http://lokaal').pathname);
  if (pad === '/' || pad === '') pad = '/index.html';
  const bestand = path.join(BUNDEL, pad);
  if (!bestand.startsWith(BUNDEL) || !existsSync(bestand) || !statSync(bestand).isFile()) {
    antwoord.writeHead(404, { 'content-type': 'text/plain' });
    antwoord.end('niet gevonden');
    return;
  }
  antwoord.writeHead(200, { 'content-type': TYPES[path.extname(bestand)] || 'application/octet-stream', 'cache-control': 'no-store' });
  antwoord.end(readFileSync(bestand));
});
await new Promise((los) => server.listen(0, '127.0.0.1', los));
const basis = `http://127.0.0.1:${server.address().port}`;

/* ── de schil nadoen ──────────────────────────────────────────────────── */

const PREVIEW = 'https://cdns-preview-nagemaakt.example/fragment.mp3';
const BRUG = `
window.Sjpeelavond = {
  lokaal: function () { return 'ja'; },
  versie: function () { return '1.0.0-proef'; },
  log: function (tekst) { console.info('SJPEELAVOND ' + tekst); },
  bron: function (url) {
    if (url.indexOf('api.deezer.com') < 0) {
      return JSON.stringify({ ok: false, status: 0, tekst: null, fout: 'deze website mag niet: ' + url });
    }
    return JSON.stringify({ ok: true, status: 200, tekst: JSON.stringify({ preview: '${PREVIEW}' }) });
  }
};
`;

let fouten = 0;
const eis = (goed, uitleg) => {
  console.log(`  ${goed ? 'ok  ' : 'FOUT'} ${uitleg}`);
  if (!goed) fouten++;
};

const { chrome, doel } = await startBrowser({ breedte: 1180, hoogte: 900 });
const { stuur, js, ws } = await verbind(doel);
await stuur('Page.enable');
await stuur('Runtime.enable');
// Page.enable moet er staan vóór deze aanroep, anders wordt het script nooit uitgevoerd.
await stuur('Page.addScriptToEvaluateOnNewDocument', { source: BRUG });
await stuur('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
await stuur('Page.navigate', { url: `${basis}/index.html` });
await wacht(1500);

console.log('--- de pagina draait op de bundel, zonder server ---');
eis(await js('typeof window.SJPEEL_LOKAAL === "function"'), 'de lokale spellogica heeft zich aangemeld');
eis((await js('document.querySelectorAll("#spelkaarten .spelkaart").length')) === 3, 'drie spellkaarten op de startpagina');
const stats = await js('document.querySelector("#statrij").textContent');
eis(stats.includes('1.542'), `de startpagina noemt de hele dataset (${stats.replace(/\s+/g, ' ').trim().slice(0, 40)}…)`);
eis((await js('document.querySelector("#versiechip").textContent')) === 'v1.0.0-proef', 'de versie komt uit de schil');

console.log('--- een beurt Tijdlijn spelen ---');
await js('document.querySelector(\'[data-act="kies-spel"][data-spel="tijdlijn"]\').click()');
await wacht(400);
eis(await js('!document.querySelector("#view-instellen").hidden'), 'het instelscherm staat open');
// Alleen .value zetten is niet genoeg: de app leest de namen uit zijn eigen toestand,
// die door de invoer-luisteraar wordt bijgewerkt. Dus ook een echt invoergebeuren sturen.
await js(`(() => {
  const velden = document.querySelectorAll('#spelerslijst input');
  [['Tom'], ['Ilse']].forEach(([naam], i) => {
    velden[i].value = naam;
    velden[i].dispatchEvent(new Event('input', { bubbles: true }));
  });
  return velden.length;
})()`);
await js('document.querySelector("#start-spel").click()');
await wacht(1200);
const spelOpen = await js('!document.querySelector("#view-spel").hidden');
eis(spelOpen, 'het spelbord staat open');
if (!spelOpen) console.log(`        melding: ${await js('document.querySelector("#melding").textContent')}`);
const bordtekst = await js('document.querySelector("#bord").innerText.length');
eis(bordtekst > 50, `het bord heeft inhoud (${bordtekst} tekens)`);

await js('document.querySelector(\'[data-act="trek"]\').click()');
await wacht(1500);
const audio = await js('document.querySelector("#speler").getAttribute("src") || ""');
eis(audio.includes('cdns-preview-nagemaakt.example'), `het fragment komt via de brug binnen (${audio.slice(0, 48)})`);
const ronde = await js('document.querySelector("#spel-ronde").textContent');
eis(/beurt 1/.test(ronde), `de beurt staat op het bord (${ronde})`);
// Tegen het spieken: een getrokken kaart levert alleen een nummer op, geen jaartal.
const velden = await js(`window.SJPEEL_LOKAAL('/api/trek', { dekken: ['hits'], gebruikt: [], aantal: 1 }).then((k) => Object.keys(k.kaarten[0]).join(','))`);
eis(velden === 'id', `een getrokken kaart geeft alleen een nummer (${velden})`);

if (BEELD) {
  const antwoord = await stuur('Page.captureScreenshot', { format: 'png' });
  writeFileSync(BEELD, Buffer.from(antwoord.result.data, 'base64'));
  console.log(`  beeld bewaard: ${BEELD}`);
}

ws.close();
chrome.kill('SIGKILL');
server.close();
console.log(fouten === 0 ? '\nProef zonder server: alles goed.' : `\nProef zonder server: ${fouten} fout(en).`);
process.exit(fouten === 0 ? 0 : 1);
