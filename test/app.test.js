/**
 * Testsuite voor Sjpeelavond: spellogica, serverroutes en de dataset.
 * Draaien: node --test test/
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as S from '../public/js/spel.js';

/* ── testomgeving klaarzetten vóór de server geladen wordt ─────────────── */

const werkmap = mkdtempSync(path.join(tmpdir(), 'sjpeelavond-'));
const datamap = path.join(werkmap, 'data');
process.env.SJPEELAVOND_DATA = datamap;
process.env.SJPEELAVOND_DB = path.join(datamap, 'eigen.db');
process.env.SJPEELAVOND_MEDIA = path.join(werkmap, 'media');
process.env.SJPEELAVOND_WACHTWOORD = 'testwachtwoord';
process.env.POORT = '0';

const { mkdirSync } = await import('node:fs');
mkdirSync(datamap, { recursive: true });
mkdirSync(process.env.SJPEELAVOND_MEDIA, { recursive: true });

writeFileSync(
  path.join(datamap, 'nummers-hits.json'),
  JSON.stringify({
    aantal: 2,
    nummers: [
      { id: 1, titel: 'Testhit', artiest: 'Testartiest', jaar: 1985, jaarBron: 'test', deezerId: 111, hoes: null, dekken: ['hits', 'nederland'], soort: 'hit', taal: 'nl' },
      { id: 2, titel: 'Tweede hit', artiest: 'Andere artiest', jaar: 1999, jaarBron: 'test', deezerId: 222, hoes: null, dekken: ['hits'], soort: 'hit', taal: 'anders' },
    ],
  }),
);
writeFileSync(
  path.join(datamap, 'nummers-limburg.json'),
  JSON.stringify({
    aantal: 1,
    nummers: [
      { id: 100000, titel: 'Vastelaovesleedje', artiest: 'Beppie Kraft', jaar: 1986, jaarBron: 'test', deezerId: 333, hoes: null, dekken: ['limburg', 'vastelaovend', 'lvk'], soort: 'vastelaovend', taal: 'li', lvk: true },
    ],
  }),
);
writeFileSync(
  path.join(datamap, 'index.json'),
  JSON.stringify({ versie: 1, dekken: [{ id: 'hits', naam: 'Grote hits', beschrijving: 'test', aantal: 2 }], totalen: { hits: 2, limburg: 1, samen: 3 } }),
);

const { server } = await import('../server.js');
await new Promise((los) => server.listen(0, '127.0.0.1', los));
const basis = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());
const haal = async (pad, opties) => {
  const antwoord = await fetch(basis + pad, opties);
  const tekst = await antwoord.text();
  let json = null;
  try {
    json = JSON.parse(tekst);
  } catch {}
  return { status: antwoord.status, json, tekst, koppen: antwoord.headers };
};
const post = (pad, lichaam, koppen = {}) =>
  haal(pad, { method: 'POST', headers: { 'content-type': 'application/json', ...koppen }, body: JSON.stringify(lichaam) });

/* ── spellogica ────────────────────────────────────────────────────────── */

test('juistePlek zet een jaartal op de eerste plek waar het past', () => {
  const tijdlijn = [{ jaar: 1970 }, { jaar: 1990 }, { jaar: 2005 }];
  assert.equal(S.juistePlek(tijdlijn, 1960), 0);
  assert.equal(S.juistePlek(tijdlijn, 1980), 1);
  assert.equal(S.juistePlek(tijdlijn, 1990), 2);
  assert.equal(S.juistePlek(tijdlijn, 2020), 3);
});

test('plaatsingGoed keurt goed, fout en gelijke jaartallen goed', () => {
  const tijdlijn = [{ jaar: 1970 }, { jaar: 1990 }, { jaar: 2005 }];
  assert.equal(S.plaatsingGoed(tijdlijn, 1980, 1), true);
  assert.equal(S.plaatsingGoed(tijdlijn, 1960, 0), true);
  assert.equal(S.plaatsingGoed(tijdlijn, 2020, 3), true);
  assert.equal(S.plaatsingGoed(tijdlijn, 1980, 0), false, 'na 1990 gelegd is fout');
  assert.equal(S.plaatsingGoed(tijdlijn, 1990, 2), true, 'gelijk jaartal mag ervoor');
  assert.equal(S.plaatsingGoed(tijdlijn, 1990, 1), true, 'gelijk jaartal mag ernaast');
  assert.equal(S.plaatsingGoed(tijdlijn, 1990, 3), false);
});

