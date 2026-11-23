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

// Voor het scannen van een kaartje is de embedpagina van Spotify nodig. Die halen we
// hier echt op (één keer, in Node) en stoppen we in de nagemaakte schil: de schil in de
// app doet hetzelfde verzoek, maar synchroon, dus de pagina merkt geen verschil.
const KAART_CODE = 'https://www.hitstergame.com/nl/aaaa0001/00308';
const KAART_SPOTIFY = '3DamFFqW32WihKkTVlwTYQ';
const EMBEDS = {};
try {
  const antwoord = await fetch(`https://open.spotify.com/embed/track/${KAART_SPOTIFY}`, {
    headers: { 'user-agent': 'Sjpeelavond/1.0 (partyspel voor thuis)' },
  });
  EMBEDS[KAART_SPOTIFY] = await antwoord.text();
  console.log(`  (embedpagina van Spotify opgehaald: ${EMBEDS[KAART_SPOTIFY].length} tekens)`);
} catch (fout) {
  console.error(`Kon de embedpagina niet ophalen (${fout.message}); de scanproef wordt overgeslagen.`);
}

const BRUG = `
// Het geluid zelf is in deze proef niet na te spelen: het fragmentadres van de nagemaakte
// brug bestaat niet echt. Daarom doet de speler alsof hij speelt, zodat de knoppen, de balk
// en de klok — dat is wat hier bewezen moet worden — gewoon hun werk doen.
HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
HTMLMediaElement.prototype.pause = function () { this.paused = true; };
HTMLMediaElement.prototype.load = function () {};

window.Sjpeelavond = {
  lokaal: function () { return 'ja'; },
  versie: function () { return '1.0.0-proef'; },
  log: function (tekst) { console.info('SJPEELAVOND ' + tekst); },
  bron: function (url) {
    if (url.indexOf('api.deezer.com') >= 0) {
      return JSON.stringify({ ok: true, status: 200, tekst: JSON.stringify({ preview: '${PREVIEW}' }) });
    }
    if (url.indexOf('open.spotify.com') >= 0) {
      var embeds = ${JSON.stringify(EMBEDS)};
      var id = url.split('/').pop();
      if (embeds[id]) return JSON.stringify({ ok: true, status: 200, tekst: embeds[id], fout: null });
      return JSON.stringify({ ok: false, status: 404, tekst: null, fout: 'nummer niet gevonden' });
    }
    return JSON.stringify({ ok: false, status: 0, tekst: null, fout: 'deze website mag niet: ' + url });
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
console.log('--- verfijnen: een jaarbereik en een schakelaar ---');
// De keuzelijsten horen gevuld te zijn en de uitleg hoort te vertellen hoeveel er overblijft.
const jaarOpties = await js('document.querySelector("#jaar-van").options.length');
eis(jaarOpties > 30, `de jaarkeuze is gevuld (${jaarOpties} regels)`);
const geenFilter = await js('document.querySelector("#verfijning-uitleg").textContent');
eis(/geen filter/i.test(geenFilter) && /nummers om uit te kiezen/.test(geenFilter), `zonder filter staat er wat er te kiezen valt (${geenFilter})`);

await js(`(() => {
  const van = document.querySelector('#jaar-van');
  van.value = '1980';
  van.dispatchEvent(new Event('change', { bubbles: true }));
  van.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await wacht(500);
const metFilter = await js('document.querySelector("#verfijning-uitleg").textContent');
eis(/vanaf 1980/.test(metFilter), `de verfijning staat er (${metFilter})`);
eis(/\d+ nummers om uit te kiezen/.test(metFilter), 'en het aantal dat er dan overblijft');

// Een filter dat alles wegneemt hoort dat vooraf te zeggen, niet pas halverwege. Vanaf het
// hoogste jaar tot het laagste jaar kan niets vallen.
await js(`(() => {
  const van = document.querySelector('#jaar-van');
  const tot = document.querySelector('#jaar-tot');
  van.value = String(new Date().getFullYear());
  tot.value = '1965';
  van.dispatchEvent(new Event('input', { bubbles: true }));
  tot.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await wacht(500);
const teStreng = await js('document.querySelector("#verfijning-uitleg").textContent');
eis(/blijft niets van over/i.test(teStreng), `te streng wordt vooraf gemeld (${teStreng})`);

// En weer terug naar een werkbaar bereik, zodat het spel hierna gewoon kan beginnen.
await js(`(() => {
  const tot = document.querySelector('#jaar-tot');
  tot.value = '';
  tot.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await wacht(400);

console.log('--- donker thema ---');
const licht = await js('getComputedStyle(document.body).backgroundColor');
await js('document.querySelector("#thema-knop").click()');
await wacht(300);
eis((await js('document.documentElement.dataset.thema')) === 'donker', 'de knop zet het donkere thema');
const donker = await js('getComputedStyle(document.body).backgroundColor');
eis(donker !== licht, `de achtergrond verandert mee (${licht} -> ${donker})`);
eis((await js('localStorage.getItem("sjpeelavond.thema")')) === 'donker', 'de keuze wordt onthouden');
// Terug naar licht: de rest van de beelden hoort het gewone thema te tonen.
await js('document.querySelector("#thema-knop").click()');
await wacht(300);
eis((await js('document.documentElement.dataset.thema')) === 'licht', 'en weer terug naar licht');

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

/* ── op pauze zetten ──────────────────────────────────────────────────── */

const knopWoord = () => js('document.querySelector(".speelknop span")?.textContent || ""');
const balkStand = () => js('parseFloat(document.querySelector("#balkvulling").style.width) || 0');

console.log('--- het fragment op pauze zetten en weer verdergaan ---');
eis((await knopWoord()) === 'Pauze', `de knop biedt pauzeren aan (${await knopWoord()})`);
await wacht(700);
const voorPauze = await balkStand();
eis(voorPauze > 0, `de balk loopt terwijl het speelt (${voorPauze.toFixed(1)}%)`);

await js('document.querySelector(".speelknop").click()');
await wacht(350);
const opPauze = await balkStand();
eis((await knopWoord()) === 'Verder', `op pauze biedt de knop Verder aan (${await knopWoord()})`);
await wacht(900);
const nogSteeds = await balkStand();
eis(
  Math.abs(nogSteeds - opPauze) < 0.5,
  `de balk staat stil zolang het op pauze staat (${opPauze.toFixed(1)}% -> ${nogSteeds.toFixed(1)}%)`,
);

await js('document.querySelector(".speelknop").click()');
await wacht(900);
const naVerder = await balkStand();
eis(naVerder > opPauze + 1, `Verder gaat verder waar het gebleven was (${opPauze.toFixed(1)}% -> ${naVerder.toFixed(1)}%)`);
eis((await knopWoord()) === 'Pauze', 'de knop biedt weer pauzeren aan');

// Tien seconden terug: de balk springt terug en loopt daarna weer door.
const voorTerug = await balkStand();
await js('document.querySelector(\'[data-act="terug"]\').click()');
await wacht(250);
const naTerug = await balkStand();
eis(naTerug < voorTerug, `tien seconden terug zet de balk terug (${voorTerug.toFixed(1)}% -> ${naTerug.toFixed(1)}%)`);
await wacht(700);
eis((await balkStand()) > naTerug, 'en daarna loopt hij weer door');

if (Object.keys(EMBEDS).length) {
  console.log('--- een kaartje van de fysieke doos scannen ---');
  // Precies wat de schil doet: de gelezen code aan de pagina geven.
  await js(`window.SJPEEL_SCAN(${JSON.stringify(KAART_CODE)})`);
  await wacht(2000);
  eis(await js('!document.querySelector("#view-scannen").hidden'), 'het scaanscherm staat open');
  const scanMelding = await js('document.querySelector("#scan-melding").textContent');
  eis(/00308/.test(scanMelding), `het kaartje is opgezocht (${scanMelding})`);
  const scanAudio = await js('document.querySelector("#speler").getAttribute("src") || ""');
  eis(scanAudio.includes('scdn.co'), `het fragment komt van Spotify (${scanAudio.slice(0, 46)}…)`);
  eis(await js('document.querySelector("#scan-onthulling").hidden'), 'titel, artiest en jaartal blijven eerst verborgen');
  const kaartVak = await js('document.querySelector("#scan-kaart").innerText');
  eis(!/Fireflies|Owl City|2009/.test(kaartVak), 'er staat nog niets over het nummer op het scherm');
  if (BEELD) {
    const antwoord = await stuur('Page.captureScreenshot', { format: 'png' });
    writeFileSync(BEELD.replace(/\.png$/, '-verborgen.png'), Buffer.from(antwoord.result.data, 'base64'));
  }

  await js('document.querySelector(\'[data-act="scan-onthul"]\').click()');
  await wacht(400);
  const onthuld = await js('document.querySelector("#scan-onthulling").innerText');
  eis(/2009/.test(onthuld) && /Fireflies/.test(onthuld), `onthullen geeft titel en jaartal (${onthuld.replace(/\s+/g, ' ').slice(0, 60)}…)`);
  const rondeLijst = await js('document.querySelector("#scan-ronde").innerText');
  eis(/00308/.test(rondeLijst) && /2009/.test(rondeLijst), `het kaartje staat in de ronde van deze avond (${rondeLijst.replace(/\s+/g, ' ').trim()})`);
  if (BEELD) {
    const antwoord = await stuur('Page.captureScreenshot', { format: 'png' });
    writeFileSync(BEELD.replace(/\.png$/, '-onthuld.png'), Buffer.from(antwoord.result.data, 'base64'));
    console.log(`  beelden bewaard: ${BEELD.replace(/\.png$/, '-verborgen.png')} en ${BEELD.replace(/\.png$/, '-onthuld.png')}`);
  }
} else {
  console.log('--- geen netwerk: het scannen van een kaartje is niet nagegaan ---');
  eis(false, 'de embedpagina van Spotify was niet op te halen');
}

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
