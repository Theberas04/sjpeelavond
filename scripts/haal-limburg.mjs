#!/usr/bin/env node
/**
 * haal-limburg.mjs — verzamelt Limburgse (vastelaoves-)muziek via de publieke Deezer-API.
 *
 * Twee bronnen:
 *   1. de topnummers van een curated lijst Limburgse artiesten/gezelschappen;
 *   2. zoektermen die typisch vastelaovesrepertoire opleveren (vastelaovend, LVK, polonaise, ...).
 *
 * Per nummer bewaren we: titel, artiest, album, albumjaar, Deezer-track-id, hoes en of er een
 * fragment (preview) is. Het fragment zelf halen we niet op — Deezer-previews verlopen na een uur,
 * dus de app vraagt de actuele URL live op via /api/fragment.
 *
 * Gebruik:
 *   node scripts/haal-limburg.mjs                # volledige oogst -> data/bron/limburg-ruw.json
 *   node scripts/haal-limburg.mjs --proef 3      # alleen de eerste 3 artiesten, niets wegschrijven
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(WORTEL, 'data', 'bron', 'deezer-cache');
const UA = 'Sjpeelavond/1.0 (partyspel voor thuis)';

const args = process.argv.slice(2);
const PROEF = args.includes('--proef') ? parseInt(args[args.indexOf('--proef') + 1] || '3', 10) : 0;

/** Artiesten waarvan we de topnummers ophalen. 'vastelaovend' markeert bekende vastelaovesacts. */
const ARTIESTEN = [
  ['Rowwen Hèze', true], ['Beppie Kraft', true], ['Frans Theunisz', true], ['De Nachraove', true],
  ['Frans Pollux', true], ['Lex Uiting', true], ['Neet Oét Lottum', true], ['Janse Bagge Bend', true],
  ['Gé Reinders', true], ['De Zjweitvuit', true], ['Duo Ammezasie', true], ["'t Merretkoer", true],
  ['Ben Erkens', true], ['Wiel Vestjens', true], ['W-Dreej', true], ['Spik & Span', true],
  ['De Toddezèk', true], ['Hoondervel', true], ['Pruuf mar', true], ['Rempetemp', true],
  ['Bjorn & Mieke', true], ['La Bamba', true], ['De Geliënde', true], ['Böshuuske', true],
  ['Kartoesj', true], ['De Kuulköpkes', true], ['Thei & Marij', true], ['De Wazelvotte', true],
  ['Leon Volders', true], ['Jean Innemee', true], ['Frans Croonenberg', true], ['Peter Jansen', true],
  ['Gaston Jacobs', true], ['Dominique Reyners', true], ['Naud Reyners', true], ['Lei Driessen', true],
  ['Peter Eijkenboom', true], ['Frits Rademacher', true], ['Sjef Duchateau', true], ['Benny Neyman', false],
  ['Ziesjoem', true], ['De Zoervleisj', true], ['Vastelaovend Zitterd', true], ['Radio Nónnevot', true],
  ['Raoj', true], ['Graotekoeër', true], ['Eric Kooijman', true], ['Hans Wijnands', true],
  ['Wiel Knubben', true], ['Vastelaoveskoer', true], ['De Sjengs', true], ['Zoësj', true],
  ['Hannelore Winter', true], ['Quinn Warmerdam', true], ['Bas Keltjens', true], ['Bart Storcken', true],
  ['Niek Dirkx', true], ['René Verschueren', true], ['Frank Dullens', true], ['Maurice Pluijmakers', true],
  ['Jos Gijzen', true], ['Paul Münsterman', true], ['Roger Pisters', true], ['Julie Notermans', true],
  ["De Draag'beur", true], ['Neet te Gloëve', true], ['De Knöllekes', true], ["Ummer d'r Neaver", true],
];

/** Zoektermen die vastelaoves- en Limburgs repertoire opleveren. */
const ZOEKTERMEN = [
  'vastelaovend', 'vastelaovesleedje', 'LVK', 'carnaval Limburg', 'Zittesj', 'Limburgs carnaval',
  'polonaise Limburg', 'zaate hermeniekes', 'joekskapel', 'vastelaoveshit', 'Vastelaovend Zitterd',
  'Limburgs dialect liedje', 'Roermond vastelaovend', 'Maastricht carnaval', 'Venlo vastelaovend',
];

