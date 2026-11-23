#!/usr/bin/env node
/**
 * bouw-dataset.mjs — bouwt uit de ruwe oogst de definitieve dataset van Sjpeelavond.
 *
 * Invoer (data/bron/):
 *   top40.json          nummer 1-hits uit de Nederlandse Top 40 (nl.wikipedia.org)
 *   hits-verrijkt.json  diezelfde hits met Deezer-id en hoes
 *   limburg-ruw.json    Limburgs/vastelaovesrepertoire met Deezer-id en hoes
 *   limburg-jaar.json   jaartallen van dat repertoire (MusicBrainz/Deezer)
 *   lvk.json            LVK-inzendingen per jaar (optioneel)
 *
 * Uitvoer (data/):
 *   nummers-hits.json     id 1 .. 99999
 *   nummers-limburg.json  id 100000 .. 199999
 *   index.json            dekkingslijst met aantallen (de app laadt dit als eerste)
 *   rapport.json          wat er in en uit ging, met redenen
 *
 * Gebruik: node scripts/bouw-dataset.mjs
 */
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRON = path.join(WORTEL, 'data', 'bron');
const DATA = path.join(WORTEL, 'data');

const lees = async (naam, standaard = null) =>
  existsSync(path.join(BRON, naam)) ? JSON.parse(await readFile(path.join(BRON, naam), 'utf8')) : standaard;

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:radio|single|album|original|remaster|live|feat|versie|version)[^)]*\)/g, ' ')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const sleutel = (titel, artiest) => norm(titel) + '|' + norm(artiest);

/* ── curate lijsten ────────────────────────────────────────────────────── */

/** Artiesten die vastelaovesmuziek maken (hun hele repertoire hoort bij het vastelaovesdek). */
const VASTELAOVESARTIESTEN = new Set(
  [
    'beppie kraft', 'frans theunisz', 'de nachraove', 'de zjweitvuit', 'w dreej', 'spik span',
    'de toddezek', 'hoondervel', 'pruuf mar', 'rempetemp', 'bjorn mieke', 'la bamba', 'de geliende',
    'boshuuske', 'kartoesj', 'de kuulkopkes', 'thei marij', 'de wazelvotte', 'ziesjoem',
    'duo ammezasie', 't merretkoer', 'gaston zien vastelaovesvrung', 'leon volders', 'radio nonnevot',
    'frans croonenberg', 'peter jansen', 'dominique reyners', 'naud reyners', 'lei driesen',
    'peter eijkenboom', 'de ragtime band', 'ben erkens', 'wiel vestjens', 'hay crompvoets',
    'hannelore winter', 'quinn warmerdam', 'bas keltjens', 'bart storcken', 'niek dirkx',
    'rene verschueren', 'frank dullens', 'maurice pluijmakers', 'jos gijzen', 'paul munsterman',
    'roger pisters', 'julie notermans', 'det mot kenney', 'det mot kenne', 'graotekoeer', 'raoj ns',
    'de knollekes', 'neet te gloeve', 'ummer d r neaver', 'de draag beur', 'vastelaoveskoer',
    'de sjengs', 'zoesj', 'hans wijnands', 'wiel knubben', 'eric kooijman', 'ben erkens the country singers',
  ].map(norm),
);

/** Artiesten uit Sittard en omstreken (voor het Zittesje dek van Hittepetit). */
const ZITTESJE_ARTIESTEN = new Set(
  ['frans theunisz', 'de nachraove', 'radio nonnevot', 'de draag beur', 'vastelaovend zitterd', 'zjeng kraft', 'ziesjoem'].map(norm),
);

