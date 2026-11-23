/**
 * Sjpeelavond — server
 *
 * Eén Node-service zonder npm-afhankelijkheden. De server doet drie dingen:
 *   1. de pagina en de bestanden uit public/ serveren;
 *   2. de muziekdataset ontsluiten (trekken, onthullen, zoeken, fragment-URL's);
 *   3. eigen nummers beheren (alleen achter het beheerderswachtwoord).
 *
 * De jaartallen van de getrokken kaarten blijven op de server tot ze onthuld worden:
 * /api/trek geeft alleen een id, /api/onthul pas titel, artiest en jaartal.
 */
import http from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Dezelfde code als de pagina gebruikt: het lezen van een gescand kaartje hoort maar
// op één plek te staan (zie public/js/kaart.js).
import { losOp } from './public/js/kaart.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PUBLIEK = path.join(HIER, 'public');
const DATA = process.env.SJPEELAVOND_DATA || path.join(HIER, 'data');
const MEDIA = process.env.SJPEELAVOND_MEDIA || path.join(HIER, 'media');
const DB_PAD = process.env.SJPEELAVOND_DB || path.join(DATA, 'eigen.db');
const POORT = parseInt(process.env.POORT || '8080', 10);
const WACHTWOORD = process.env.SJPEELAVOND_WACHTWOORD || '';
const VERSIE = '1.0.0';
const EIGEN_BASIS = 900000;

/* ── database (alleen voor eigen nummers en beheerderssessies) ─────────── */

const db = new DatabaseSync(DB_PAD);
db.exec(`
  CREATE TABLE IF NOT EXISTS eigen_nummers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titel TEXT NOT NULL,
    artiest TEXT NOT NULL,
    jaar INTEGER NOT NULL,
    album TEXT,
    bestand TEXT,
    toegevoegd TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessies (
    token TEXT PRIMARY KEY,
    aangemaakt INTEGER NOT NULL,
    verloopt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS beheer (
    sleutel TEXT PRIMARY KEY,
    waarde TEXT NOT NULL
  );
`);

