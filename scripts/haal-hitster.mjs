#!/usr/bin/env node
/**
 * haal-hitster.mjs — de kaartnummers van Hitster omzetten in liedjes.
 *
 * Een Hitster-kaartje heeft een QR-code met daarin
 *   www.hitstergame.com/<taal>/<editie>/<kaartnummer>
 * en Jumbo publiceert zelf de tabel die elk kaartnummer aan een Spotify-nummer koppelt.
 * Die tabel halen we hier op en we bewaren alleen wat de app nodig heeft: per editie
 * het kaartnummer en het Spotify-nummer. De titel, de artiest, het jaartal en het
 * fragment haalt de app zelf op bij het scannen (zie public/js/kaart.js) — dat scheelt
 * tienduizenden verzoeken en de fragmenten blijven zo vers.
 *
 *   node scripts/haal-hitster.mjs [--alles]
 *
 * Zonder --alles worden alleen de Nederlandse en Benelux-edities bewaard (klein bestand);
 * met --alles komen alle 176 edities mee, zodat ook een Duitse of Spaanse doos werkt.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HIER, '..');
const BRON = path.join(ROOT, 'data/bron/hitster-gamesets.json');
const DOEL = path.join(ROOT, 'data/hitster.json');
const URL_BRON = 'https://hitster.jumboplay.com/hitster-assets/gameset_database.json';

// De landen waarvan we de edities standaard meebundelen: een Nederlandse doos is het
// meest waarschijnlijk, en de Benelux-editie hangt daar tegenaan.
const THUISLANDEN = ['netherlands', 'benelux'];

const alles = process.argv.includes('--alles');

if (!existsSync(BRON)) {
  console.error(`De brontabel ontbreekt: ${BRON}`);
  console.error(`Haal hem op met:  curl -sSL -o data/bron/hitster-gamesets.json ${URL_BRON}`);
  process.exit(1);
}

const ruw = JSON.parse(readFileSync(BRON, 'utf8'));
if (!Array.isArray(ruw.gamesets)) {
  console.error('Onverwachte vorm van de brontabel (geen gamesets-lijst).');
  process.exit(1);
}

const edities = {};
const kaarten = {};
let kaartenTotaal = 0;
let dubbel = 0;

for (const spel of ruw.gamesets) {
  const gegevens = spel.gameset_data || {};
  const land = String(gegevens.gameset_language || '').trim().toLowerCase();
  if (!alles && !THUISLANDEN.includes(land)) continue;
  const nummers = {};
  for (const kaart of gegevens.cards || []) {
    const nummer = String(kaart.CardNumber || '').trim();
    const spotify = String(kaart.Spotify || '').trim();
    if (!nummer || !spotify) continue;
    if (nummers[nummer]) dubbel++;
    nummers[nummer] = spotify;
  }
  if (!Object.keys(nummers).length) continue;
  edities[spel.sku] = {
    taal: String(gegevens.gameset_language || '').trim(),
    naam: String(gegevens.gameset_name || '').trim(),
  };
  kaarten[spel.sku] = nummers;
  kaartenTotaal += Object.keys(nummers).length;
}

const uit = {
  bron: URL_BRON,
  bronBijgewerkt: new Date((ruw.updated_on || 0) * 1000).toISOString().slice(0, 10),
  opgehaald: new Date().toISOString().slice(0, 10),
  alles,
  edities,
  kaarten,
};

writeFileSync(DOEL, JSON.stringify(uit, null, 0) + '\n');
const bytes = readFileSync(DOEL).length;
console.log(`${Object.keys(edities).length} edities, ${kaartenTotaal} kaarten (${dubbel} dubbele kaartnummers binnen een editie)`);
for (const [sku, editie] of Object.entries(edities)) {
  console.log(`  ${sku}  ${editie.taal.padEnd(12)} ${editie.naam.padEnd(34)} ${Object.keys(kaarten[sku]).length} kaarten`);
}
console.log(`Weggeschreven: ${path.relative(ROOT, DOEL)} (${(bytes / 1024).toFixed(0)} kB)`);