/** Nederlandse artiesten (voor het dek 'nederland'). */
const NEDERLANDSE_ARTIESTEN = new Set(
  [
    'andre hazes', 'frans bauer', 'guus meeuwis', 'marco borsato', 'anouk', 'blof', 'doe maar',
    'golden earring', 'het goede doel', 'van dik hout', 'de dijk', 'normaal', 'rowwen heze',
    'ilse de lange', 'trijntje oosterhuis', 'anita meijer', 'gerard joling', 'jan smit', 'rene froger',
    'gordon', 'jeroen van der boom', 'nick simon', 'claudia de breij', 'acda en de munnik',
    'jeroen van koningsbrugge', 'kensington', 'chef special', 'dotsan', 'racoon', 'johan',
    'the scene', 'de kreuners', 'clouseau', 'mama s jas', 'bart van den bossche', 'vaya con dios',
    'raffaella carra', 'twarres', 'sita', 'niels geusebroek', 'jacqueline goot', 'rob de nijs',
    'boudewijn de groot', 'ramses shaffy', 'liesbeth list', 'willeke alberti', 'herman van veen',
    'harry smit', 'de vliegende panters', 'toontje lager', 'hetty blok', 'adele blom',
    'benny neyman', 'pierre kartner', 'vader abraham', 'corry konings', 'koos alberts',
    'marianne weber', 'deurzakkers', 'gebroeders ko', 'lawine boys', 'josti band',
    'one two trio', 'de sjonnies', 'gebrueder ko', 'snollebollekes', 'de jeugd van tegenwoordig',
    'partysquad', 'kraantje pappie', 'frenna', 'broederliefde', 'lil kleine', 'sevn alias',
    'suzan fruytier', 'maan', 'duncan laurence', 'davina michelle', 's10', 'froukje', 'merol',
    'goldband', 'de bankzitters', 'antoon', 'meau', 'yves berendse', 'claude', 'zoë livay',
    'daan boom', 'emma heesters', 'teddy scholten', 'willem duyn', 'motions', 'zz en de maskers',
    'q65', 'shocking blue', 'the cats', 'sandra en andres', 'mouth en macneal', 'george baker selection',
    'teach in', 'pussycat', 'luv', 'dolly dots', 'bzn', 'maywood', 'toontje lager',
  ].map(norm),
);

const isVastelaovesartiest = (artiest) => {
  const a = norm(artiest);
  return [...VASTELAOVESARTIESTEN].some((v) => a === v || a.includes(v) || v.includes(a));
};
const isZittesj = (artiest) => {
  const a = norm(artiest);
  return [...ZITTESJE_ARTIESTEN].some((v) => a === v || a.includes(v) || v.includes(a));
};
const isNederlands = (artiest) => {
  const a = norm(artiest);
  return [...NEDERLANDSE_ARTIESTEN].some((v) => a === v || a.includes(v) || v.includes(a));
};

const VASTELAOVESWOORDEN =
  /vastelaov|vastenach|vastelaovend|carnaval|polonaise|joeks|alaaf|zitting|prins |nar |hermeniek|leedje|sjlager|11e van de 11e|konkoer|lvk|de vastelaovend|vrouw carnaval/i;

/* ── hits ──────────────────────────────────────────────────────────────── */

const rapport = { gemaakt: new Date().toISOString().slice(0, 10), hits: {}, limburg: {}, dekken: {} };

const hitsVerrijkt = await lees('hits-verrijkt.json');
if (!hitsVerrijkt) {
  console.error('data/bron/hits-verrijkt.json ontbreekt — draai eerst scripts/verrijk-hits.mjs');
  process.exit(1);
}

const hits = [];
const hitsOvergeslagen = [];
let hitId = 1;
for (const nummer of hitsVerrijkt.nummers) {
  if (!nummer.jaar || nummer.jaar < 1900 || nummer.jaar > 2100) {
    hitsOvergeslagen.push({ ...nummer, reden: 'geen bruikbaar jaartal' });
    continue;
  }
  if (!nummer.heeftPreview || !nummer.deezerId) {
    hitsOvergeslagen.push({ ...nummer, reden: 'geen fragment bij Deezer' });
    continue;
  }
  const dekken = ['hits'];
  if (isNederlands(nummer.artiest)) dekken.push('nederland');
  hits.push({
    id: hitId++,
    titel: nummer.titel,
    artiest: nummer.artiest,
    jaar: nummer.jaar,
    jaarBron: 'Hitjaar volgens de Nederlandse Top 40 (nl.wikipedia.org)',
    hitjaar: nummer.jaar,
    album: nummer.album || null,
    deezerId: nummer.deezerId,
    hoes: nummer.hoes || null,
    dekken,
    soort: 'hit',
    taal: isNederlands(nummer.artiest) ? 'nl' : 'anders',
    bron: 'nl.wikipedia.org — lijst van nummer 1-hits in de Nederlandse Top 40',
  });
}