test('voegJuistToe plaatst een kaart op de juiste plek', () => {
  const tijdlijn = [{ jaar: 1970 }, { jaar: 2000 }];
  const uit = S.voegJuistToe(tijdlijn, { jaar: 1980, titel: 'x' });
  assert.deepEqual(uit.map((k) => k.jaar), [1970, 1980, 2000]);
  assert.deepEqual(tijdlijn.map((k) => k.jaar), [1970, 2000], 'de originele tijdlijn blijft staan');
});

test('maakSpel zet spelers, fiches en het doel klaar', () => {
  const spel = S.maakSpel({ soort: 'hittepetit', namen: ['Tom', ' ', 'Ilse'], dekken: ['vastelaovend'] });
  assert.equal(spel.spelers.length, 2, 'lege namen vallen af');
  assert.equal(spel.doel, 5);
  assert.equal(spel.spelers[0].fiches, 2);
  assert.deepEqual(spel.dekken, ['vastelaovend']);
  assert.notEqual(spel.spelers[0].kleur, spel.spelers[1].kleur);
});

test('beoordeelPlaatsing houdt een goede kaart en gooit een foute weg', () => {
  const spel = S.maakSpel({ soort: 'tijdlijn', namen: ['A', 'B'], doel: 2 });
  spel.spelers[0].tijdlijn = [{ jaar: 1980, titel: 'vast', artiest: 'x' }];
  S.legKaart(spel, { id: 5 });
  S.onthulHuidig(spel, { id: 5, titel: 'nieuw', artiest: 'y', jaar: 1990 });
  const goed = S.beoordeelPlaatsing(spel, 0, 1);
  assert.equal(goed.goed, true);
  assert.equal(spel.spelers[0].goed, 1);
  assert.equal(spel.spelers[0].tijdlijn.length, 2);

  S.legKaart(spel, { id: 6 });
  S.onthulHuidig(spel, { id: 6, titel: 'fout', artiest: 'z', jaar: 1970 });
  const fout = S.beoordeelPlaatsing(spel, 0, 2);
  assert.equal(fout.goed, false);
  assert.equal(spel.spelers[0].fout, 1);
  assert.equal(spel.spelers[0].tijdlijn.length, 2, 'de foute kaart komt er niet in');
});

test('wie het doel haalt, beëindigt het spel', () => {
  const spel = S.maakSpel({ soort: 'tijdlijn', namen: ['A', 'B'], doel: 1 });
  spel.spelers[0].tijdlijn = [{ jaar: 1980 }];
  S.legKaart(spel, { id: 9 });
  S.onthulHuidig(spel, { id: 9, titel: 't', artiest: 'a', jaar: 1990 });
  S.beoordeelPlaatsing(spel, 0, 1);
  assert.equal(spel.fase, 'afgelopen');
  assert.equal(spel.winnaar, 0);
});

test('fiches: niet meer dan het maximum, en overslaan kost er één', () => {
  const spel = S.maakSpel({ soort: 'tijdlijn', namen: ['A', 'B'] });
  S.geefFiche(spel, 0, 10);
  assert.equal(spel.spelers[0].fiches, S.SPELLEN.tijdlijn.fichesMax);
  S.legKaart(spel, { id: 3 });
  assert.equal(S.slaOver(spel, 0).gelukt, true);
  assert.equal(spel.spelers[0].fiches, 4);
  assert.equal(spel.huidig, null);
  assert.equal(S.slaOver(spel, 1).gelukt, true);
  assert.equal(S.slaOver(spel, 1).gelukt, true);
  assert.equal(spel.spelers[1].fiches, 0);
  assert.equal(S.slaOver(spel, 1).gelukt, false, 'zonder fiche niet nog eens');
});

test('een kaart kopen kost drie fiches', () => {
  const spel = S.maakSpel({ soort: 'tijdlijn', namen: ['A', 'B'] });
  assert.equal(S.koopKaart(spel, 0).gelukt, false, 'twee fiches is te weinig');
  S.geefFiche(spel, 0, 1);
  assert.equal(S.koopKaart(spel, 0).gelukt, true);
  assert.equal(spel.spelers[0].fiches, 0);
});