function zetWachtwoord(wachtwoord) {
  const zout = crypto.randomBytes(16).toString('hex');
  const afdruk = crypto.scryptSync(wachtwoord, zout, 64).toString('hex');
  db.prepare('INSERT INTO beheer (sleutel, waarde) VALUES (?, ?) ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde').run(
    'wachtwoord',
    `${zout}:${afdruk}`,
  );
}
function controleerWachtwoord(wachtwoord) {
  const rij = db.prepare('SELECT waarde FROM beheer WHERE sleutel = ?').get('wachtwoord');
  if (!rij) return false;
  const [zout, afdruk] = rij.waarde.split(':');
  if (!zout || !afdruk) return false;
  const poging = crypto.scryptSync(wachtwoord, zout, 64).toString('hex');
  const a = Buffer.from(poging, 'hex');
  const b = Buffer.from(afdruk, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
if (WACHTWOORD) {
  const rij = db.prepare('SELECT waarde FROM beheer WHERE sleutel = ?').get('wachtwoord');
  if (!rij) {
    zetWachtwoord(WACHTWOORD);
    console.log('Beheerderswachtwoord ingesteld.');
  }
}

const maakToken = () => crypto.randomBytes(32).toString('hex');
function nieuweSessie() {
  const token = maakToken();
  const nu = Date.now();
  db.prepare('INSERT INTO sessies (token, aangemaakt, verloopt) VALUES (?, ?, ?)').run(token, nu, nu + 12 * 3600 * 1000);
  db.prepare('DELETE FROM sessies WHERE verloopt < ?').run(nu);
  return token;
}
function sessieGeldig(token) {
  if (!token) return false;
  const rij = db.prepare('SELECT verloopt FROM sessies WHERE token = ?').get(token);
  return Boolean(rij && rij.verloopt > Date.now());
}
const isBeheerder = (req) => sessieGeldig(leesKoekjes(req).sessie);

/* ── dataset ───────────────────────────────────────────────────────────── */

const nummers = new Map(); // id -> nummer
const perDek = new Map(); // dek -> [id]
let index = { dekken: [], totalen: {} };
let eigenLijst = [];

function herlaadDataset() {
  nummers.clear();
  perDek.clear();
  const bestanden = ['nummers-hits.json', 'nummers-limburg.json'];
  for (const bestand of bestanden) {
    const pad = path.join(DATA, bestand);
    if (!existsSync(pad)) {
      console.error(`Let op: ${bestand} ontbreekt in ${DATA}`);
      continue;
    }
    const inhoud = JSON.parse(readFileSync(pad, 'utf8'));
    for (const nummer of inhoud.nummers) {
      nummers.set(nummer.id, nummer);
      for (const dek of nummer.dekken) {
        if (!perDek.has(dek)) perDek.set(dek, []);
        perDek.get(dek).push(nummer.id);
      }
    }
  }
  herlaadEigen();
  const indexPad = path.join(DATA, 'index.json');
  if (existsSync(indexPad)) index = JSON.parse(readFileSync(indexPad, 'utf8'));
}

/**
 * De kaartjestabel van de fysieke spellen (data/hitster.json, zie scripts/haal-hitster.mjs).
 * Pas bij het eerste gebruik inlezen: het bestand is groot en lang niet elke sessie
 * heeft het nodig.
 */
let kaartjestabelInhoud = null;
function kaartjestabel() {
  if (!kaartjestabelInhoud) {
    const pad = path.join(DATA, 'hitster.json');
    if (!existsSync(pad)) throw new Error(`De kaartjestabel ontbreekt (${pad}); draai scripts/haal-hitster.mjs.`);
    kaartjestabelInhoud = JSON.parse(readFileSync(pad, 'utf8'));
  }
  return kaartjestabelInhoud;
}

function herlaadEigen() {
  // Oude eigen nummers uit de kaartenlijst halen voordat we opnieuw opbouwen.
  for (const id of perDek.get('eigen') || []) nummers.delete(id);
  perDek.set('eigen', []);
  eigenLijst = db.prepare('SELECT * FROM eigen_nummers ORDER BY jaar, titel').all();
  for (const rij of eigenLijst) {
    const nummer = {
      id: EIGEN_BASIS + rij.id,
      titel: rij.titel,
      artiest: rij.artiest,
      jaar: rij.jaar,
      jaarBron: 'Zelf toegevoegd',
      album: rij.album || null,
      hoes: null,
      eigen: true,
      bestand: rij.bestand,
      dekken: ['eigen'],
      soort: 'eigen',
      taal: 'nl',
      bron: 'Eigen verzameling',
    };
    nummers.set(nummer.id, nummer);
    if (!perDek.has('eigen')) perDek.set('eigen', []);
    perDek.get('eigen').push(nummer.id);
  }
}

/* ── fragmenten ────────────────────────────────────────────────────────── */

const fragmentCache = new Map(); // deezerId -> {url, verloopt}
const itunesCache = new Map();

async function haalFragment(nummer) {
  if (nummer.eigen) return nummer.bestand ? `/api/media/${encodeURIComponent(nummer.bestand)}` : null;
  const nu = Date.now();
  const bewaard = fragmentCache.get(nummer.deezerId);
  if (bewaard && bewaard.verloopt > nu) return bewaard.url;

  // 1. Deezer: actueel 30-secondenfragment (de URL verloopt, dus elke keer vers ophalen).
  try {
    const antwoord = await fetch(`https://api.deezer.com/track/${nummer.deezerId}`, {
      headers: { 'user-agent': 'Sjpeelavond/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (antwoord.ok) {
      const data = await antwoord.json();
      if (data?.preview) {
        fragmentCache.set(nummer.deezerId, { url: data.preview, verloopt: nu + 20 * 60 * 1000 });
        return data.preview;
      }
    }
  } catch (fout) {
    console.error(`Deezer-fragment mislukt voor ${nummer.titel}: ${fout.message}`);
  }

  // 2. iTunes als achtervang: die URL's blijven jaren geldig.
  const bewaardItunes = itunesCache.get(nummer.id);
  if (bewaardItunes && bewaardItunes.verloopt > nu) return bewaardItunes.url;
  try {
    const term = encodeURIComponent(`${nummer.titel} ${nummer.artiest}`);
    const antwoord = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`, {
      signal: AbortSignal.timeout(8000),
    });
    if (antwoord.ok) {
      const data = await antwoord.json();
      const treffer = (data.results || []).find((r) => r.previewUrl);
      if (treffer) {
        itunesCache.set(nummer.id, { url: treffer.previewUrl, verloopt: nu + 24 * 3600 * 1000 });
        return treffer.previewUrl;
      }
    }
  } catch (fout) {
    console.error(`iTunes-fragment mislukt voor ${nummer.titel}: ${fout.message}`);
  }
  return null;
}

/* ── HTTP-hulpjes ──────────────────────────────────────────────────────── */

function stuur(res, code, inhoud, kop = {}) {
  const lichaam = typeof inhoud === 'string' || Buffer.isBuffer(inhoud) ? inhoud : JSON.stringify(inhoud);
  res.writeHead(code, {
    'content-type': typeof inhoud === 'string' || Buffer.isBuffer(inhoud) ? kop['content-type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...kop,
  });
  res.end(lichaam);
}
const stuurJson = (res, code, inhoud, kop = {}) =>
  stuur(res, code, inhoud, { 'content-type': 'application/json; charset=utf-8', ...kop });

function leesKoekjes(req) {
  const uit = {};
  for (const deel of (req.headers.cookie || '').split(';')) {
    const [k, ...rest] = deel.trim().split('=');
    if (k) uit[k] = decodeURIComponent(rest.join('='));
  }
  return uit;
}

function leesLichaam(req, max = 1024 * 1024) {
  return new Promise((los, af) => {
    let grootte = 0;
    const stukken = [];
    req.on('data', (chunk) => {
      grootte += chunk.length;
      if (grootte > max) {
        af(new Error('te groot'));
        req.destroy();
        return;
      }
      stukken.push(chunk);
    });
    req.on('end', () => los(Buffer.concat(stukken)));
    req.on('error', af);
  });
}

async function leesJson(req) {
  const ruw = await leesLichaam(req);
  if (!ruw.length) return {};
  try {
    return JSON.parse(ruw.toString('utf8'));
  } catch {
    return {};
  }
}

const MISLUKT = { fout: 'Mislukt' };

/* ── beheerder ─────────────────────────────────────────────────────────── */

const inlogpogingen = new Map();
function magProberen(ip) {
  const nu = Date.now();
  const rij = inlogpogingen.get(ip) || { aantal: 0, sinds: nu };
  if (nu - rij.sinds > 10 * 60 * 1000) {
    rij.aantal = 0;
    rij.sinds = nu;
  }
  rij.aantal += 1;
  inlogpogingen.set(ip, rij);
  return rij.aantal <= 10;
}

/* ── routes ────────────────────────────────────────────────────────────── */

const STATISCHE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

async function dienBestand(res, pad, type) {
  try {
    const info = await stat(pad);
    if (!info.isFile()) return stuur(res, 404, 'Niet gevonden');
    const geenCache = ['.html', '.js', '.css', '.webmanifest'].includes(path.extname(pad));
    res.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      'cache-control': geenCache ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(pad).pipe(res);
  } catch {
    stuur(res, 404, 'Niet gevonden');
  }
}

async function dienPubliek(res, urlPad) {
  let relatief = decodeURIComponent(urlPad);
  if (relatief === '/' || relatief === '') relatief = '/index.html';
  if (relatief.includes('..') || relatief.includes('\0')) return stuur(res, 400, 'Ongeldig pad');
  const type = STATISCHE_TYPES[path.extname(relatief).toLowerCase()];
  if (!type) return stuur(res, 404, 'Niet gevonden');
  const pad = path.join(PUBLIEK, relatief);
  if (!pad.startsWith(PUBLIEK)) return stuur(res, 400, 'Ongeldig pad');
  return dienBestand(res, pad, type);
}

export async function verwerk(req, res) {
  let url;
  try {
    const ruw = (req.url || '/').replace(/^\/{2,}/, '/');
    url = new URL(ruw, 'http://localhost');
  } catch {
    return stuur(res, 400, 'Ongeldig verzoek');
  }
  const pad = url.pathname;

  try {
    if (pad === '/healthz') {
      return stuur(res, 200, 'ok', { 'x-sjpeelavond': 'app', 'content-type': 'text/plain; charset=utf-8' });
    }

    if (pad === '/api/versie') {
      return stuurJson(res, 200, {
        versie: VERSIE,
        naam: 'Sjpeelavond',
        totalen: { ...(index.totalen || {}), eigen: eigenLijst.length },
        dekken: [
          ...(index.dekken || []),
          ...(eigenLijst.length
            ? [{ id: 'eigen', naam: 'Eigen nummers', beschrijving: 'Nummers die je zelf hebt toegevoegd.', aantal: eigenLijst.length }]
            : []),
        ],
      });
    }

    // De kaartjestabel van de fysieke spellen (Hitster). Pas bij het eerste gebruik
    // inlezen: het bestand is groot en de meeste sessies hebben het niet nodig.
    if (pad === '/api/hitster') {
      try {
        return stuurJson(res, 200, kaartjestabel());
      } catch (fout) {
        return stuurJson(res, 404, { fout: String((fout && fout.message) || fout) });
      }
    }

    // Een gescand kaartje opzoeken: de QR-code van een fysiek spel omzetten in een
    // liedje. Dezelfde code als in de app (public/js/kaart.js).
    if (pad === '/api/kaart' && req.method === 'POST') {
      const lichaam = await leesJson(req);
      try {
        const uitkomst = await losOp(String(lichaam.code || ''), {
          tabel: kaartjestabel(),
          haalTekst: async (url) => {
            const antwoord = await fetch(url, { headers: { 'user-agent': 'Sjpeelavond/1.0 (partyspel voor thuis)' } });
            if (!antwoord.ok) throw new Error(`Spotify antwoordde ${antwoord.status}`);
            return antwoord.text();
          },
        });
        return stuurJson(res, 200, uitkomst);
      } catch (fout) {
        return stuurJson(res, 400, { fout: String((fout && fout.message) || fout) });
      }
    }

    if (pad === '/api/dekken') {
      const uit = (index.dekken || []).map((d) => ({ ...d, aantal: (perDek.get(d.id) || []).length }));
      if (eigenLijst.length) uit.push({ id: 'eigen', naam: 'Eigen nummers', beschrijving: 'Zelf toegevoegd.', aantal: eigenLijst.length });
      return stuurJson(res, 200, { dekken: uit });
    }

    if (pad === '/api/trek' && req.method === 'POST') {
      const lichaam = await leesJson(req);
      const dekken = Array.isArray(lichaam.dekken) && lichaam.dekken.length ? lichaam.dekken : ['hits'];
      const gebruikt = new Set((lichaam.gebruikt || []).map(Number));
      const aantal = Math.max(1, Math.min(20, parseInt(lichaam.aantal, 10) || 1));
      const pool = [];
      for (const dek of dekken) for (const id of perDek.get(dek) || []) if (!gebruikt.has(id)) pool.push(id);
      if (!pool.length) return stuurJson(res, 409, { fout: 'Deze dekstapel is leeg. Kies een ander dek of begin opnieuw.' });
      const kaarten = [];
      for (let i = 0; i < aantal && pool.length; i++) {
        const k = Math.floor(Math.random() * pool.length);
        kaarten.push({ id: pool[k] });
        pool.splice(k, 1);
      }
      return stuurJson(res, 200, { kaarten, resterend: pool.length });
    }

    if (pad === '/api/onthul' && req.method === 'POST') {
      const lichaam = await leesJson(req);
      const kaarten = (lichaam.ids || [])
        .map((id) => nummers.get(Number(id)))
        .filter(Boolean)
        .map((n) => ({
          id: n.id,
          titel: n.titel,
          artiest: n.artiest,
          jaar: n.jaar,
          jaarBron: n.jaarBron || null,
          album: n.album || null,
          hoes: n.hoes || null,
          soort: n.soort || null,
          lvk: typeof n.lvk === 'boolean' ? n.lvk : null,
          regio: n.regio || null,
          eigen: Boolean(n.eigen),
        }));
      return stuurJson(res, 200, { kaarten });
    }

    if (pad === '/api/hint' && req.method === 'POST') {
      const lichaam = await leesJson(req);
      const nummer = nummers.get(Number(lichaam.id));
      if (!nummer) return stuurJson(res, 404, { fout: 'Onbekend nummer' });
      const decennium = Math.floor(nummer.jaar / 10) * 10;
      return stuurJson(res, 200, { decennium });
    }

    if (pad === '/api/fragment' && req.method === 'GET') {
      const nummer = nummers.get(Number(url.searchParams.get('id')));
      if (!nummer) return stuurJson(res, 404, { fout: 'Onbekend nummer' });
      const bron = await haalFragment(nummer);
      if (!bron) return stuurJson(res, 502, { fout: 'Geen fragment beschikbaar voor dit nummer' });
      return stuurJson(res, 200, { url: bron, duur: nummer.eigen ? null : 30 });
    }

    if (pad === '/api/nummers' && req.method === 'GET') {
      const dek = url.searchParams.get('dek') || 'hits';
      const zoek = (url.searchParams.get('zoek') || '').toLowerCase().trim();
      const limiet = Math.min(500, parseInt(url.searchParams.get('limiet'), 10) || 100);
      const vanaf = Math.max(0, parseInt(url.searchParams.get('vanaf'), 10) || 0);
      let lijst = (perDek.get(dek) || []).map((id) => nummers.get(id)).filter(Boolean);
      if (zoek) lijst = lijst.filter((n) => `${n.titel} ${n.artiest} ${n.album || ''}`.toLowerCase().includes(zoek));
      lijst.sort((a, b) => a.jaar - b.jaar || a.artiest.localeCompare(b.artiest, 'nl'));
      const pagina = lijst.slice(vanaf, vanaf + limiet).map((n) => ({
        id: n.id,
        titel: n.titel,
        artiest: n.artiest,
        jaar: n.jaar,
        album: n.album || null,
        hoes: n.hoes || null,
        soort: n.soort || null,
        lvk: typeof n.lvk === 'boolean' ? n.lvk : null,
      }));
      return stuurJson(res, 200, { totaal: lijst.length, vanaf, limiet, nummers: pagina });
    }

    /* ── beheerder ───────────────────────────────────────────────────── */

    if (pad === '/api/beheer/status') {
      return stuurJson(res, 200, {
        ingesteld: Boolean(db.prepare('SELECT 1 FROM beheer WHERE sleutel = ?').get('wachtwoord')),
        ingelogd: isBeheerder(req),
        aantalEigen: eigenLijst.length,
      });
    }

    if (pad === '/api/beheer/inloggen' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'onbekend';
      if (!magProberen(ip)) return stuurJson(res, 429, { fout: 'Te veel pogingen. Probeer het over tien minuten opnieuw.' });
      if (!db.prepare('SELECT 1 FROM beheer WHERE sleutel = ?').get('wachtwoord')) {
        return stuurJson(res, 409, { fout: 'Er is nog geen beheerderswachtwoord ingesteld op de server.' });
      }
      const lichaam = await leesJson(req);
      if (!controleerWachtwoord(String(lichaam.wachtwoord || ''))) return stuurJson(res, 401, { fout: 'Onjuist wachtwoord' });
      const token = nieuweSessie();
      return stuurJson(res, 200, { gelukt: true }, { 'set-cookie': `sessie=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` });
    }

    if (pad === '/api/beheer/uitloggen' && req.method === 'POST') {
      const token = leesKoekjes(req).sessie;
      if (token) db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
      return stuurJson(res, 200, { gelukt: true }, { 'set-cookie': 'sessie=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    if (pad === '/api/beheer/eigen' && req.method === 'GET') {
      if (!isBeheerder(req)) return stuurJson(res, 403, MISLUKT);
      return stuurJson(res, 200, { nummers: eigenLijst.map((r) => ({ ...r, id: EIGEN_BASIS + r.id })) });
    }

    if (pad === '/api/beheer/eigen' && req.method === 'POST') {
      if (!isBeheerder(req)) return stuurJson(res, 403, MISLUKT);
      const titel = String(req.headers['x-titel'] || '').trim();
      const artiest = String(req.headers['x-artiest'] || '').trim();
      const jaar = parseInt(req.headers['x-jaar'], 10);
      const album = String(req.headers['x-album'] || '').trim() || null;
      const bestandsnaamRuw = decodeURIComponent(String(req.headers['x-bestandsnaam'] || ''));
      if (!titel || !artiest) return stuurJson(res, 400, { fout: 'Titel en artiest zijn verplicht.' });
      if (!jaar || jaar < 1900 || jaar > 2100) return stuurJson(res, 400, { fout: 'Vul een jaartal tussen 1900 en 2100 in.' });
      const ext = path.extname(bestandsnaamRuw).toLowerCase();
      if (!['.mp3', '.m4a', '.wav', '.ogg'].includes(ext)) return stuurJson(res, 400, { fout: 'Alleen mp3, m4a, wav of ogg.' });
      const ruw = await leesLichaam(req, 30 * 1024 * 1024);
      if (!ruw.length) return stuurJson(res, 400, { fout: 'Geen bestand ontvangen.' });
      await mkdir(MEDIA, { recursive: true });
      const veilig = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      await writeFile(path.join(MEDIA, veilig), ruw);
      const uitkomst = db
        .prepare('INSERT INTO eigen_nummers (titel, artiest, jaar, album, bestand, toegevoegd) VALUES (?, ?, ?, ?, ?, ?)')
        .run(titel, artiest, jaar, album, veilig, new Date().toISOString());
      herlaadEigen();
      return stuurJson(res, 200, { gelukt: true, id: EIGEN_BASIS + Number(uitkomst.lastInsertRowid) });
    }

    if (pad.startsWith('/api/beheer/eigen/') && req.method === 'DELETE') {
      if (!isBeheerder(req)) return stuurJson(res, 403, MISLUKT);
      const id = parseInt(pad.split('/').pop(), 10) - EIGEN_BASIS;
      const rij = db.prepare('SELECT * FROM eigen_nummers WHERE id = ?').get(id);
      if (!rij) return stuurJson(res, 404, { fout: 'Niet gevonden' });
      if (rij.bestand) await unlink(path.join(MEDIA, rij.bestand)).catch(() => {});
      db.prepare('DELETE FROM eigen_nummers WHERE id = ?').run(id);
      herlaadEigen();
      return stuurJson(res, 200, { gelukt: true });
    }

    if (pad.startsWith('/api/media/')) {
      const bestand = path.basename(decodeURIComponent(pad.slice('/api/media/'.length)));
      const ext = path.extname(bestand).toLowerCase();
      if (!['.mp3', '.m4a', '.wav', '.ogg'].includes(ext)) return stuur(res, 400, 'Ongeldig bestand');
      return dienBestand(res, path.join(MEDIA, bestand), STATISCHE_TYPES[ext]);
    }

    if (pad.startsWith('/api/')) return stuurJson(res, 404, { fout: 'Onbekende route' });

    return dienPubliek(res, pad);
  } catch (fout) {
    console.error('Fout bij', pad, fout);
    return stuurJson(res, 500, { fout: 'Er ging iets mis' });
  }
}

herlaadDataset();
console.log(`Sjpeelavond ${VERSIE}: ${nummers.size} nummers, dekken: ${[...perDek.keys()].join(', ')}`);

export const server = http.createServer((req, res) => {
  verwerk(req, res).catch((fout) => {
    console.error(fout);
    if (!res.headersSent) stuur(res, 500, 'Er ging iets mis');
  });
});

export { nummers, perDek, db, herlaadDataset };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  server.listen(POORT, () => console.log(`Luistert op http://0.0.0.0:${POORT}`));
}
