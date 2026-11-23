/**
 * Proeven op lokaal.js — de spellogica die in de Android-app zit.
 *
 * De belangrijkste proef is de vergelijking met de server: de app moet exact dezelfde
 * antwoorden geven als de webversie, anders ziet de pagina in de app andere gegevens
 * dan op de computer en valt er iets om zonder dat een enkele proef dat merkt.
 *
 * Draaien: node --test test/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* ── testomgeving klaarzetten vóór de server geladen wordt ─────────────── */

const werkmap = mkdtempSync(path.join(tmpdir(), 'sjpeelavond-lokaal-'));
const datamap = path.join(werkmap, 'data');
process.env.SJPEELAVOND_DATA = datamap;
process.env.SJPEELAVOND_DB = path.join(datamap, 'eigen.db');
process.env.SJPEELAVOND_MEDIA = path.join(werkmap, 'media');
process.env.SJPEELAVOND_WACHTWOORD = '';
process.env.POORT = '0';
mkdirSync(datamap, { recursive: true });
mkdirSync(process.env.SJPEELAVOND_MEDIA, { recursive: true });

const HITS = [
  { id: 1, titel: 'Eerste hit', artiest: 'Artiest A', jaar: 1975, jaarBron: 'test', deezerId: 111, album: 'Album A', hoes: 'https://cdn/x.jpg', dekken: ['hits', 'nederland'], soort: 'hit', taal: 'nl' },
  { id: 2, titel: 'Tweede hit', artiest: 'Artiest B', jaar: 1991, jaarBron: 'test', deezerId: 222, album: null, hoes: null, dekken: ['hits'], soort: 'hit', taal: 'anders' },
  { id: 3, titel: 'Derde hit', artiest: 'Artiest C', jaar: 2004, jaarBron: 'test', deezerId: 333, album: 'Album C', hoes: null, dekken: ['hits', 'nederland'], soort: 'hit', taal: 'nl' },
];
const LIMBURG = [
  { id: 100000, titel: 'Vastelaovesleedje', artiest: 'Beppie Kraft', jaar: 1986, jaarBron: 'test', deezerId: 444, album: null, hoes: null, dekken: ['limburg', 'vastelaovend', 'lvk'], soort: 'vastelaovend', taal: 'li', lvk: true },
  { id: 100001, titel: 'Zittesj leedje', artiest: 'De Marotte Zitterd', jaar: 2011, jaarBron: 'test', deezerId: 555, album: null, hoes: null, dekken: ['limburg', 'zittesj'], soort: 'vastelaovend', taal: 'li' },
];
writeFileSync(path.join(datamap, 'nummers-hits.json'), JSON.stringify({ aantal: HITS.length, nummers: HITS }));
writeFileSync(path.join(datamap, 'nummers-limburg.json'), JSON.stringify({ aantal: LIMBURG.length, nummers: LIMBURG }));
writeFileSync(
  path.join(datamap, 'index.json'),
  JSON.stringify({
    versie: 1,
    dekken: [
      { id: 'hits', naam: 'Grote hits', beschrijving: 'test', aantal: 3 },
      { id: 'limburg', naam: 'Limburgs', beschrijving: 'test', aantal: 2 },
    ],
    totalen: { hits: 3, limburg: 2, samen: 5 },
  }),
);

const { maakLokaleApi } = await import('../public/js/lokaal.js');
const { server } = await import('../server.js');
await new Promise((los) => server.listen(0, '127.0.0.1', los));
const basis = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const haalJsonBestand = async (pad) => JSON.parse(readFileSync(path.join(werkmap, pad), 'utf8'));
const lokaleApi = maakLokaleApi({ haalJson: haalJsonBestand });

async function vanServer(pad, lichaam = null) {
  const antwoord = await fetch(basis + pad, lichaam
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lichaam) }
    : undefined);
  return { status: antwoord.status, json: await antwoord.json() };
}

/* ── de vergelijking met de server ─────────────────────────────────────── */

test('de app geeft dezelfde versie, dekken en totalen als de server', async () => {
  const vanDeServer = await vanServer('/api/versie');
  const vanDeApp = await lokaleApi.verzoek('/api/versie');
  assert.equal(vanDeApp.naam, vanDeServer.json.naam);
  assert.deepEqual(vanDeApp.totalen, vanDeServer.json.totalen);
  assert.deepEqual(
    vanDeApp.dekken.map((d) => d.id),
    vanDeServer.json.dekken.map((d) => d.id),
  );
});

test('de app rekent de aantallen per dek hetzelfde uit als de server', async () => {
  const vanDeServer = await vanServer('/api/dekken');
  const vanDeApp = await lokaleApi.verzoek('/api/dekken');
  assert.deepEqual(vanDeApp, vanDeServer.json);
  const limburg = vanDeApp.dekken.find((d) => d.id === 'limburg');
  assert.equal(limburg.aantal, 2, 'beide Limburgse nummers zitten in dat dek');
});

