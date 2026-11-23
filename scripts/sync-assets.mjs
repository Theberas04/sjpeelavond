#!/usr/bin/env node
/**
 * sync-assets.mjs — de webapp in de Android-app zetten.
 *
 * De app is één bundel: de pagina uit `public/` en de muziekdatabase uit `data/`
 * horen in `android/app/src/main/assets/www/`. Dat is afgeleid werk, dus het staat
 * niet in git maar wordt bij elke bouw opnieuw gemaakt — en meteen gecontroleerd,
 * want een bestand dat de pagina vraagt en dat niet meekomt, valt pas op het toestel op.
 *
 *   node scripts/sync-assets.mjs
 *   node scripts/sync-assets.mjs --check     (alleen controleren, niets schrijven)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HIER, '..');
const BRON = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const DOEL = path.join(ROOT, 'android/app/src/main/assets');
const ALLEEN_CONTROLEREN = process.argv.includes('--check');

const DATABESTANDEN = ['index.json', 'nummers-hits.json', 'nummers-limburg.json', 'hitster.json'];

function bouw() {
  rmSync(DOEL, { recursive: true, force: true });
  mkdirSync(path.join(DOEL, 'data'), { recursive: true });
  cpSync(BRON, DOEL, { recursive: true });
  for (const bestand of DATABESTANDEN) {
    const bron = path.join(DATA, bestand);
    if (!existsSync(bron)) throw new Error(`Ontbreekt: ${bron} (draai eerst node scripts/bouw-dataset.mjs)`);
    cpSync(bron, path.join(DOEL, 'data', bestand));
  }
}

function controleer() {
  const fouten = [];
  const index = readFileSync(path.join(DOEL, 'index.html'), 'utf8');

  // De pagina zelf is de autoriteit over wat er moet zijn: elke src/href in index.html
  // moet in de bundel staan. Een nieuw script dat het bundelscript niet kent valt hier om.
  const verwijzingen = [
    ...index.matchAll(/(?:src|href)="\/([^"]+)"/g),
  ].map((m) => m[1]);
  for (const verwijzing of new Set(verwijzingen)) {
    const pad = path.join(DOEL, verwijzing);
    if (!existsSync(pad)) {
      fouten.push(`de pagina vraagt /${verwijzing} en dat zit niet in de bundel`);
      continue;
    }
    if (statSync(pad).size === 0) fouten.push(`/${verwijzing} is leeg`);
  }

  // De onderdelen waar de app niet zonder kan.
  const verplicht = [
    'index.html',
    'js/app.js',
    'js/spel.js',
    'js/lokaal.js',
    'js/kaart.js',
    'js/fragment.js',
    'js/update.js',
    'data/index.json',
    'data/nummers-hits.json',
    'data/nummers-limburg.json',
    'data/hitster.json',
  ];
  for (const bestand of verplicht) {
    if (!existsSync(path.join(DOEL, bestand))) fouten.push(`${bestand} ontbreekt in de bundel`);
  }

  // En de modules die de scripts zelf inladen. De pagina vraagt alleen app.js en lokaal.js
  // (dat zijn de <script type="module">-regels), maar die halen op hun beurt spel.js,
  // kaart.js, fragment.js en update.js op. Staat zo'n bestand niet in de bundel, dan werkt
  // de app in de browser en niet in de app — precies het verschil dat je niet ziet.
  const ingeladen = new Set();
  for (const bestand of verplicht.filter((b) => b.endsWith('.js'))) {
    const heel = path.join(DOEL, bestand);
    if (!existsSync(heel)) continue;
    for (const m of readFileSync(heel, 'utf8').matchAll(/from\s+['"]\.\/([\w.-]+\.js)['"]/g)) {
      ingeladen.add(`js/${m[1]}`);
    }
  }
  for (const module of ingeladen) {
    if (!existsSync(path.join(DOEL, module))) {
      fouten.push(`een script laadt ${module} in en dat zit niet in de bundel`);
    }
  }

  // En de inhoud: een lege of halfgeschreven database mag niet groen door.
  let hits = 0;
  let limburg = 0;
  if (existsSync(path.join(DOEL, 'data/nummers-hits.json'))) {
    hits = JSON.parse(readFileSync(path.join(DOEL, 'data/nummers-hits.json'), 'utf8')).nummers?.length || 0;
  }
  if (existsSync(path.join(DOEL, 'data/nummers-limburg.json'))) {
    limburg = JSON.parse(readFileSync(path.join(DOEL, 'data/nummers-limburg.json'), 'utf8')).nummers?.length || 0;
  }
  if (hits < 100) fouten.push(`de hitlijst in de bundel heeft maar ${hits} nummers`);
  if (limburg < 100) fouten.push(`het Limburgse repertoire in de bundel heeft maar ${limburg} nummers`);

  return { fouten, hits, limburg, bestanden: verwijzingen.length };
}

function groottetotaal(map) {
  let totaal = 0;
  const loop = (pad) => {
    for (const deel of readdirSync(pad, { withFileTypes: true })) {
      const vol = path.join(pad, deel.name);
      if (deel.isDirectory()) loop(vol);
      else totaal += statSync(vol).size;
    }
  };
  loop(map);
  return totaal;
}

if (!ALLEEN_CONTROLEREN) {
  bouw();
  console.log(`Bundel gemaakt in android/app/src/main/assets`);
}
const { fouten, hits, limburg, bestanden } = controleer();
for (const fout of fouten) console.error(`  ! ${fout}`);
if (fouten.length) {
  console.error(`Bundel onvolledig: ${fouten.length} fout(en).`);
  process.exit(1);
}
console.log(
  `Bundel compleet: ${hits} hit-nummers + ${limburg} Limburgse nummers, ` +
    `${bestanden} verwijzingen uit de pagina nagelopen, ${Math.round(groottetotaal(DOEL) / 1024)} kB.`,
);