test('stelen lukt alleen met de juiste plek in andermans tijdlijn', () => {
  const spel = S.maakSpel({ soort: 'tijdlijn', namen: ['A', 'B'], doel: 10 });
  spel.spelers[0].tijdlijn = [{ jaar: 1980 }, { jaar: 2000 }];
  spel.beurt = 0;
  S.legKaart(spel, { id: 11 });
  S.onthulHuidig(spel, { id: 11, titel: 'steel', artiest: 'x', jaar: 1990 });
  const goed = S.steel(spel, 1, 0, 1);
  assert.equal(goed.goed, true);
  assert.deepEqual(spel.spelers[1].tijdlijn.map((k) => k.jaar), [1990], 'de dief krijgt de kaart in zijn eigen tijdlijn');
  assert.equal(spel.spelers[1].fiches, 1);

  S.legKaart(spel, { id: 12 });
  S.onthulHuidig(spel, { id: 12, titel: 'mis', artiest: 'y', jaar: 1975 });
  const fout = S.steel(spel, 1, 0, 1);
  assert.equal(fout.goed, false);
  assert.equal(spel.spelers[1].fiches, 0);
});

test('Stop \'s geeft meer punten bij een sneller antwoord', () => {
  assert.equal(S.stopPunten(1.2), 3);
  assert.equal(S.stopPunten(4), 2);
  assert.equal(S.stopPunten(9), 1);
});

test('punten geven eindigt het spel bij het doel', () => {
  const spel = S.maakSpel({ soort: 'raojs', variant: 'zings', namen: ['A', 'B'], doel: 2 });
  S.geefPunten(spel, [1], 1);
  assert.equal(spel.fase, 'start', 'nog niet klaar');
  S.geefPunten(spel, [1], 1);
  assert.equal(spel.fase, 'afgelopen');
  assert.equal(spel.winnaar, 1);
});

test('volgendeBeurt slaat spelers over die al klaar zijn', () => {
  const spel = S.maakSpel({ soort: 'tijdlijn', namen: ['A', 'B', 'C'] });
  spel.spelers[1].klaar = true;
  spel.beurt = 0;
  assert.equal(S.volgendeBeurt(spel), 2);
});

test('isGeldigeStaat keurt onzin af', () => {
  assert.equal(S.isGeldigeStaat(null), false);
  assert.equal(S.isGeldigeStaat({ soort: 'onbekend', spelers: [{}] }), false);
  assert.equal(S.isGeldigeStaat(S.maakSpel({ namen: ['A'] })), true);
});

/* ── server ────────────────────────────────────────────────────────────── */

test('healthz antwoordt ok en draagt het eigen kenmerk', async () => {
  const uit = await haal('/healthz');
  assert.equal(uit.status, 200);
  assert.equal(uit.tekst.trim(), 'ok');
  assert.equal(uit.koppen.get('x-sjpeelavond'), 'app');
});

test('de pagina en de modules worden geserveerd', async () => {
  const pagina = await haal('/');
  assert.equal(pagina.status, 200);
  assert.match(pagina.tekst, /Sjpeelavond/);
  assert.match(pagina.koppen.get('cache-control') || '', /no-cache/);
  const module = await haal('/js/spel.js');
  assert.equal(module.status, 200);
  assert.match(module.tekst, /export function maakSpel/);
});

test('een raar pad kraakt de server niet', async () => {
  const uit = await haal('//');
  assert.ok([200, 400, 404].includes(uit.status));
  const daarna = await haal('/healthz');
  assert.equal(daarna.status, 200, 'de server leeft nog');
  const uitbraak = await haal('/..%2fserver.js');
  assert.notEqual(uitbraak.status, 200, 'bestanden buiten public/ komen niet naar buiten');
});

test('versie en dekken kloppen met de dataset', async () => {
  const uit = await haal('/api/versie');
  assert.equal(uit.status, 200);
  assert.equal(uit.json.totalen.hits, 2);
  const namen = uit.json.dekken.map((d) => d.id);
  assert.ok(namen.includes('hits'));
});

test('trekken geeft alleen een id, nooit het jaartal', async () => {
  const uit = await post('/api/trek', { dekken: ['hits'], gebruikt: [], aantal: 2 });
  assert.equal(uit.status, 200);
  assert.equal(uit.json.kaarten.length, 2);
  for (const kaart of uit.json.kaarten) {
    assert.deepEqual(Object.keys(kaart), ['id'], 'de kaart mag nog niets verklappen');
  }
  const tweede = await post('/api/trek', { dekken: ['hits'], gebruikt: [uit.json.kaarten[0].id], aantal: 1 });
  assert.equal(tweede.json.kaarten.length, 1);
  assert.notEqual(tweede.json.kaarten[0].id, uit.json.kaarten[0].id, 'gebruikte kaarten komen niet terug');
});

test('een lege stapel geeft een nette melding', async () => {
  const uit = await post('/api/trek', { dekken: ['limburg'], gebruikt: [100000], aantal: 1 });
  assert.equal(uit.status, 409);
  assert.match(uit.json.fout, /leeg/i);
});

