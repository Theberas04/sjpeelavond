#!/usr/bin/env node
/**
 * haal-lvk.mjs — verzamelt LVK-inzendingen (Limburgs Vastelaovesleedjes Konkoer)
 * die publiek traceerbaar zijn: winnaars (1977-2026, nl.wikipedia.org) en, per
 * jaargang waarvoor een bron bestaat, de liedjes die de halve finale of de
 * finale haalden (L1 / l1.nl, l1nieuws.nl en stichtinglvk.nl).
 *
 * De ruwe pagina's staan in data/bron/lvk-cache/*.html (elk bestand is
 * <jaar>-<soort>.html) plus wikipedia-lvk.txt. Dit script hergenereert
 * data/bron/lvk.json volledig uit die cache — er wordt niets verzonnen en een
 * jaargang zonder cachebestand wordt simpelweg overgeslagen.
 *
 * Gebruik:
 *   node scripts/haal-lvk.mjs            # leest cache, schrijft lvk.json, print rapport
 *   node scripts/haal-lvk.mjs --proef    # parseert wel, schrijft niets weg
 *   node scripts/haal-lvk.mjs --print    # print per bron alle geparseerde regels
 *
 * Uitvoer-schema (data/bron/lvk.json):
 *   { bron, opgehaald, aantal, perJaar:{ jaar: aantal }, nummers:[
 *       { jaar, titel, uitvoerende, ronde:"halve finale|finale|winnaar", bronUrl } ] }
 *
 * Licentie: alleen feitelijke gegevens (jaar, titel, uitvoerende, ronde)
 * overgenomen uit de genoemde publieke bronnen; geen opmaak of teksten.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(WORTEL, 'data', 'bron', 'lvk-cache');
const DOEL = path.join(WORTEL, 'data', 'bron', 'lvk.json');
const WIKI_URL =
  'https://nl.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&page=Limburgs_Vastelaovesleedjes_Konkoer';

const args = process.argv.slice(2);
const PROEF = args.includes('--proef');
const PRINT = args.includes('--print');

/* ------------------------------------------------------------------ *
 * Tekst-helpers
 * ------------------------------------------------------------------ */