test('onthullen geeft precies dezelfde kaart als de server', async () => {
  const vanDeServer = await vanServer('/api/onthul', { ids: [1, 100001, 999] });
  const vanDeApp = await lokaleApi.verzoek('/api/onthul', { ids: [1, 100001, 999] });
  assert.deepEqual(vanDeApp, vanDeServer.json);
  assert.equal(vanDeApp.kaarten.length, 2, 'een onbekend nummer valt weg');
  assert.equal(vanDeApp.kaarten[0].titel, 'Eerste hit');
  assert.equal(vanDeApp.kaarten[1].lvk, null, 'geen LVK-vlag betekent null, niet false');
});

test('de hint is hetzelfde decennium als bij de server', async () => {
  for (const id of [1, 2, 3, 100000]) {
    const vanDeServer = await vanServer('/api/hint', { id });
    const vanDeApp = await lokaleApi.verzoek('/api/hint', { id });
    assert.deepEqual(vanDeApp, vanDeServer.json, `nummer ${id}`);
  }
});

test('de liedlijst is gelijk aan die van de server, ook met zoeken en bladeren', async () => {
  for (const pad of [
    '/api/nummers?dek=hits',
    '/api/nummers?dek=hits&limiet=2',
    '/api/nummers?dek=hits&vanaf=1&limiet=5',
    '/api/nummers?dek=limburg&zoek=beppie',
    '/api/nummers?dek=zittesj',
  ]) {
    const vanDeServer = await vanServer(pad);
    const vanDeApp = await lokaleApi.verzoek(pad);
    assert.deepEqual(vanDeApp, vanDeServer.json, pad);
  }
});

test('trekken komt uit het gekozen dek en slaat gebruikte kaarten over', async () => {
  const vanDeApp = await lokaleApi.verzoek('/api/trek', { dekken: ['limburg'], gebruikt: [], aantal: 2 });
  const ids = vanDeApp.kaarten.map((k) => k.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => [100000, 100001].includes(id)), `onverwachte kaarten: ${ids}`);
  assert.equal(new Set(ids).size, 2, 'twee keer dezelfde kaart mag niet');
  assert.equal(vanDeApp.resterend, 0);

  await assert.rejects(
    () => lokaleApi.verzoek('/api/trek', { dekken: ['limburg'], gebruikt: ids, aantal: 1 }),
    /leeg/,
    'een lege stapel geeft dezelfde melding als de server',
  );
});

test('de app verfijnt het aanbod net zo als de server', async () => {
  const gevallen = [
    {},
    { jarenVan: 1990 },
    { jarenTot: 1990 },
    { jarenVan: 1980, jarenTot: 2005 },
    { alleenLvkInzending: true },
    { nooitGespeeld: true, gespeeld: [1, 100000] },
    { jarenVan: 1990, alleenLvkInzending: false, nooitGespeeld: true, gespeeld: [] },
  ];
  for (const verfijning of gevallen) {
    const vraag = { dekken: ['hits', 'limburg'], ...verfijning };
    const vanDeServer = await vanServer('/api/pool', vraag);
    const vanDeApp = await lokaleApi.verzoek('/api/pool', vraag);
    assert.deepEqual(vanDeApp, vanDeServer.json, `verfijning ${JSON.stringify(verfijning)}`);
  }
});

test('een jaarbereik telt en trekt in de app precies als in de server', async () => {
  // De jaren tachtig: alleen nummer 100000 (1986) valt daarbinnen.
  const vraag = { dekken: ['hits', 'limburg'], jarenVan: 1980, jarenTot: 1989 };
  const poolServer = await vanServer('/api/pool', vraag);
  assert.equal(poolServer.json.aantal, 1);
  assert.deepEqual(await lokaleApi.verzoek('/api/pool', vraag), poolServer.json);

  const trekVraag = { ...vraag, gebruikt: [], aantal: 1 };
  const vanDeServer = await vanServer('/api/trek', trekVraag);
  const vanDeApp = await lokaleApi.verzoek('/api/trek', trekVraag);
  assert.deepEqual(vanDeApp, vanDeServer.json);
  assert.equal(vanDeApp.kaarten[0].id, 100000, 'alleen het nummer uit de jaren tachtig');
});

test('"alleen LVK-inzendingen" laat het nummer zonder vlag vallen', async () => {
  const vraag = { dekken: ['limburg'], alleenLvkInzending: true };
  assert.deepEqual(await lokaleApi.verzoek('/api/pool', vraag), (await vanServer('/api/pool', vraag)).json);
  assert.equal((await vanServer('/api/pool', vraag)).json.aantal, 1, 'alleen nummer 100000 heeft lvk: true');
});