test('onthullen geeft titel, artiest en jaartal', async () => {
  const uit = await post('/api/onthul', { ids: [1, 100000] });
  assert.equal(uit.status, 200);
  assert.equal(uit.json.kaarten[0].titel, 'Testhit');
  assert.equal(uit.json.kaarten[0].jaar, 1985);
  assert.equal(uit.json.kaarten[1].lvk, true);
});

test('de hint geeft alleen het decennium', async () => {
  const uit = await post('/api/hint', { id: 1 });
  assert.equal(uit.status, 200);
  assert.equal(uit.json.decennium, 1980);
  assert.equal(uit.json.jaar, undefined, 'het jaartal zelf blijft geheim');
});

test('de muzieklijst filtert en pagineert', async () => {
  const alles = await haal('/api/nummers?dek=hits');
  assert.equal(alles.json.totaal, 2);
  const gefilterd = await haal('/api/nummers?dek=hits&zoek=testhit');
  assert.equal(gefilterd.json.totaal, 1);
  assert.equal(gefilterd.json.nummers[0].jaar, 1985);
  const pagina = await haal('/api/nummers?dek=hits&limiet=1&vanaf=1');
  assert.equal(pagina.json.nummers.length, 1);
});

test('een onbekend nummer levert geen fragment op', async () => {
  const uit = await haal('/api/fragment?id=999999');
  assert.equal(uit.status, 404);
});

test('beheer: zonder wachtwoord geen toegang, met wachtwoord wel', async () => {
  const status = await haal('/api/beheer/status');
  assert.equal(status.json.ingesteld, true, 'het testwachtwoord is ingesteld');

  const zonderSessie = await haal('/api/beheer/eigen');
  assert.equal(zonderSessie.status, 403);

  const fout = await post('/api/beheer/inloggen', { wachtwoord: 'verkeerd' });
  assert.equal(fout.status, 401);

  const goed = await post('/api/beheer/inloggen', { wachtwoord: 'testwachtwoord' });
  assert.equal(goed.status, 200);
  const koekje = (goed.koppen.get('set-cookie') || '').split(';')[0];
  assert.match(koekje, /^sessie=[0-9a-f]{64}$/);

  const metSessie = await haal('/api/beheer/eigen', { headers: { cookie: koekje } });
  assert.equal(metSessie.status, 200);
  assert.deepEqual(metSessie.json.nummers, []);

  const upload = await haal('/api/beheer/eigen', {
    method: 'POST',
    headers: {
      cookie: koekje,
      'x-titel': 'Eigen liedje',
      'x-artiest': 'Tom',
      'x-jaar': '1975',
      'x-bestandsnaam': encodeURIComponent('liedje.mp3'),
      'content-type': 'audio/mpeg',
    },
    body: Buffer.from('nep-audio'),
  });
  assert.equal(upload.status, 200);
  assert.ok(upload.json.id >= 900000);

  const lijst = await haal('/api/beheer/eigen', { headers: { cookie: koekje } });
  assert.equal(lijst.json.nummers.length, 1);

  const dekken = await haal('/api/dekken');
  assert.equal(dekken.json.dekken.find((d) => d.id === 'eigen').aantal, 1, 'eigen nummers komen in een eigen dek');

  const trek = await post('/api/trek', { dekken: ['eigen'], gebruikt: [], aantal: 1 });
  assert.equal(trek.status, 200);
  const media = await haal(`/api/media/${lijst.json.nummers[0].bestand}`);
  assert.equal(media.status, 200);
  assert.equal(media.tekst, 'nep-audio');

  const verwijderen = await haal(`/api/beheer/eigen/${upload.json.id}`, { method: 'DELETE', headers: { cookie: koekje } });
  assert.equal(verwijderen.status, 200);
  const na = await haal('/api/beheer/eigen', { headers: { cookie: koekje } });
  assert.equal(na.json.nummers.length, 0);
});

test('een onvolledig eigen nummer wordt geweigerd', async () => {
  const goed = await post('/api/beheer/inloggen', { wachtwoord: 'testwachtwoord' });
  const koekje = (goed.koppen.get('set-cookie') || '').split(';')[0];
  const uit = await haal('/api/beheer/eigen', {
    method: 'POST',
    headers: { cookie: koekje, 'x-titel': 'Zonder jaartal', 'x-artiest': 'Tom', 'x-bestandsnaam': 'a.mp3' },
    body: Buffer.from('x'),
  });
  assert.equal(uit.status, 400);
});