/* ── Limburgs repertoire ───────────────────────────────────────────────── */

const limburgRuw = await lees('limburg-ruw.json');
const limburgJaar = (await lees('limburg-jaar.json'))?.jaren || {};
const lvk = await lees('lvk.json');
const lvkTitels = new Set((lvk?.nummers || []).map((n) => norm(n.titel)).filter(Boolean));
const lvkCombinaties = new Set((lvk?.nummers || []).map((n) => sleutel(n.titel, n.uitvoerende)).filter(Boolean));

const limburg = [];
const limburgOvergeslagen = [];
const gezienLimburg = new Map();
let limburgId = 100000;

for (const nummer of limburgRuw?.nummers || []) {
  const jaarInfo = limburgJaar[nummer.deezerId];
  if (!jaarInfo?.jaar) {
    limburgOvergeslagen.push({ ...nummer, reden: 'geen jaartal bekend' });
    continue;
  }
  if (jaarInfo.jaar < 1930 || jaarInfo.jaar > 2100) {
    limburgOvergeslagen.push({ ...nummer, reden: 'onwaarschijnlijk jaartal' });
    continue;
  }
  const sleutelLied = sleutel(nummer.titel, nummer.artiest);
  const bestaand = gezienLimburg.get(sleutelLied);
  if (bestaand) {
    // Zelfde liedje uit een ander album: het vroegste jaartal wint.
    if (jaarInfo.jaar < bestaand.jaar) {
      bestaand.jaar = jaarInfo.jaar;
      bestaand.jaarBron = jaarInfo.jaarBron;
      bestaand.deezerId = nummer.deezerId;
      bestaand.hoes = nummer.hoes;
      bestaand.album = nummer.album;
    }
    continue;
  }

  const vastelaovend =
    isVastelaovesartiest(nummer.artiest) ||
    VASTELAOVESWOORDEN.test(nummer.titel || '') ||
    VASTELAOVESWOORDEN.test(nummer.album || '');
  const titelNorm = norm(nummer.titel);
  const artiestNorm = norm(nummer.artiest);
  const inLvkLijst =
    lvkTitels.has(titelNorm) ||
    lvkCombinaties.has(sleutelLied) ||
    [...lvkCombinaties].some((c) => c.split('|')[0] === titelNorm && c.split('|')[1] && artiestNorm.includes(c.split('|')[1]));
  // lvk: true = in de LVK-lijst, false = zeker geen inzending (geen vastelaovesliedje), null = onbekend.
  const lvkVlag = inLvkLijst ? true : vastelaovend ? null : false;

  const dekken = ['limburg'];
  if (vastelaovend) dekken.push('vastelaovend');
  if (isZittesj(nummer.artiest)) dekken.push('zittesj');
  if (lvkVlag !== null) dekken.push('lvk');

  const lied = {
    id: limburgId++,
    titel: nummer.titel,
    artiest: nummer.artiest,
    jaar: jaarInfo.jaar,
    jaarBron: jaarInfo.jaarBron,
    album: nummer.album || null,
    deezerId: nummer.deezerId,
    hoes: nummer.hoes || null,
    dekken,
    soort: vastelaovend ? 'vastelaovend' : 'limburg',
    taal: 'li',
    lvk: lvkVlag,
    regio: isZittesj(nummer.artiest) ? 'Sittard' : null,
    bron: `Deezer (${nummer.herkomst})`,
  };
  gezienLimburg.set(sleutelLied, lied);
  limburg.push(lied);
}

/* ── wegschrijven ──────────────────────────────────────────────────────── */

const dekken = [
  { id: 'hits', naam: 'Grote hits', beschrijving: 'Alle nummer 1-hits uit de Nederlandse Top 40, 1965 tot nu.', aantal: hits.length },
  { id: 'nederland', naam: 'Nederlandstalig', beschrijving: 'De nummer 1-hits van Nederlandse artiesten.', aantal: hits.filter((h) => h.dekken.includes('nederland')).length },
  { id: 'limburg', naam: 'Limburgs', beschrijving: 'Limburgs repertoire: dialectpop, rock en vastelaovesklassiekers.', aantal: limburg.length },
  { id: 'vastelaovend', naam: 'Vastelaovend', beschrijving: 'Vastelaovesmuziek uit heel Limburg.', aantal: limburg.filter((h) => h.dekken.includes('vastelaovend')).length },
  { id: 'zittesj', naam: 'Zittesj', beschrijving: 'Zittesje vastelaovesmuziek (Frans Theunisz, De Nachraove, Radio Nónnevot).', aantal: limburg.filter((h) => h.dekken.includes('zittesj')).length },
  { id: 'lvk', naam: 'LVK', beschrijving: 'Liedjes waarvan zeker is of ze een LVK-inzending waren.', aantal: limburg.filter((h) => h.dekken.includes('lvk')).length },
];

