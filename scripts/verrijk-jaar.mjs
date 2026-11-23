#!/usr/bin/env node
/**
 * verrijk-jaar.mjs — zoekt het oorspronkelijke uitgavejaar van de Limburgse nummers.
 *
 * Voor een tijdlijnspel moet het jaartal kloppen. Twee bronnen, in deze volgorde:
 *   1. MusicBrainz: first-release-date van de opname (authoritative, 1 verzoek per seconde);
 *   2. Deezer: het vroegste albumjaar waarin het nummer voorkomt (nodig voor repertoire
 *      dat niet in MusicBrainz staat, zoals veel vastelaovesmuziek).
 *
 * Uitvoer: data/bron/limburg-jaar.json  { "<deezerId>": {jaar, jaarBron, mbId?} }
 *
 * Gebruik:
 *   node scripts/verrijk-jaar.mjs             # alles
 *   node scripts/verrijk-jaar.mjs --proef 10
 *   node scripts/verrijk-jaar.mjs --alleen-mb # sla de Deezer-aanvulling over
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRON = path.join(WORTEL, 'data', 'bron');
const MBCACHE = path.join(BRON, 'mb-cache');
const DZCACHE = path.join(BRON, 'deezer-cache');
const UA = 'Sjpeelavond/1.0 (partyspel voor thuis)';
const MBUA = 'Sjpeelavond/1.0 ( https://github.com/Theberas04/sjpeelavond )';

const args = process.argv.slice(2);
const PROEF = args.includes('--proef') ? parseInt(args[args.indexOf('--proef') + 1] || '10', 10) : 0;
const ALLEEN_MB = args.includes('--alleen-mb');
// MusicBrainz is regelmatig 503; met --zonder-mb slaan we die bron helemaal over en
// gebruiken we alleen de LVK-lijst en het vroegste Deezer-albumjaar.
const ZONDER_MB = args.includes('--zonder-mb');

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:radio|single|album|original|remaster|live|feat|versie|version)[^)]*\)/g, ' ')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const jaarUit = (datum) => {
  const m = /^(\d{4})/.exec(String(datum || ''));
  return m ? parseInt(m[1], 10) : null;
};

async function json(url, bestand, headers, { pogingen = 4, timeout = 8000 } = {}) {
  if (existsSync(bestand)) return JSON.parse(await readFile(bestand, 'utf8'));
  let laatsteFout;
  for (let poging = 0; poging < pogingen; poging++) {
    try {
      // Zonder timeout blijft een hangend verzoek minuten staan en lijkt het script vast te lopen.
      const antwoord = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (antwoord.status === 503 || antwoord.status === 429) {
        laatsteFout = new Error(`HTTP ${antwoord.status} (dienst tijdelijk bezet)`);
        await new Promise((r) => setTimeout(r, 2000 * (poging + 1)));
        continue;
      }
      if (!antwoord.ok) throw new Error(`HTTP ${antwoord.status}`);
      const data = await antwoord.json();
      if (data?.error) throw new Error(data.error.message || 'API-fout');
      await mkdir(path.dirname(bestand), { recursive: true });
      await writeFile(bestand, JSON.stringify(data), 'utf8');
      return data;
    } catch (fout) {
      laatsteFout = fout;
      await new Promise((r) => setTimeout(r, 1500 * (poging + 1)));
    }
  }
  console.error(`  ! ${url}: ${laatsteFout?.message}`);
  return null;
}

/**
 * MusicBrainz valt regelmatig terug op 503 ("currently busy"). Zonder kortsluiting
 * kost dat vier mislukte pogingen per nummer en duurt de verrijking uren; na vijf
 * mislukkingen op rij slaan we MusicBrainz voor de rest van de run over.
 */
const mbStand = { mislukt: 0, uit: false };