test('als een verfijning te streng staat zeggen app en server hetzelfde', async () => {
  const vraag = { dekken: ['hits'], jarenVan: 2020, alleenLvkInzending: true, gebruikt: [], aantal: 1 };
  const vanDeServer = await vanServer('/api/trek', vraag);
  assert.equal(vanDeServer.status, 409);
  assert.match(vanDeServer.json.fout, /verfijning/i);
  assert.match(vanDeServer.json.fout, /2020/);
  await assert.rejects(
    () => lokaleApi.verzoek('/api/trek', vraag),
    (fout) => fout.message === vanDeServer.json.fout,
    'dezelfde melding als de server',
  );
});

test('trekken geeft dezelfde vorm als de server', async () => {
  const vanDeServer = await vanServer('/api/trek', { dekken: ['hits'], gebruikt: [1], aantal: 1 });
  const vanDeApp = await lokaleApi.verzoek('/api/trek', { dekken: ['hits'], gebruikt: [1], aantal: 1 });
  assert.deepEqual(Object.keys(vanDeApp).sort(), Object.keys(vanDeServer.json).sort());
  assert.deepEqual(Object.keys(vanDeApp.kaarten[0]).sort(), Object.keys(vanDeServer.json.kaarten[0]).sort());
  assert.ok([2, 3].includes(vanDeApp.kaarten[0].id), 'kaart 1 is gebruikt en mag niet terugkomen');
  assert.equal(vanDeApp.resterend, 1);
});

/* ── fragmenten via de schil ───────────────────────────────────────────── */

test('het fragment komt via de schil bij Deezer vandaan', async () => {
  const gevraagd = [];
  const brug = {
    log: () => {},
    bron: (url) => {
      gevraagd.push(url);
      if (url.includes('api.deezer.com')) return JSON.stringify({ ok: true, status: 200, tekst: JSON.stringify({ preview: 'https://cdns-preview.example/1.mp3' }) });
      return JSON.stringify({ ok: true, status: 200, tekst: JSON.stringify({ results: [] }) });
    },
  };
  const api = maakLokaleApi({ haalJson: haalJsonBestand, brug });
  const uit = await api.verzoek('/api/fragment?id=1');
  assert.equal(uit.url, 'https://cdns-preview.example/1.mp3');
  assert.equal(uit.duur, 30);
  assert.ok(gevraagd[0].startsWith('https://api.deezer.com/track/111'), `eerste verzoek: ${gevraagd[0]}`);

  const nogEen = await api.verzoek('/api/fragment?id=1');
  assert.equal(nogEen.url, uit.url);
  assert.equal(gevraagd.length, 1, 'het tweede verzoek komt uit de bewaarde lijst');
});

test('zonder Deezer-fragment valt de app terug op iTunes', async () => {
  const gevraagd = [];
  const brug = {
    log: () => {},
    bron: (url) => {
      gevraagd.push(url);
      if (url.includes('api.deezer.com')) return JSON.stringify({ ok: true, status: 200, tekst: JSON.stringify({ preview: '' }) });
      return JSON.stringify({ ok: true, status: 200, tekst: JSON.stringify({ results: [{ previewUrl: 'https://itunes.example/2.m4a' }] }) });
    },
  };
  const api = maakLokaleApi({ haalJson: haalJsonBestand, brug });
  const uit = await api.verzoek('/api/fragment?id=2');
  assert.equal(uit.url, 'https://itunes.example/2.m4a');
  assert.ok(gevraagd.some((u) => u.includes('itunes.apple.com')));
});

test('zonder internet zegt de app dat, in plaats van een leeg fragment', async () => {
  const brug = { log: () => {}, bron: () => JSON.stringify({ ok: false, fout: 'geen verbinding' }) };
  const api = maakLokaleApi({ haalJson: haalJsonBestand, brug });
  await assert.rejects(() => api.verzoek('/api/fragment?id=1'), /geen verbinding/);
});

test('de schil mag alleen bij Deezer en iTunes naar buiten', async () => {
  const brug = {
    log: () => {},
    bron: () => {
      throw new Error('de schil mag hier niet gebeld worden');
    },
  };
  const api = maakLokaleApi({ haalJson: haalJsonBestand, brug });
  const nummer = { ...HITS[0] };
  const uit = await api.verzoek('/api/onthul', { ids: [nummer.id] });
  assert.equal(uit.kaarten[0].titel, 'Eerste hit');
});

test('beheer hoort bij de serverversie en wordt netjes geweigerd', async () => {
  const status = await lokaleApi.verzoek('/api/beheer/status');
  assert.equal(status.ingesteld, false);
  await assert.rejects(() => lokaleApi.verzoek('/api/beheer/eigen'), /serverversie/);
});

test('de app meldt zich met een marker die de rooktest kan lezen', async () => {
  const regels = [];
  const api = maakLokaleApi({ haalJson: haalJsonBestand, brug: { log: (t) => regels.push(t) } });
  await api.laad();
  assert.equal(api.aantalNummers(), 5);
  assert.ok(regels.some((r) => r.includes('SJPEELAVOND_KLAAR nummers=5')), `markers: ${regels.join(' | ')}`);
});