await writeFile(
  path.join(DATA, 'nummers-hits.json'),
  JSON.stringify(
    {
      bron: 'nl.wikipedia.org (nummer 1-hits Nederlandse Top 40) + Deezer (hoes en fragment)',
      licentie:
        'Feitelijke hitgegevens van Wikipedia (CC BY-SA 4.0). Geen audio in dit bestand: de app speelt het 30-secondenfragment dat Deezer zelf publiceert.',
      aantal: hits.length,
      nummers: hits,
    },
    null,
    1,
  ),
  'utf8',
);

await writeFile(
  path.join(DATA, 'nummers-limburg.json'),
  JSON.stringify(
    {
      bron: 'Deezer (Limburgse artiesten en vastelaoveszoektermen) + jaartallen uit MusicBrainz/Deezer',
      licentie: 'Alleen metadata en Deezer-fragmenten; geen audio opgeslagen.',
      aantal: limburg.length,
      nummers: limburg,
    },
    null,
    1,
  ),
  'utf8',
);

const index = {
  versie: 1,
  gemaakt: new Date().toISOString().slice(0, 10),
  bestanden: ['nummers-hits.json', 'nummers-limburg.json'],
  totalen: { hits: hits.length, limburg: limburg.length, samen: hits.length + limburg.length },
  dekken,
};
await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 1), 'utf8');

rapport.hits = {
  gematcht: hitsVerrijkt.nummers.length,
  opgenomen: hits.length,
  overgeslagen: hitsOvergeslagen.length,
  redenen: hitsOvergeslagen.reduce((acc, n) => ({ ...acc, [n.reden]: (acc[n.reden] || 0) + 1 }), {}),
};
rapport.limburg = {
  ruw: (limburgRuw?.nummers || []).length,
  opgenomen: limburg.length,
  overgeslagen: limburgOvergeslagen.length,
  zonderJaartal: limburgOvergeslagen.filter((n) => n.reden === 'geen jaartal bekend').length,
  vastelaovend: limburg.filter((h) => h.dekken.includes('vastelaovend')).length,
  lvkJa: limburg.filter((h) => h.lvk === true).length,
  lvkNee: limburg.filter((h) => h.lvk === false).length,
  lvkOnbekend: limburg.filter((h) => h.lvk === null).length,
  lvkLijst: lvk?.aantal ?? 0,
};
rapport.dekken = dekken.map((d) => `${d.naam}: ${d.aantal}`);
await writeFile(path.join(DATA, 'rapport.json'), JSON.stringify(rapport, null, 1), 'utf8');

console.log('Dataset gebouwd:');
console.log(`  hits:     ${hits.length} nummers (${hitsOvergeslagen.length} overgeslagen)`);
console.log(`  limburg:  ${limburg.length} nummers (${limburgOvergeslagen.length} overgeslagen, waarvan ${rapport.limburg.zonderJaartal} zonder jaartal)`);
for (const d of dekken) console.log(`  dek ${d.id.padEnd(12)} ${String(d.aantal).padStart(5)}  ${d.naam}`);
console.log(`  LVK-vlag: ja ${rapport.limburg.lvkJa} / nee ${rapport.limburg.lvkNee} / onbekend ${rapport.limburg.lvkOnbekend} (LVK-lijst: ${rapport.limburg.lvkLijst} regels)`);
const jarenHits = hits.map((h) => h.jaar);
const jarenLim = limburg.map((h) => h.jaar);
if (jarenHits.length) console.log(`  jaren hits: ${Math.min(...jarenHits)}-${Math.max(...jarenHits)}, limburg: ${Math.min(...jarenLim)}-${Math.max(...jarenLim)}`);
