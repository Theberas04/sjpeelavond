/**
 * Proeven op de klok van een fragment (public/js/fragment.js).
 *
 * De klok is de plek waar "op pauze zetten" goed of fout gaat: pauzeert hij echt, of begint
 * het liedje bij Verder weer van voren af aan? En telt de tijd dat er niet gespeeld werd mee
 * voor het biedspel "Stop 's"? Dat is zonder wachten na te rekenen doordat de tijd en de
 * timers van buitenaf meegegeven kunnen worden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maakKlok } from '../public/js/fragment.js';

/** Een nagemaakte tijd met timers die de proef zelf vooruit zet. */
function nepOmgeving() {
  let tijd = 0;
  const klussen = new Map();
  let volgnummer = 1;
  const zet = (fn, ms, herhaalt) => {
    const id = volgnummer++;
    klussen.set(id, { fn, op: tijd + ms, ms, herhaalt });
    return id;
  };
  return {
    nu: () => tijd,
    plan: (fn, ms) => zet(fn, ms, false),
    tik: (fn, ms) => zet(fn, ms, true),
    stopPlan: (id) => klussen.delete(id),
    stopTik: (id) => klussen.delete(id),
    /** De tijd vooruit zetten en alles uitvoeren wat dan aan de beurt is. */
    vooruit(ms) {
      const doel = tijd + ms;
      for (let stap = 0; stap < 10000; stap++) {
        const klaar = [...klussen.entries()]
          .filter(([, k]) => k.op <= doel)
          .sort((a, b) => a[1].op - b[1].op);
        if (!klaar.length) break;
        const [id, k] = klaar[0];
        tijd = Math.max(tijd, k.op);
        if (k.herhaalt) k.op = tijd + k.ms;
        else klussen.delete(id);
        k.fn();
      }
      tijd = doel;
    },
  };
}

function klokMet(seconden, omgeving) {
  const standen = [];
  let einden = 0;
  const klok = maakKlok(seconden, {
    ...omgeving,
    bijTeken: (verstreken, totaal) => standen.push([verstreken, totaal]),
    bijEinde: () => {
      einden++;
    },
  });
  return { klok, standen, einden: () => einden };
}

test('een fragment speelt van begin tot eind', () => {
  const omgeving = nepOmgeving();
  const { klok, standen, einden } = klokMet(3, omgeving);

  klok.start();
  assert.equal(klok.loopt(), true);
  assert.equal(klok.rest(), 3000);
  omgeving.vooruit(1500);
  assert.equal(klok.verstreken(), 1500);
  assert.equal(klok.rest(), 1500);

  omgeving.vooruit(1500);
  assert.equal(klok.verstreken(), 3000);
  assert.equal(klok.rest(), 0);
  assert.equal(klok.loopt(), false);
  assert.equal(einden(), 1, 'het einde wordt één keer gemeld');
  assert.deepEqual(standen.at(-1), [3000, 3000]);
});

test('pauzeren houdt de rest van het fragment, en Verder gaat daar verder', () => {
  const omgeving = nepOmgeving();
  const { klok, einden } = klokMet(30, omgeving);

  klok.start();
  omgeving.vooruit(10000);
  klok.pauzeer();
  assert.equal(klok.loopt(), false);
  assert.equal(klok.verstreken(), 10000);
  assert.equal(klok.rest(), 20000, 'er blijft 20 seconden over');

  // Een minuut wachten terwijl het op pauze staat: er mag niets van het fragment afgaan.
  omgeving.vooruit(60000);
  assert.equal(klok.verstreken(), 10000, 'de tijd op pauze telt niet mee');
  assert.equal(klok.rest(), 20000);
  assert.equal(einden(), 0, 'het fragment is niet afgelopen');

  klok.start();
  omgeving.vooruit(19000);
  assert.equal(klok.verstreken(), 29000);
  assert.equal(einden(), 0);
  omgeving.vooruit(1000);
  assert.equal(klok.verstreken(), 30000);
  assert.equal(einden(), 1);
});

test('de gespeelde tijd is wat Stop \'s moet weten, niet de kloktijd', () => {
  const omgeving = nepOmgeving();
  const { klok } = klokMet(30, omgeving);

  klok.start();
  omgeving.vooruit(4000);
  klok.pauzeer();
  omgeving.vooruit(30000); // denk aan een speler die blijft hangen
  klok.start();
  omgeving.vooruit(2000);
  klok.pauzeer();

  assert.equal(Math.round(klok.verstreken() / 1000), 6, 'vier plus twee seconden gespeeld');
});

test('opnieuw beginnen zet de klok op nul', () => {
  const omgeving = nepOmgeving();
  const { klok } = klokMet(30, omgeving);

  klok.start();
  omgeving.vooruit(30000);
  assert.equal(klok.rest(), 0);

  klok.opnieuw();
  assert.equal(klok.verstreken(), 0);
  assert.equal(klok.rest(), 30000);

  klok.start();
  omgeving.vooruit(1000);
  assert.equal(klok.verstreken(), 1000);
});

test('een klok die afgelopen is begint niet vanzelf opnieuw', () => {
  const omgeving = nepOmgeving();
  const { klok, einden } = klokMet(3, omgeving);

  klok.start();
  omgeving.vooruit(3000);
  assert.equal(einden(), 1);

  klok.start(); // zonder opnieuw() hoort er niets te gebeuren
  omgeving.vooruit(5000);
  assert.equal(einden(), 1, 'het einde wordt niet nog eens gemeld');
  assert.equal(klok.verstreken(), 3000);
});

test('twee keer starten laat de klok niet dubbel lopen', () => {
  const omgeving = nepOmgeving();
  const { klok, einden } = klokMet(3, omgeving);

  klok.start();
  omgeving.vooruit(1000);
  klok.start();
  omgeving.vooruit(2000);
  assert.equal(klok.verstreken(), 3000);
  assert.equal(einden(), 1);
});

test('een fragment zonder tijd wordt één seconde, zodat er altijd iets te horen is', () => {
  const omgeving = nepOmgeving();
  const { klok, einden } = klokMet(0, omgeving);
  assert.equal(klok.totaal, 1000);
  klok.start();
  assert.equal(klok.loopt(), true);
  omgeving.vooruit(1000);
  assert.equal(einden(), 1);
});
