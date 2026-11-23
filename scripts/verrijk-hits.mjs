#!/usr/bin/env node
/**
 * verrijk-hits.mjs — zoekt bij elke nummer 1-hit uit de Nederlandse Top 40 het juiste
 * Deezer-nummer (voor hoes + 30-secondenfragment) en schrijft data/bron/hits-verrijkt.json.
 *
 * Er wordt géén audio opgeslagen: alleen de Deezer-track-id. De app haalt het actuele
 * fragment live op (Deezer-previews verlopen na ongeveer een uur).
 *
 * Gebruik:
 *   node scripts/verrijk-hits.mjs              # alle nummers
 *   node scripts/verrijk-hits.mjs --proef 20   # eerste 20, alleen rapport
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(WORTEL, 'data', 'bron', 'deezer-cache');
const UA = 'Sjpeelavond/1.0 (partyspel voor thuis)';

const args = process.argv.slice(2);
const PROEF = args.includes('--proef') ? parseInt(args[args.indexOf('--proef') + 1] || '20', 10) : 0;

export const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:radio|single|album|original|remaster|live|feat|versie|version)[^)]*\)/g, ' ')
    .replace(/\b(feat|ft|featuring|with)\.?\s.*$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "Let kiss / Letkis" -> "Let kiss"; "A & B" -> "A". */
const eersteDeel = (s) => String(s || '').split(/\s*[/|]\s*/)[0].split(/\s+&\s+/)[0].trim();

function beoordeel(kandidaat, titel, artiest) {
  const t = norm(kandidaat.title_short || kandidaat.title);
  const a = norm(kandidaat.artist?.name);
  const wt = norm(eersteDeel(titel));
  const wa = norm(eersteDeel(artiest));
  if (!t || !a) return 0;
  let score = 0;
  if (t === wt) score += 3;
  else if (wt && (t.includes(wt) || wt.includes(t)) && Math.min(t.length, wt.length) > 3) score += 1.5;
  if (a === wa) score += 3;
  else if (wa && (a.includes(wa) || wa.includes(a))) score += 1.5;
  else if (norm(artiest).split(' ').some((deel) => deel.length > 3 && a.includes(deel))) score += 0.5;
  if (kandidaat.title_version && /remix|live|karaoke|cover|instrumental/i.test(kandidaat.title_version)) score -= 1;
  return score;
}

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
  console.error(`  ! Deezer ${pad} ${JSON.stringify(params)}: ${laatsteFout?.message}`);
  return null;
}

export async function zoekNummer(titel, artiest) {
  const wt = eersteDeel(titel);
  const wa = eersteDeel(artiest);
  const zoekopdrachten = [
    { q: `track:"${wt}" artist:"${wa}"`, limit: 8 },
    { q: `${wt} ${wa}`, limit: 8 },
  ];
  for (const opdracht of zoekopdrachten) {
    const data = await deezer('search', opdracht);
    if (!data?.data?.length) continue;
    let beste = null;
    let besteScore = 0;
    for (const kandidaat of data.data) {
      const score = beoordeel(kandidaat, titel, artiest);
      if (score > besteScore) {
        besteScore = score;
        beste = kandidaat;
      }
    }
    if (beste && besteScore >= 3) return { track: beste, score: besteScore };
  }
  return null;
}

const top40 = JSON.parse(await readFile(path.join(WORTEL, 'data', 'bron', 'top40.json'), 'utf8'));
const lijst = PROEF ? top40.nummers.slice(0, PROEF) : top40.nummers;

const uit = [];
const zonder = [];
for (const [i, nummer] of lijst.entries()) {
  const treffer = await zoekNummer(nummer.titel, nummer.artiest);
  if (treffer) {
    uit.push({
      ...nummer,
      deezerId: treffer.track.id,
      deezerTitel: treffer.track.title_short || treffer.track.title,
      deezerArtiest: treffer.track.artist?.name,
      album: treffer.track.album?.title || null,
      hoes: treffer.track.album?.cover_big || treffer.track.album?.cover_medium || null,
      heeftPreview: Boolean(treffer.track.preview),
      duur: treffer.track.duration || null,
      matchScore: treffer.score,
    });
  } else {
    zonder.push(nummer);
  }
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${lijst.length} ...`);
}

console.log(`\nGematcht: ${uit.length}/${lijst.length} (${Math.round((uit.length / lijst.length) * 100)}%)`);
console.log(`Zonder fragment: ${uit.filter((n) => !n.heeftPreview).length}`);
console.log(`Niet gevonden: ${zonder.length}`);
console.log('Voorbeelden van niet gevonden:', zonder.slice(0, 10).map((n) => `${n.artiest} - ${n.titel}`));

if (!PROEF) {
  await writeFile(
    path.join(WORTEL, 'data', 'bron', 'hits-verrijkt.json'),
    JSON.stringify(
      {
        bron: 'Top 40-lijsten (nl.wikipedia.org) + Deezer-API voor hoes en fragment',
        opgehaald: new Date().toISOString().slice(0, 10),
        aantal: uit.length,
        nummers: uit,
        nietGevonden: zonder,
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log('Weggeschreven: data/bron/hits-verrijkt.json');
}