/** MusicBrainz: first-release-date van de opname. */
async function mbJaar(titel, artiest) {
  if (mbStand.uit) return null;
  const q = `recording:"${titel.replace(/"/g, '')}" AND artist:"${artiest.replace(/"/g, '')}"`;
  const sleutel = 'mb_' + norm(titel + '_' + artiest).replace(/ /g, '_').slice(0, 110) + '.json';
  const url = 'https://musicbrainz.org/ws/2/recording?fmt=json&limit=8&query=' + encodeURIComponent(q);
  const data = await json(url, path.join(MBCACHE, sleutel), { 'user-agent': MBUA }, { pogingen: 2, timeout: 5000 });
  await new Promise((r) => setTimeout(r, 1100)); // MusicBrainz: max 1 verzoek per seconde
  if (!data) {
    mbStand.mislukt += 1;
    if (mbStand.mislukt >= 3) {
      mbStand.uit = true;
      console.log('  MusicBrainz antwoordt niet; ik sla het voor de rest van deze run over (Deezer-aanvulling doet de rest).');
    }
    return null;
  }
  mbStand.mislukt = 0;
  const opnames = data?.recordings || [];
  const wt = norm(titel);
  const kandidaten = opnames
    .filter((r) => r['first-release-date'] && (norm(r.title) === wt || norm(r.title).includes(wt) || wt.includes(norm(r.title))))
    .map((r) => ({ jaar: jaarUit(r['first-release-date']), id: r.id, titel: r.title }));
  if (!kandidaten.length) return null;
  kandidaten.sort((a, b) => a.jaar - b.jaar);
  return { jaar: kandidaten[0].jaar, mbId: kandidaten[0].id, bron: 'MusicBrainz (first-release-date)' };
}

/** Deezer: vroegste albumjaar waarin dit nummer voorkomt. */
async function deezerJaar(deezerId, titel, artiest) {
  const zoek = await json(
    'https://api.deezer.com/search?' + new URLSearchParams({ q: `track:"${titel}" artist:"${artiest}"`, limit: 25 }),
    path.join(DZCACHE, 'jr_' + norm(titel + '_' + artiest).replace(/ /g, '_').slice(0, 110) + '.json'),
    { 'user-agent': UA },
  );
  await new Promise((r) => setTimeout(r, 140));
  const albums = new Map();
  for (const track of zoek?.data || []) {
    if (norm(track.title_short || track.title) !== norm(titel)) continue;
    if (track.album?.id) albums.set(track.album.id, track.album.title);
  }
  const eigen = await json(
    'https://api.deezer.com/track/' + deezerId,
    path.join(DZCACHE, 'tr_' + deezerId + '.json'),
    { 'user-agent': UA },
  );
  await new Promise((r) => setTimeout(r, 140));
  if (eigen?.album?.id) albums.set(eigen.album.id, eigen.album.title);
  let vroegste = null;
  let geprobeerd = 0;
  for (const albumId of albums.keys()) {
    if (geprobeerd++ >= 4) break; // niet alle 25 albums natrekken: de eerste zijn de bekendste
    if (vroegste && vroegste.jaar <= 1985) break;
    const album = await json(
      'https://api.deezer.com/album/' + albumId,
      path.join(DZCACHE, 'alb_' + albumId + '.json'),
      { 'user-agent': UA },
    );
    await new Promise((r) => setTimeout(r, 140));
    const jaar = jaarUit(album?.release_date);
    if (jaar && (vroegste === null || jaar < vroegste.jaar)) vroegste = { jaar, album: album.title };
  }
  if (!vroegste) return null;
  return { jaar: vroegste.jaar, bron: `Deezer (vroegste album: ${vroegste.album})` };
}

const ruw = JSON.parse(await readFile(path.join(BRON, 'limburg-ruw.json'), 'utf8'));
const lijst = PROEF ? ruw.nummers.slice(0, PROEF) : ruw.nummers;

/**
 * Voor een LVK-inzending is het jaar waarin het liedje meedeed de juiste datum —
 * beter dan welk albumjaar dan ook. De lijst komt uit data/bron/lvk.json
 * (winnaars van nl.wikipedia.org plus de halvefinalisten- en finalistenlijsten van L1).
 */