const dichtbij = (a, b) => a.includes(b) || b.includes(a);
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function deezer(pad, params = {}) {
  const sleutel = norm(pad + JSON.stringify(params)).replace(/ /g, '_').slice(0, 120);
  const bestand = path.join(CACHE, `${sleutel}.json`);
  if (existsSync(bestand)) return JSON.parse(await readFile(bestand, 'utf8'));
  const url = 'https://api.deezer.com/' + pad + (Object.keys(params).length ? '?' + new URLSearchParams(params) : '');
  let laatsteFout;
  for (let poging = 0; poging < 4; poging++) {
    try {
      const antwoord = await fetch(url, { headers: { 'user-agent': UA } });
      if (antwoord.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (poging + 1)));
        continue;
      }
      if (!antwoord.ok) throw new Error(`HTTP ${antwoord.status}`);
      const data = await antwoord.json();
      if (data?.error) throw new Error(data.error.message || JSON.stringify(data.error));
      await mkdir(CACHE, { recursive: true });
      await writeFile(bestand, JSON.stringify(data), 'utf8');
      await new Promise((r) => setTimeout(r, 130));
      return data;
    } catch (fout) {
      laatsteFout = fout;
      await new Promise((r) => setTimeout(r, 900 * (poging + 1)));
    }
  }
  console.error(`  ! Deezer ${pad}: ${laatsteFout?.message}`);
  return null;
}

function naarLied(track, herkomst) {
  if (!track?.id) return null;
  return {
    titel: (track.title_short || track.title || '').replace(/\s*\((?:19|20)\d\d[^)]*\)\s*$/, '').trim(),
    titelVolledig: track.title,
    artiest: track.artist?.name || '',
    album: track.album?.title || '',
    deezerId: track.id,
    deezerArtiestId: track.artist?.id || null,
    hoes: track.album?.cover_big || track.album?.cover_medium || null,
    heeftPreview: Boolean(track.preview),
    duur: track.duration || null,
    herkomst,
  };
}

const gezien = new Map(); // deezerId -> lied
const artiestIds = new Map(); // genormaliseerde naam -> {id, naam, vastelaovend}
const gevondenArtiesten = new Set();

async function zoekArtiest(naam) {
  const data = await deezer('search/artist', { q: naam, limit: 5 });
  if (!data?.data?.length) return null;
  const n = norm(naam);
  const treffer =
    data.data.find((a) => norm(a.name) === n) ||
    data.data.find((a) => dichtbij(norm(a.name), n)) ||
    data.data[0];
  return treffer;
}

const bron = PROEF ? ARTIESTEN.slice(0, PROEF) : ARTIESTEN;
console.log(`1) Topnummers van ${bron.length} artiesten ophalen ...`);
for (const [naam, vastelaovend] of bron) {
  const artiest = await zoekArtiest(naam);
  if (!artiest) {
    console.error(`  ! ${naam}: niet gevonden op Deezer`);
    continue;
  }
  artiestIds.set(norm(artiest.name), { id: artiest.id, naam: artiest.name, vastelaovend });
  const top = await deezer(`artist/${artiest.id}/top`, { limit: 30 });
  let aantal = 0;
  for (const track of top?.data || []) {
    const lied = naarLied(track, `artiest:${naam}`);
    if (!lied) continue;
    if (!gezien.has(lied.deezerId)) {
      gezien.set(lied.deezerId, lied);
      aantal++;
    }
  }
  console.log(`  ${naam} -> ${artiest.name} (${artiest.id}): ${aantal} nieuwe nummers`);
}

console.log(`\n2) Zoektermen ...`);
for (const term of PROEF ? ZOEKTERMEN.slice(0, 2) : ZOEKTERMEN) {
  const data = await deezer('search', { q: term, limit: 100, order: 'RANKING' });
  let aantal = 0;
  for (const track of data?.data || []) {
    const lied = naarLied(track, `zoekterm:${term}`);
    if (!lied) continue;
    if (!gezien.has(lied.deezerId)) {
      gezien.set(lied.deezerId, lied);
      aantal++;
      if (lied.deezerArtiestId) gevondenArtiesten.add(lied.deezerArtiestId);
    }
  }
  console.log(`  "${term}": ${aantal} nieuwe nummers`);
}

const nummers = [...gezien.values()].filter((l) => l.heeftPreview);
console.log(`\nTotaal gevonden: ${gezien.size}, met fragment: ${nummers.length}`);

if (!PROEF) {
  const doel = path.join(WORTEL, 'data', 'bron', 'limburg-ruw.json');
  await mkdir(path.dirname(doel), { recursive: true });
  await writeFile(
    doel,
    JSON.stringify(
      {
        bron: 'Deezer-API (api.deezer.com): topnummers van Limburgse artiesten + vastelaoves-zoektermen',
        licentie: 'Deezer levert alleen metadata en 30-secondenfragmenten; er wordt geen audio bewaard',
        opgehaald: new Date().toISOString().slice(0, 10),
        aantal: nummers.length,
        artiesten: [...artiestIds.values()],
        nummers,
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log(`Weggeschreven: ${path.relative(WORTEL, doel)}`);
}