/** Wikitext/HTML -> platte tekst (voor de winnaarstabel). */
function schoonWiki(s) {
  let vorige;
  do {
    vorige = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, ' ');
  } while (s !== vorige);
  return s
    .replace(/<ref[^>]*\/>/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** HTML -> platte tekst; tags worden regeleindes zodat lijsten leesbaar blijven. */
function stripHtml(h) {
  return h
    .replace(/\\r\\n|\\n/g, '\n') // sommige pagina's bevatten letterlijke \n-escapes
    .replace(/\\t/g, '\t')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8211;/g, '\u2013')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map((r) => r.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Normaliseer voor vergelijking/dedupe. */
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Netjes maken van een titel/naam: overtollige spaties, quotes rechtzetten. */
function netjes(s) {
  return (s || '')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+([,!.?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dedupliceer binnen één bron op jaar+titel+uitvoerende. */
function ontdubbel(rijen) {
  const gezien = new Set();
  return rijen.filter((r) => {
    const k = r.jaar + '|' + norm(r.titel) + '|' + norm(r.uitvoerende);
    if (gezien.has(k)) return false;
    gezien.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * 1. Winnaars (nl.wikipedia.org)
 * ------------------------------------------------------------------ */
function leesWinnaars() {
  const bestand = path.join(CACHE, 'wikipedia-lvk.txt');
  if (!existsSync(bestand)) return [];
  const wikitext = readFileSync(bestand, 'utf8');
  const blok = wikitext.split('===Winnende nummers===')[1]?.split('===Overwinningen per plaats===')[0];
  if (!blok) return [];
  const uit = [];
  for (const rij of blok.split(/^\|-/m)) {
    const cellen = rij
      .split(/\n\s*\|/)
      .map((c) => c.replace(/^\|/, '').trim())
      .filter(Boolean)
      .flatMap((c) => (c.includes('||') ? c.split('||') : [c]))
      .map((c) => c.trim())
      .filter(Boolean);
    const jaarIdx = cellen.findIndex((c) => /^\d{4}$/.test(c));
    if (jaarIdx < 0) continue;
    const jaar = parseInt(cellen[jaarIdx], 10);
    const titel = schoonWiki(cellen[jaarIdx + 1] || '');
    const uitvoerende = schoonWiki(cellen[jaarIdx + 4] || '');
    if (!jaar || !titel) continue;
    uit.push({ jaar, titel, uitvoerende, ronde: 'winnaar', bronUrl: WIKI_URL });
  }
  return uit;
}

/* ------------------------------------------------------------------ *
 * 2. Bronlijsten (L1 / stichtinglvk)
 *
 * Elk item heeft:
 *   jaar, ronde, bestand, url, formaat, begin (marker), eind (marker, optioneel)
 * Formaten:
 *   'act-titel-plaats'      Act - Titel (Plaats)
 *   'titel-act-plaats'      Titel - Act (Plaats)
 *   'titel-plaats'          Titel - Plaats            (uitvoerende onbekend)
 *   'titel-plaats-act'      Titel - Plaats - Act
 *   'titel-plaats-(act)'    Titel - Plaats (Act)
 *   'act-titel'             Act - Titel               (LVK-finalist / kale lijst)
 *   'act-titel-plaats3'     Act - Titel - Plaats
 *   'tab-titel-plaats'      N<TAB>Titel<TAB>Plaats
 *   'tabel-titel-plaats'    N \n Titel \n Plaats
 *   'tabel-titel-act-plaats' N \n Titel \n Act \n Plaats
 * ------------------------------------------------------------------ */
const BRONNEN = [
  // --- halve finales ---
  { jaar: 2011, ronde: 'halve finale', bestand: '2011-halvefinale.html', url: 'https://www.l1.nl/nieuws/2440683/halve-finalisten-lvk-2011-bekend', formaat: 'titel-plaats', begin: 'Indeling van de 3 halve finales' },
  { jaar: 2013, ronde: 'halve finale', bestand: '2013-halvefinale.html', url: 'https://www.l1.nl/nieuws/2496791/halve-finalisten-lvk-2013-zijn-bekend', formaat: 'titel-plaats', begin: 'zijn doorgedrongen tot de halve finales' },
  { jaar: 2018, ronde: 'halve finale', bestand: '2018-halvefinale.html', url: 'https://www.l1.nl/nieuws/2498871/de-60-halve-finalisten-lvk-2018-zijn-bekend', formaat: 'tab-scan-titel-plaats', begin: 'De 60 halve finalisten van het 42ste LVK' },
  { jaar: 2021, ronde: 'halve finale', bestand: '2021-halvefinale.html', url: 'https://www.l1.nl/nieuws/2498918/deze-45-liedjes-gaan-door-naar-halve-finales-lvk-2021', formaat: 'act-titel-plaats', begin: 'Doorgedrongen tot de 3 halve finales' },
  { jaar: 2022, ronde: 'halve finale', bestand: '2022-halvefinale.html', url: 'https://www.l1.nl/44-halve-finalisten-lvk-2022-bekend-168317/', formaat: 'tabel-titel-plaats', begin: 'De halve finalisten (per regio)' },
  { jaar: 2023, ronde: 'halve finale', bestand: '2023-halvefinale.html', url: 'https://l1nieuws.nl/entertainment/1907623/zestig-deelnemers-halve-finales-lvk-2023-bekend', formaat: 'act-titel-plaats', begin: 'Doorgedrongen tot de drie halve finales' },
  { jaar: 2024, ronde: 'halve finale', bestand: '2024-halvefinale.html', url: 'https://l1nieuws.nl/nieuws/2342906/dit-zijn-de-60-halvefinalisten-van-het-lvk-2024', formaat: 'act-titel-plaats', begin: 'Hieronder staan alle liedjes op een rijtje' },
  { jaar: 2025, ronde: 'halve finale', bestand: '2025-halvefinale.html', url: 'https://l1nieuws.nl/entertainment/2809781/dit-zijn-de-60-halvefinalisten-voor-het-lvk-2025', formaat: 'act-titel-plaats', begin: 'Hieronder staan de drie halve finales' },
  { jaar: 2026, ronde: 'halve finale', bestand: '2026-halvefinale.html', url: 'https://l1.nl/nieuws/3061318/dit-zijn-de-60-halvefinalisten-van-het-lvk', formaat: 'titel-act-plaats', begin: 'met daarin de volgende kandidaten' },

  // --- finales ---
  { jaar: 2013, ronde: 'finale', bestand: '2013-finale.html', url: 'https://www.l1.nl/nieuws/2413246/bekendmaking-finalisten-lvk-2013', formaat: 'titel-plaats-(act)', begin: 'Naar de finale:' },
  { jaar: 2014, ronde: 'finale', bestand: '2014-finale.html', url: 'https://www.l1.nl/nieuws/2388962/lijst-van-19-finalisten-lvk-2014', formaat: 'tabel-titel-act-plaats', begin: 'UITKOMEND VOOR:' },
  { jaar: 2016, ronde: 'finale', bestand: '2016-finale.html', url: 'https://www.l1.nl/nieuws/2380918/de-finalisten-van-het-lvk-2016-zijn-bekend', formaat: 'titel-plaats-act', begin: 'De finalisten van 2016:' },
  { jaar: 2018, ronde: 'finale', bestand: '2018-finale.html', url: 'https://www.l1.nl/nieuws/2508733/dit-zijn-de-20-finalisten-van-het-lvk-2018', formaat: 'act-titel', begin: 'LVK-finalist 1:' },
  { jaar: 2019, ronde: 'finale', bestand: '2019-finale.html', url: 'https://www.l1.nl/nieuws/2508754/dit-zijn-de-20-finalisten-van-het-lvk-2019', formaat: 'act-titel', begin: 'LVK-Finalist 1:' },
  { jaar: 2020, ronde: 'finale', bestand: '2020-finale.html', url: 'https://www.l1.nl/nieuws/2508775/dit-zijn-de-20-finalisten-van-het-lvk-2020', formaat: 'act-titel', begin: 'LVK-Finalist 1:' },
  { jaar: 2021, ronde: 'finale', bestand: '2021-finale.html', url: 'https://www.l1.nl/nieuws/2508777/dit-zijn-de-20-finalisten-van-het-lvk-2021', formaat: 'act-titel', begin: 'LVK-Finalist 1:' },
  { jaar: 2022, ronde: 'finale', bestand: '2022-finale.html', url: 'https://www.l1.nl/nieuws/2508783/dit-zijn-ze-dan-de-20-finalisten-van-het-lvk-2022', formaat: 'act-titel-plaats3', begin: 'De 20 finalisten' },
  { jaar: 2023, ronde: 'finale', bestand: '2023-finale.html', url: 'https://www.l1.nl/nieuws/2499000/dit-zijn-ze-dan-de-20-finalisten-van-de-lvk-finale-2023', formaat: 'act-titel-plaats', begin: 'Dat levert de volgende finale met 20 liedjes' },
  { jaar: 2024, ronde: 'finale', bestand: '2024-finale.html', url: 'https://l1nieuws.nl/article/12a544b4-70f7-5a79-b5e9-1e6bfc4acb1d', formaat: 'act-titel-plaats', begin: 'op:' },
  { jaar: 2025, ronde: 'finale', bestand: '2025-finale.html', url: 'https://l1nieuws.nl/entertainment/2834722/lvk-2025-met-zeven-debutanten-in-de-finale', formaat: 'act-titel-plaats', begin: 'In de L1-studio' },
  { jaar: 2026, ronde: 'finale', bestand: '2026-finale.html', url: 'https://stichtinglvk.nl/finale/finalisten-lvk-2026', formaat: 'titel-act', begin: 'Selecteer hier een liedje', eind: '\nGrashoek' },
];

/** Snij het lijstgedeelte uit de platte tekst. */
function lijstTekst(tekst, begin, eind) {
  const i = begin ? tekst.indexOf(begin) : 0;
  if (i < 0) return null;
  let rest = tekst.slice(i + (begin ? begin.length : 0));
  const e = rest.indexOf(eind || '\nDeel dit artikel');
  if (e > 0) rest = rest.slice(0, e);
  return rest;
}

/** Splits het body-gedeelte in velden op basis van ' - '. */
function velden(body) {
  const net = body.replace(/^[-•*\s]+/, '');
  let v = net.split(/\s+-\s+/);
  if (v.length === 1) v = net.split(/\s+-\s*/); // vangt " -Act" zonder spatie na het streepje
  if (v.length === 1) v = net.split(/-\s+/); // vangt "Titel…- Act" zonder spatie vóór het streepje
  return v.map((x) => netjes(x));
}

function parens(body) {
  const m = body.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { kern: m[1].trim(), plaats: netjes(m[2]) } : { kern: body.trim(), plaats: '' };
}

/** Parseer één bron tot [{jaar,titel,uitvoerende,plaats,ronde,bronUrl}]. */
function parseBron(bron) {
  const bestand = path.join(CACHE, bron.bestand);
  if (!existsSync(bestand)) return null;
  const tekst = stripHtml(readFileSync(bestand, 'utf8'));
  const deel = lijstTekst(tekst, bron.begin, bron.eind);
  if (!deel) return null;
  const regels = deel.split('\n').map((r) => r.trim()).filter(Boolean);
  const uit = [];
  const push = (titel, uitvoerende, plaats) => {
    titel = netjes(titel);
    uitvoerende = netjes(uitvoerende);
    if (!titel || titel.length > 90) return;
    if (/^(jaar|titel|uitvoerende|uitvoerenden|plaats|regio|noord-limburg|midden-limburg|zuid-limburg|parkstad|westelijke|maastricht|voorronde)/i.test(titel)) return;
    uit.push({ jaar: bron.jaar, titel, uitvoerende, plaats: netjes(plaats), ronde: bron.ronde, bronUrl: bron.url });
  };

  if (bron.formaat === 'tab-scan-titel-plaats') {
    // Rijen staan hier als <regio><nr>\t<titel>\t<plaats>\t<regio>...
    const re = /(\d{1,3})\t([^\t\n]+)\t([^\t\n]+)\t/g;
    let m;
    while ((m = re.exec(deel))) push(m[2], '', m[3]);
    return ontdubbel(uit);
  }

  if (bron.formaat === 'tabel-titel-plaats' || bron.formaat === 'tabel-titel-act-plaats') {
    const stappen = bron.formaat === 'tabel-titel-act-plaats' ? 3 : 2;
    for (let i = 0; i < regels.length; i++) {
      if (!/^\d+$/.test(regels[i])) continue;
      const veld = regels.slice(i + 1, i + 1 + stappen);
      if (veld.length < stappen) continue;
      if (/^(regio)/i.test(regels[i + 1] || '')) continue;
      if (stappen === 3) push(veld[0], veld[1], veld[2]);
      else push(veld[0], '', veld[1]);
      i += stappen;
    }
    return ontdubbel(uit);
  }

  for (let r of regels) {
    let body = r;
    const koppen = body.match(/^LVK[- ]?finalist\s*\d+\s*:?\s*(.*)$/i);
    if (koppen) body = koppen[1];
    body = body.replace(/^[•*]\s*/, '').replace(/^\d{1,3}\s*[-.)]?\s+/, '').trim();
    if (!body || !/-/.test(body)) continue;

    if (bron.formaat === 'tab-titel-plaats') {
      const cellen = r.split('\t').map((c) => c.trim()).filter(Boolean);
      if (cellen.length >= 3 && /^\d+$/.test(cellen[0])) push(cellen[1], '', cellen[2]);
      continue;
    }
    if (bron.formaat === 'titel-plaats') {
      const v = velden(body);
      if (v.length >= 2) push(v[0], '', v[1]);
    } else if (bron.formaat === 'titel-plaats-act') {
      const v = velden(body);
      if (v.length >= 3) push(v[0], v[2], v[1]);
    } else if (bron.formaat === 'titel-plaats-(act)') {
      const { kern, plaats } = parens(body);
      const v = velden(kern);
      if (v.length >= 2) push(v[0], plaats, v[1]);
    } else if (bron.formaat === 'act-titel') {
      const v = velden(body);
      if (v.length >= 2) push(v[1], v[0], '');
    } else if (bron.formaat === 'titel-act') {
      const v = velden(body);
      if (v.length >= 2) push(v[0], v[1], '');
    } else if (bron.formaat === 'act-titel-plaats3') {
      const v = velden(body);
      if (v.length >= 3) push(v[1], v[0], v[2]);
    } else if (bron.formaat === 'act-titel-plaats') {
      const { kern, plaats } = parens(body);
      const v = velden(kern);
      if (v.length >= 2) push(v[1], v[0], plaats);
    } else if (bron.formaat === 'titel-act-plaats') {
      const { kern, plaats } = parens(body);
      const v = velden(kern);
      if (v.length >= 2) push(v[0], v[1], plaats);
    }
  }
  return ontdubbel(uit);
}

/* ------------------------------------------------------------------ *
 * 3. Samenvoegen
 * ------------------------------------------------------------------ */
const RANG = { 'halve finale': 1, finale: 2, winnaar: 3 };

/** Normaliseer een uitvoerende voor dedupe: 'en' en '&' vallen samen. */
function normAct(s) {
  return norm(s).replace(/\ben\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function samenvoegen(rijen) {
  // Eerste pass: dedupe op jaar+titel+uitvoerende, houd de verst bereikte ronde.
  const map = new Map();
  for (const r of rijen) {
    const sleutel = r.jaar + '|' + norm(r.titel) + '|' + normAct(r.uitvoerende);
    const bestaand = map.get(sleutel);
    if (!bestaand) {
      map.set(sleutel, { ...r });
    } else {
      if (RANG[r.ronde] > RANG[bestaand.ronde]) {
        bestaand.ronde = r.ronde;
        bestaand.bronUrl = r.bronUrl;
      }
      if (!bestaand.uitvoerende && r.uitvoerende) bestaand.uitvoerende = r.uitvoerende;
      if (!bestaand.titel && r.titel) bestaand.titel = r.titel;
    }
  }
  // Tweede pass: hetzelfde liedje kan in een halve-finalelijst zonder uitvoerende
  // staan en in de finalelijst met uitvoerende. Voeg die samen op jaar+titel.
  const perTitel = new Map();
  for (const r of map.values()) {
    const k = r.jaar + '|' + norm(r.titel);
    const groep = perTitel.get(k) || [];
    groep.push(r);
    perTitel.set(k, groep);
  }
  const uit = [];
  for (const groep of perTitel.values()) {
    if (groep.length === 1) {
      uit.push(groep[0]);
      continue;
    }
    const metAct = groep.filter((r) => r.uitvoerende);
    if (metAct.length === 1) {
      // precies één variant kent de uitvoerende: dat is dezelfde inzending
      const hoofd = { ...metAct[0] };
      for (const r of groep) {
        if (RANG[r.ronde] > RANG[hoofd.ronde]) {
          hoofd.ronde = r.ronde;
          hoofd.bronUrl = r.bronUrl;
        }
      }
      uit.push(hoofd);
    } else {
      uit.push(...groep);
    }
  }
  return uit.sort(
    (a, b) => a.jaar - b.jaar || RANG[b.ronde] - RANG[a.ronde] || a.titel.localeCompare(b.titel, 'nl'),
  );
}

/* ------------------------------------------------------------------ *
 * Hoofdprogramma
 * ------------------------------------------------------------------ */
const alle = [];
const winnaars = leesWinnaars();
if (PRINT) console.log(`Winnaars uit wikipedia: ${winnaars.length}`);
alle.push(...winnaars);

const perBron = {};
for (const bron of BRONNEN) {
  let rijen = [];
  try {
    rijen = parseBron(bron) || [];
  } catch (fout) {
    console.error(`  ! ${bron.jaar} ${bron.ronde}: ${fout.message}`);
  }
  const sleutel = `${bron.jaar}-${bron.ronde === 'finale' ? 'finale' : 'halvefinale'}`;
  if (!rijen.length) {
    console.error(`  ! ${bron.jaar} ${bron.ronde}: geen regels geparseerd (${bron.bestand})`);
    perBron[sleutel] = 0;
    continue;
  }
  perBron[sleutel] = rijen.length;
  alle.push(...rijen);
  if (PRINT) {
    console.log(`\n=== ${bron.jaar} ${bron.ronde} (${rijen.length}) — ${bron.bestand}`);
    for (const r of rijen) console.log(`  ${r.titel}  ||  ${r.uitvoerende}  ||  ${r.plaats || ''}`);
  }
}

const nummers = samenvoegen(alle).map(({ jaar, titel, uitvoerende, ronde, bronUrl }) => ({
  jaar,
  titel,
  uitvoerende,
  ronde,
  bronUrl,
}));

// Rapport
const jaren = [...new Set(nummers.map((n) => n.jaar))].sort((a, b) => a - b);
const perJaar = {};
for (const n of nummers) perJaar[n.jaar] = (perJaar[n.jaar] || 0) + 1;
const uniekeTitels = new Set(nummers.map((n) => norm(n.titel))).size;

const rapport = {
  bron: 'nl.wikipedia.org (winnaars) + l1.nl/l1nieuws.nl + stichtinglvk.nl (halve finalisten/finalisten)',
  licentie: 'alleen feitelijke gegevens (jaar, titel, uitvoerende, ronde) overgenomen uit publieke bronnen',
  opgehaald: new Date().toISOString().slice(0, 10),
  aantal: nummers.length,
  perJaar,
  nummers,
};

console.log('\n=== RAPPORT ===');
console.log(`Winnaars (wikipedia):        ${winnaars.length}`);
console.log(`Bronnen (halve finale/finale): ${Object.keys(perBron).length} bestanden`);
console.log(`Totaal regels:               ${nummers.length}`);
console.log(`Jaren met een bron:          ${jaren.length} (${jaren[0]}-${jaren[jaren.length - 1]})`);
console.log(`Unieke titels:               ${uniekeTitels}`);
console.log('Per jaar:');
for (const j of jaren) console.log(`  ${j}: ${perJaar[j]}`);
console.log('\nGebruikte bron-URL\'s:');
console.log('  nl.wikipedia.org — https://nl.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&page=Limburgs_Vastelaovesleedjes_Konkoer');
for (const b of BRONNEN) console.log(`  ${b.jaar} ${b.ronde} — ${b.url}  (cache: ${b.bestand})`);
console.log('\n5 voorbeeldregels:');
for (const n of nummers.slice(0, 5)) console.log('  ' + JSON.stringify(n));

// Manifest van de cache voor traceerbaarheid.
const manifest = [
  '# Gebruikte bronnen (data/bron/lvk-cache)',
  '',
  `Opgehaald: ${rapport.opgehaald}`,
  '',
  '| jaar | ronde | cachebestand | URL |',
  '| --- | --- | --- | --- |',
  ...BRONNEN.map((b) => `| ${b.jaar} | ${b.ronde} | \`${b.bestand}\` | ${b.url} |`),
  '| (alle) | winnaar | `wikipedia-lvk.txt` | https://nl.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&page=Limburgs_Vastelaovesleedjes_Konkoer |',
  '',
].join('\n');
if (!PROEF) {
  await writeFile(path.join(CACHE, 'BRONNEN.md'), manifest, 'utf8');
}

if (!PROEF) {
  await writeFile(DOEL, JSON.stringify(rapport, null, 1), 'utf8');
  console.log(`\nWeggeschreven: ${path.relative(WORTEL, DOEL)}`);
} else {
  console.log('\n(proefmodus — niets weggeschreven)');
}
