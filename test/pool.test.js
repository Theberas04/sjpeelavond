/**
 * Proeven op de zeef: welke nummers mogen er getrokken worden?
 *
 * De server en de app gebruiken allebei public/js/pool.js; deze proeven leggen de regels vast
 * waar ze het over eens moeten zijn. De vergelijkingsproef in test/app.test.js controleert
 * daarnaast dat ze bij een echt verzoek hetzelfde antwoorden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maakZeef, zeefPool, filtersActief, filterTekst, legeStapelTekst, verfijningUit } from '../public/js/pool.js';

const NUMMERS = [
  { id: 1, titel: 'Oud', jaar: 1975, dekken: ['hits', 'nederland'], lvk: null },
  { id: 2, titel: 'Midden', jaar: 1998, dekken: ['hits'], lvk: null },
  { id: 3, titel: 'Vastelaovend', jaar: 2010, dekken: ['limburg', 'vastelaovend'], lvk: true },
  { id: 4, titel: 'Geen inzending', jaar: 2014, dekken: ['limburg', 'lvk'], lvk: false },
  { id: 5, titel: 'Recenter', jaar: 2022, dekken: ['hits', 'limburg'], lvk: true },
];

test('zonder verfijning laat de zeef alles door', () => {
  const uit = zeefPool(NUMMERS, {});
  assert.deepEqual(
    uit.map((n) => n.id),
    [1, 2, 3, 4, 5],
  );
});

test('een jaarbereik laat alleen de jaren daarbinnen door', () => {
  assert.deepEqual(
    zeefPool(NUMMERS, { jarenVan: 1990, jarenTot: 2015 }).map((n) => n.id),
    [2, 3, 4],
  );
  assert.deepEqual(
    zeefPool(NUMMERS, { jarenVan: 2010 }).map((n) => n.id),
    [3, 4, 5],
  );
  assert.deepEqual(
    zeefPool(NUMMERS, { jarenTot: 1998 }).map((n) => n.id),
    [1, 2],
  );
});

test('"alleen LVK-inzendingen" laat de onbekende gevallen vallen', () => {
  // Van veel nummers is het niet bekend (null); die horen hier niet bij te zitten.
  assert.deepEqual(
    zeefPool(NUMMERS, { alleenLvkInzending: true }).map((n) => n.id),
    [3, 5],
  );
});

test('de dekkenfilter werkt naast de andere filters', () => {
  const uit = zeefPool(NUMMERS, { dekken: ['limburg'], jarenVan: 2012 });
  assert.deepEqual(
    uit.map((n) => n.id),
    [4, 5],
  );
});

test('"niets van een eerdere keer" slaat de gespeelde nummers over', () => {
  assert.deepEqual(
    zeefPool(NUMMERS, { nooitGespeeld: true, gespeeld: [2, 5] }).map((n) => n.id),
    [1, 3, 4],
  );
});

test('wat in dit potje al op tafel ligt komt er niet nog eens in', () => {
  assert.deepEqual(
    zeefPool(NUMMERS, { gebruikt: [1, 3] }).map((n) => n.id),
    [2, 4, 5],
  );
});

test('de filters werken samen: te streng betekent niets', () => {
  const uit = zeefPool(NUMMERS, { dekken: ['hits'], jarenVan: 2020, alleenLvkInzending: false });
  assert.deepEqual(
    uit.map((n) => n.id),
    [5],
  );
  assert.equal(zeefPool(NUMMERS, { dekken: ['hits'], jarenVan: 2020, alleenLvkInzending: false, gebruikt: [5] }).length, 0);
});

test('een nummer zonder jaar valt af zodra er een jaarbereik is', () => {
  const zeef = maakZeef({ jarenVan: 1990 });
  assert.equal(zeef({ id: 9, jaar: null, dekken: ['hits'] }), false);
  // En zonder jaarbereik mag het gewoon mee.
  assert.equal(maakZeef({})({ id: 9, jaar: null, dekken: ['hits'] }), true);
});

test('de leesbare regel vertelt wat er aanstaat', () => {
  assert.equal(filterTekst({}), '');
  assert.equal(filterTekst({ jarenVan: 1990, jarenTot: 2005 }), '1990–2005');
  assert.equal(filterTekst({ jarenVan: 1990 }), 'vanaf 1990');
  assert.equal(filterTekst({ jarenTot: 2005 }), 'tot 2005');
  assert.equal(
    filterTekst({ jarenVan: 1990, jarenTot: 2005, alleenLvkInzending: true, nooitGespeeld: true }),
    '1990–2005 · alleen LVK-inzendingen · niets van een eerdere keer',
  );
});

test('er is te zien of er iets verfijnd is, en wat de app dan zegt', () => {
  assert.equal(filtersActief({}), false);
  assert.equal(filtersActief({ alleenLvkInzending: true }), true);
  assert.equal(filtersActief({ jarenVan: 1990 }), true);
  assert.equal(filtersActief({ nooitGespeeld: true }), true);
  assert.equal(filtersActief({ dekken: ['hits'] }), false, 'dekken kiezen is niet verfijnen');

  assert.equal(legeStapelTekst({}), 'Deze dekstapel is leeg. Kies een ander dek of begin opnieuw.');
  assert.match(legeStapelTekst({ alleenLvkInzending: true }), /alleen LVK-inzendingen/);
});

test('een verzoek wordt op dezelfde manier gelezen als in de server', () => {
  const verfijning = verfijningUit(
    { jarenVan: '1990', jarenTot: 2005, alleenLvkInzending: true, nooitGespeeld: true, gespeeld: ['2'] },
    ['hits'],
    [3],
  );
  assert.deepEqual(verfijning, {
    dekken: ['hits'],
    jarenVan: '1990',
    jarenTot: 2005,
    alleenLvkInzending: true,
    nooitGespeeld: true,
    gespeeld: ['2'],
    gebruikt: [3],
  });
  // Alleen de letterlijke `true` telt; "ja" of 1 doet niets.
  assert.equal(verfijningUit({ alleenLvkInzending: 'ja' }, ['hits'], []).alleenLvkInzending, false);
  assert.deepEqual(
    zeefPool(NUMMERS, verfijningUit({ jarenVan: '1990' }, ['hits'], [])).map((n) => n.id),
    [2, 5],
    'ook een jaartal dat als tekst binnenkomt werkt',
  );
});
