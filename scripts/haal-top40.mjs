#!/usr/bin/env node
/**
 * haal-top40.mjs — haalt alle nummer 1-hits uit de Nederlandse Top 40 (1965-heden)
 * van nl.wikipedia.org en schrijft ze naar data/bron/top40.json
 *
 * Bron: de jaarlijkse lijsten "Lijst van nummer 1-hits in de Nederlandse Top 40 in <jaar>"
 * op de Nederlandstalige Wikipedia (CC BY-SA 4.0). We bewaren alleen de feiten
 * (artiest, titel, hitjaar), niet de opmaak van de bron.
 *
 * Gebruik:
 *   node scripts/haal-top40.mjs                 # 1965 t/m nu
 *   node scripts/haal-top40.mjs --van 1980 --tot 1990
 *   node scripts/haal-top40.mjs --proef 3       # alleen de eerste 3 jaren, niets wegschrijven
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(WORTEL, 'data', 'bron', 'wiki-cache');
const UA = 'Sjpeelavond/1.0 (partyspel voor thuis; https://github.com/Theberas04/sjpeelavond)';

const args = process.argv.slice(2);
const opt = (naam, standaard) => {
  const i = args.indexOf('--' + naam);
  return i >= 0 && args[i + 1] ? args[i + 1] : standaard;
};
const VAN = parseInt(opt('van', '1965'), 10);
const TOT = parseInt(opt('tot', String(new Date().getFullYear())), 10);
const PROEF = args.includes('--proef') ? parseInt(opt('proef', '3'), 10) : 0;

/** Wikimedia-sjablonen en links platslaan tot gewone tekst. */
function schoon(s) {
  let vorige;
  do {
    vorige = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, ' '); // sjablonen (vlaggen, nowrap, ...)
  } while (s !== vorige);
  s = s
    .replace(/<ref[^>]*\/>/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
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
  return s;
}

const MAANDEN =
  /^(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)?\s*\d{1,2} (januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/i;

/** Eén wiki-tabelrij -> {artiest, titel}. De rij wordt verankerd op de datumkolom. */
function rijNaarLied(rij) {
  const velden = rij
    .replace(/\n\|/g, '||')
    .split('||')
    .map((v) => schoon(v.replace(/^\s*\|/, '')))
    .filter((v) => v.length);
  const datum = velden.findIndex((v) => MAANDEN.test(v));
  if (datum < 0) return null;
  const artiest = velden[datum + 1];
  const titel = velden[datum + 2];
  if (!artiest || !titel) return null;
  if (/^(geen|\d+)$/i.test(titel)) return null;
  if (/categorie:|Wikipedia:|\[\[/i.test(titel)) return null;
  if (titel.length > 120) return null;
  return { titel, artiest };
}

async function haalWikitext(jaar) {
  const pagina = `Lijst_van_nummer_1-hits_in_de_Nederlandse_Top_40_in_${jaar}`;
  const bestand = path.join(CACHE, `${jaar}.json`);
  if (existsSync(bestand)) return JSON.parse(await readFile(bestand, 'utf8')).wikitext;
  const url =
    'https://nl.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&page=' +
    encodeURIComponent(pagina);
  const antwoord = await fetch(url, { headers: { 'user-agent': UA } });
  if (!antwoord.ok) return null;
  const data = await antwoord.json();
  const tekst = data?.parse?.wikitext ?? null;
  if (tekst) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(bestand, JSON.stringify({ jaar, wikitext: tekst }), 'utf8');
  }
  return tekst;
}

function leesJaar(wikitext, jaar) {
  const rijen = wikitext.split(/\n\|-/).slice(1);
  const uit = [];
  for (const rij of rijen) {
    // Velden staan ofwel naast elkaar (||) ofwel elk op een eigen regel (| ...).
    const lied = rijNaarLied(rij.replace(/\n\s*\|/g, '||'));
    if (lied) uit.push({ ...lied, jaar, bron: 'Top 40 nummer 1-hit (nl.wikipedia.org)' });
  }
  return uit;
}

const alle = [];
const perJaar = {};
for (let jaar = VAN; jaar <= TOT; jaar++) {
  if (PROEF && jaar >= VAN + PROEF) break;
  let wikitext = null;
  try {
    wikitext = await haalWikitext(jaar);
  } catch (fout) {
    console.error(`  ! ${jaar}: ${fout.message}`);
  }
  if (!wikitext) {
    console.error(`  ! ${jaar}: geen lijst gevonden`);
    continue;
  }
  const liedjes = leesJaar(wikitext, jaar);
  perJaar[jaar] = liedjes.length;
  alle.push(...liedjes);
  console.log(`  ${jaar}: ${liedjes.length} nummer 1-hits`);
  await new Promise((r) => setTimeout(r, 120));
}

// Dedupliceren op artiest + titel; het vroegste hitjaar wint.
const sleutel = (l) =>
  (l.artiest + '|' + l.titel)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const uniek = new Map();
for (const lied of alle) {
  const k = sleutel(lied);
  if (!uniek.has(k) || lied.jaar < uniek.get(k).jaar) uniek.set(k, lied);
}
const lijst = [...uniek.values()].sort((a, b) => a.jaar - b.jaar || a.artiest.localeCompare(b.artiest));

console.log(`\nTotaal: ${alle.length} regels -> ${lijst.length} unieke nummer 1-hits`);
console.log(`Jaren: ${VAN}-${Math.min(TOT, VAN + (PROEF || TOT - VAN + 1) - 1)}`);

if (!PROEF) {
  const doel = path.join(WORTEL, 'data', 'bron', 'top40.json');
  await writeFile(
    doel,
    JSON.stringify(
      {
        bron: 'Lijsten van nummer 1-hits in de Nederlandse Top 40 (nl.wikipedia.org)',
        licentie: 'CC BY-SA 4.0 (Wikipedia); alleen feitelijke gegevens overgenomen',
        opgehaald: new Date().toISOString().slice(0, 10),
        aantal: lijst.length,
        perJaar,
        nummers: lijst,
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log(`Weggeschreven: ${path.relative(WORTEL, doel)}`);
} else {
  console.log('\nProefmodus — voorbeeld:', JSON.stringify(lijst.slice(0, 5), null, 1));
}