const lvkPad = path.join(BRON, 'lvk.json');
const lvk = existsSync(lvkPad) ? JSON.parse(await readFile(lvkPad, 'utf8')) : null;
const lvkPerTitel = new Map();
for (const nummer of lvk?.nummers || []) {
  const sleutel = norm(nummer.titel);
  if (!sleutel || !nummer.jaar) continue;
  if (!lvkPerTitel.has(sleutel)) lvkPerTitel.set(sleutel, []);
  lvkPerTitel.get(sleutel).push({ jaar: nummer.jaar, uitvoerende: norm(nummer.uitvoerende || '') });
}
function lvkJaar(titel, artiest) {
  const kandidaten = lvkPerTitel.get(norm(titel));
  if (!kandidaten) return null;
  const a = norm(artiest);
  const treffer = kandidaten.find((k) => k.uitvoerende && (a.includes(k.uitvoerende) || k.uitvoerende.includes(a)));
  return (treffer || kandidaten[0]).jaar;
}

console.log(
  `Jaartallen zoeken voor ${lijst.length} Limburgse nummers (LVK-lijst: ${lvk?.aantal || 0} regels, bron: ${ZONDER_MB ? 'Deezer' : 'MusicBrainz en Deezer'}) ...`,
);

const uit = {};
let mb = 0;
let dz = 0;
let viaLvk = 0;
let geen = 0;
let klaar = 0;

/**
 * Vijf nummers tegelijk: Deezer kan dat hebben en de bestandscache voorkomt dubbel werk.
 * MusicBrainz staat op één verzoek per seconde (hun voorwaarde), dus die kant gaat via
 * een wachtrij van één.
 */
const WERKERS = ZONDER_MB ? 5 : 4;
let mbBeurt = Promise.resolve();
function mbOpZijnBeurt(werk) {
  const volgende = mbBeurt.then(werk, werk);
  mbBeurt = volgende.catch(() => {});
  return volgende;
}

let volgendeIndex = 0;
async function werker() {
  while (true) {
    const i = volgendeIndex++;
    if (i >= lijst.length) return;
    const nummer = lijst[i];
    try {
      const lvkUit = lvkJaar(nummer.titel, nummer.artiest);
      if (lvkUit) {
        uit[nummer.deezerId] = { jaar: lvkUit, jaarBron: `LVK-inzending ${lvkUit} (L1 / Stichting LVK)` };
        viaLvk++;
      } else {
        const treffer = ZONDER_MB ? null : await mbOpZijnBeurt(() => mbJaar(nummer.titel, nummer.artiest));
        if (treffer?.jaar) {
          uit[nummer.deezerId] = { jaar: treffer.jaar, jaarBron: treffer.bron, mbId: treffer.mbId };
          mb++;
        } else if (!ALLEEN_MB) {
          const viaDeezer = await deezerJaar(nummer.deezerId, nummer.titel, nummer.artiest);
          if (viaDeezer) {
            uit[nummer.deezerId] = { jaar: viaDeezer.jaar, jaarBron: viaDeezer.bron };
            dz++;
          } else {
            geen++;
          }
        } else {
          geen++;
        }
      }
    } catch (fout) {
      geen++;
      console.error(`  ! ${nummer.artiest} — ${nummer.titel}: ${fout.message}`);
    }
    klaar++;
    if (klaar % 25 === 0) console.log(`  ${klaar}/${lijst.length} — lvk:${viaLvk} mb:${mb} deezer:${dz} onbekend:${geen}`);
  }
}

await Promise.all(Array.from({ length: WERKERS }, werker));

console.log(`\nLVK-jaartal: ${viaLvk}, MusicBrainz: ${mb}, Deezer-aanvulling: ${dz}, onbekend: ${geen}`);
if (!PROEF) {
  const bestaand = existsSync(path.join(BRON, 'limburg-jaar.json'))
    ? JSON.parse(await readFile(path.join(BRON, 'limburg-jaar.json'), 'utf8')).jaren || {}
    : {};
  await writeFile(
    path.join(BRON, 'limburg-jaar.json'),
    JSON.stringify(
      {
        bron: 'LVK-liedjeslijst (L1/Stichting LVK), MusicBrainz (first-release-date) en Deezer (vroegste albumjaar)',
        opgehaald: new Date().toISOString().slice(0, 10),
        aantal: Object.keys({ ...bestaand, ...uit }).length,
        jaren: { ...bestaand, ...uit },
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log('Weggeschreven: data/bron/limburg-jaar.json');
}