test('uitloggen maakt de sessie ongeldig', async () => {
  const goed = await post('/api/beheer/inloggen', { wachtwoord: 'testwachtwoord' });
  const koekje = (goed.koppen.get('set-cookie') || '').split(';')[0];
  await post('/api/beheer/uitloggen', {}, { cookie: koekje });
  const uit = await haal('/api/beheer/eigen', { headers: { cookie: koekje } });
  assert.equal(uit.status, 403);
});

/* ── dataset (alleen als de echte bestanden er zijn) ───────────────────── */

test('elke knop in de pagina is ook echt aangesloten', () => {
  // Een knop zonder data-act en zonder eigen luisteraar doet zichtbaar niets:
  // dat is precies hoe "Spelen maar" een scherm lang stil bleef staan.
  const html = readFileSync(path.resolve(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');
  const app = readFileSync(path.resolve(import.meta.dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const knoppen = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.ok(knoppen.length > 5, 'de pagina hoort knoppen te hebben');
  const onbedraad = knoppen.filter((knop) => {
    // Een knop is aangesloten als hij een data-attribuut heeft (de afhandeling zoekt
    // daarop) of als de app zijn id opzoekt en er zelf een luisteraar aan hangt.
    if (/\sdata-[a-z-]+=/.test(knop)) return false;
    const id = /id="([^"]+)"/.exec(knop)?.[1];
    if (!id) return true;
    return !app.includes(`#${id}`);
  });
  assert.deepEqual(onbedraad, [], 'deze knoppen hebben geen data-act en geen eigen luisteraar');
});

test('elke data-act in de pagina heeft een afhandeling in de app', () => {
  const html = readFileSync(path.resolve(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');
  const app = readFileSync(path.resolve(import.meta.dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const acties = [...new Set([...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]))];
  const zonderAfhandeling = acties.filter((act) => !app.includes(`'${act}'`) && !app.includes(`"${act}"`));
  assert.deepEqual(zonderAfhandeling, [], 'deze acties worden nergens afgehandeld');
});

const echteData = path.resolve(import.meta.dirname, '..', 'data');
test('de gebouwde dataset is compleet en speelbaar', { skip: !existsSync(path.join(echteData, 'nummers-hits.json')) }, () => {
  const hits = JSON.parse(readFileSync(path.join(echteData, 'nummers-hits.json'), 'utf8'));
  const limburg = JSON.parse(readFileSync(path.join(echteData, 'nummers-limburg.json'), 'utf8'));
  const index = JSON.parse(readFileSync(path.join(echteData, 'index.json'), 'utf8'));

  assert.ok(hits.nummers.length > 300, `verwacht honderden hits, kreeg ${hits.nummers.length}`);
  assert.ok(limburg.nummers.length > 50, `verwacht tientallen Limburgse nummers, kreeg ${limburg.nummers.length}`);

  for (const nummer of [...hits.nummers, ...limburg.nummers]) {
    assert.ok(Number.isInteger(nummer.id) && nummer.id > 0, 'elk nummer heeft een id');
    assert.ok(nummer.titel && nummer.artiest, `titel en artiest van ${nummer.id}`);
    assert.ok(nummer.jaar >= 1930 && nummer.jaar <= 2100, `jaartal van ${nummer.titel}: ${nummer.jaar}`);
    assert.ok(nummer.deezerId, `deezerId van ${nummer.titel}`);
    assert.ok(Array.isArray(nummer.dekken) && nummer.dekken.length, `dekken van ${nummer.titel}`);
  }

  const ids = new Set([...hits.nummers, ...limburg.nummers].map((n) => n.id));
  assert.equal(ids.size, hits.nummers.length + limburg.nummers.length, 'ids zijn uniek over alle bestanden');

  const hitIds = hits.nummers.map((n) => n.id);
  assert.ok(Math.max(...hitIds) < 100000, 'hit-ids blijven onder de eigen-nummersbasis');
  assert.ok(limburg.nummers.every((n) => n.id >= 100000 && n.id < 900000), 'Limburgse ids zitten in hun eigen bereik');

  for (const dek of index.dekken) assert.ok(dek.aantal > 0, `dek ${dek.id} is niet leeg`);
  assert.ok(index.dekken.some((d) => d.id === 'vastelaovend' && d.aantal > 50), 'het vastelaovenddek heeft genoeg muziek');

  const limburgTitels = new Set(limburg.nummers.map((n) => `${n.titel.toLowerCase()}|${n.artiest.toLowerCase()}`));
  assert.equal(limburgTitels.size, limburg.nummers.length, 'geen dubbele Limburgse nummers');
});
