/**
 * Proeven op het lezen van de kaartjes (public/js/kaart.js).
 *
 * Er is geen camera bij nodig: dit gaat over de vraag wat er met de code van een kaartje
 * gebeurt. De QR-code zelf wordt in de app door de schil uitgelezen en hier als tekst
 * aangeboden, dus dit is precies de grens waar de app zijn werk doet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haalRaojsFragment, kandidaten, leesEmbed, leesKaart, losOp, zoekLied } from '../public/js/kaart.js';

/**
 * Een nagemaakte WebSocket: hij speelt het gesprek van de web-app van Raoj 's na, zodat
 * deze proef geen internet nodig heeft. Wat de app stuurt, houdt hij bij in `gesprek`.
 */
function nagemaakteRaojsSocket(uitkomst = 'preview/93984', { fout = null } = {}) {
  const gesprek = [];
  const maakSocket = (adres) => {
    const sok = {
      adres,
      gesloten: false,
      send(tekst) {
        const m = JSON.parse(tekst);
        gesprek.push(m);
        if (m.msg === 'connect') {
          queueMicrotask(() => sok.onmessage({ data: JSON.stringify({ msg: 'connected', session: 'proef' }) }));
        } else if (m.msg === 'method') {
          queueMicrotask(() =>
            sok.onmessage({
              data: JSON.stringify(fout ? { msg: 'result', id: m.id, error: fout } : { msg: 'result', id: m.id, result: uitkomst }),
            }),
          );
        }
      },
      close() {
        sok.gesloten = true;
      },
    };
    // De verbinding komt even later tot stand, net als bij een echte WebSocket.
    queueMicrotask(() => sok.onopen?.());
    return sok;
  };
  return { maakSocket, gesprek };
}

const TABEL = {
  edities: {
    aaaa0001: { taal: 'Netherlands', naam: 'Hitster Original' },
    aaaa0029: { taal: 'Netherlands', naam: 'Hitster Original - 100% NL' },
    aaaa0002: { taal: 'Germany', naam: 'Hitster Original' },
  },
  kaarten: {
    aaaa0001: { '00308': 'spotify-original-308', '00012': 'spotify-original-12' },
    aaaa0029: { '00012': 'spotify-honderd-nl-12' },
    aaaa0002: { '00012': 'spotify-duits-12' },
  },
};

function embedHtml(nummer) {
  const gegevens = {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              type: 'track',
              name: nummer.titel,
              id: nummer.id,
              artists: nummer.artiesten.map((naam) => ({ name: naam })),
              releaseDate: { isoString: `${nummer.jaar}-03-10T00:00:00Z` },
              isPlayable: true,
              audioPreview: { url: `https://p.scdn.co/mp3-preview/${nummer.id}` },
              visualIdentity: { image: [{ url: 'https://i.scdn.co/image/klein' }, { url: 'https://i.scdn.co/image/groot' }] },
            },
          },
        },
      },
    },
  };
  return `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(gegevens)}</script></head></html>`;
}

test('de codes van een kaartje worden gelezen', () => {
  assert.deepEqual(leesKaart('https://www.hitstergame.com/nl/aaaa0001/00308'), {
    spel: 'hitster',
    taal: 'nl',
    editie: 'aaaa0001',
    kaart: '00308',
    ruw: 'https://www.hitstergame.com/nl/aaaa0001/00308',
  });

  const zonderWww = leesKaart('http://hitstergame.com/de/aaaa0002/00012');
  assert.equal(zonderWww.editie, 'aaaa0002');
  assert.equal(zonderWww.taal, 'de');

  // De oudere kaartjes hebben geen editie in het adres.
  const oud = leesKaart('http://www.hitstergame.com/de/00268');
  assert.equal(oud.editie, null);
  assert.equal(oud.kaart, '00268');

  // Wat je met de hand intypt.
  assert.equal(leesKaart('aaaa0001/00308').editie, 'aaaa0001');
  assert.equal(leesKaart('308').kaart, '308');
  assert.equal(leesKaart('  00308  ').kaart, '00308');
  assert.equal(leesKaart('"https://www.hitstergame.com/nl/aaaa0001/00308"').editie, 'aaaa0001');
});

test('de andere twee spellen worden herkend maar niet nagespeeld', () => {
  assert.equal(leesKaart('https://raojs.nl/kaart/12').spel, 'raojs');
  assert.equal(leesKaart('https://www.marotte.nl/hittepetit/kaart-4').spel, 'hittepetit');
  assert.equal(leesKaart('zomaar wat tekst').spel, 'onbekend');
  assert.equal(leesKaart('').spel, 'onbekend');
  assert.equal(leesKaart(null).spel, 'onbekend');
});

test('de echte kaartjes van Raoj \'s en Hittepetit worden met hun nummer gelezen', () => {
  // De vorm van de Hittepetit-code is nagegaan op foto's van echte kaartjes.
  const hittepetit = leesKaart('https://hittepetit.radiononnevot.nl/q/HP0132');
  assert.equal(hittepetit.spel, 'hittepetit');
  assert.equal(hittepetit.kaart, 'HP0132');

  // Zo bouwt de web-app van Raoj 's zijn codes (zie docs/onderzoek-kaartscanners.md).
  const raojs = leesKaart('https://app.raojs.nl?id=L2025_001');
  assert.equal(raojs.spel, 'raojs');
  assert.equal(raojs.kaart, 'L2025_001');
  const raojsMetExtra = leesKaart('https://app.raojs.nl/?game=lvk&id=12');
  assert.equal(raojsMetExtra.kaart, '12');
});

test('een kaartnummer wordt met en zonder voorloopnullen gevonden', () => {
  assert.ok(kandidaten('308').includes('00308'));
  assert.ok(kandidaten('00308').includes('308'));
  assert.deepEqual(kandidaten(''), []);

  const gevonden = zoekLied(leesKaart('https://www.hitstergame.com/nl/aaaa0001/308'), TABEL);
  assert.equal(gevonden.spotify, 'spotify-original-308');
  assert.equal(gevonden.kaart, '00308');
});

test('zonder editie wordt de gewone editie gekozen, en bij twijfel niets', () => {
  // 00012 staat in drie edities met een verschillend nummer: wel taal, geen editie.
  const metTaal = zoekLied(leesKaart('http://www.hitstergame.com/nl/00012'), TABEL);
  assert.equal(metTaal.spotify, 'spotify-original-12');

  const zonderTaal = zoekLied(leesKaart('00012'), TABEL);
  assert.equal(zonderTaal, null, 'een kaartnummer dat in meerdere talen anders is, mag niet gokken');

  // Een nummer dat maar in een editie staat mag wel.
  assert.equal(zoekLied(leesKaart('00308'), TABEL).spotify, 'spotify-original-308');
  assert.equal(zoekLied(leesKaart('https://www.hitstergame.com/nl/aaaa0001/99999'), TABEL), null);
});

test('de embedpagina van Spotify wordt gelezen', () => {
  const lied = leesEmbed(embedHtml({ id: 'abc', titel: 'Fireflies', artiesten: ['Owl City'], jaar: 2009 }));
  assert.deepEqual(lied, {
    titel: 'Fireflies',
    artiest: 'Owl City',
    jaar: 2009,
    fragment: 'https://p.scdn.co/mp3-preview/abc',
    hoes: 'https://i.scdn.co/image/groot',
    speelbaar: true,
  });

  assert.equal(leesEmbed('<html>niets</html>'), null);
  assert.equal(leesEmbed('<script id="__NEXT_DATA__" type="application/json">{kapot</script>'), null);
  assert.equal(leesEmbed(''), null);
});

test('een gescand kaartje levert het liedje op', async () => {
  const gevraagd = [];
  const haalTekst = async (url) => {
    gevraagd.push(url);
    return embedHtml({ id: 'abc', titel: 'Fireflies', artiesten: ['Owl City'], jaar: 2009 });
  };

  const uit = await losOp('https://www.hitstergame.com/nl/aaaa0001/00308', { tabel: TABEL, haalTekst });
  assert.equal(uit.lied.titel, 'Fireflies');
  assert.equal(uit.lied.jaar, 2009);
  assert.equal(uit.editie.naam, 'Hitster Original');
  assert.equal(uit.kaart, '00308');
  assert.deepEqual(gevraagd, ['https://open.spotify.com/embed/track/spotify-original-308']);
});

test('een kaartje dat niet te lezen is geeft een duidelijke melding', async () => {
  const haalTekst = async () => embedHtml({ id: 'abc', titel: 'X', artiesten: ['Y'], jaar: 2000 });

  await assert.rejects(
    () => losOp('https://raojs.nl/kaart/12', { tabel: TABEL, haalTekst }),
    /Raoj 's/,
  );
  await assert.rejects(
    () => losOp('https://www.marotte.nl/hittepetit/1', { tabel: TABEL, haalTekst }),
    /Hittepetit/,
  );
  await assert.rejects(() => losOp('onzin', { tabel: TABEL, haalTekst }), /hoort niet bij een van de spellen/);
  await assert.rejects(
    () => losOp('https://www.hitstergame.com/nl/aaaa0001/99999', { tabel: TABEL, haalTekst }),
    /staat niet in de tabel/,
  );
  await assert.rejects(
    () => losOp('https://www.hitstergame.com/nl/aaaa0009/00012', { tabel: TABEL, haalTekst }),
    /staat niet in de tabel van editie aaaa0009/,
  );
  await assert.rejects(
    () => losOp('https://www.hitstergame.com/nl/aaaa0001/00308', { tabel: TABEL, haalTekst: async () => '<html>leeg</html>' }),
    /niet meer online/,
  );
});

test('een Raoj \'s-kaartje levert het fragment van hun eigen web-app op', async () => {
  const { maakSocket, gesprek } = nagemaakteRaojsSocket('preview/93984');
  const uit = await losOp('https://app.raojs.nl/?id=NPRP', { maakSocket });

  assert.equal(uit.spel, 'raojs');
  assert.equal(uit.kaart, 'NPRP');
  assert.equal(uit.editie.naam, "Raoj 's");
  assert.equal(uit.lied.fragment, 'https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/preview/93984.mp3');
  assert.equal(uit.lied.titel, null, 'Raoj \'s geeft geen titel; die staat op het kaartje');
  assert.equal(uit.lied.antwoordOpKaartje, true);

  // Wat de app tegen hun web-app zegt: eerst verbinden, dan getSongId met het kaartnummer.
  assert.equal(gesprek[0].msg, 'connect');
  assert.equal(gesprek[1].method, 'getSongId');
  assert.equal(gesprek[1].params[0], 'NPRP');
  assert.equal(gesprek[1].params[1], 'raojs');
});

test('de spelvariant van Raoj \'s kiest welk fragment je hoort', async () => {
  const { maakSocket, gesprek } = nagemaakteRaojsSocket('custom/93984');
  const fragment = await haalRaojsFragment('NPRP', { variant: 'zings', maakSocket });
  assert.equal(fragment, 'https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/custom/93984.mp3');
  assert.equal(gesprek[1].params[1], 'zings');
});

test('een kaartje dat Raoj \'s niet kent geeft een duidelijke melding', async () => {
  const { maakSocket } = nagemaakteRaojsSocket(null, { fout: { error: 404, reason: 'Not found' } });
  await assert.rejects(() => losOp('https://app.raojs.nl/?id=ZZZZ', { maakSocket }), /kent kaartje ZZZZ niet/);

  // En als de web-app niet antwoordt, mag de app niet blijven hangen.
  const stil = { maakSocket: () => ({ send() {}, close() {} }) };
  await assert.rejects(
    () => haalRaojsFragment('NPRP', { maakSocket: stil.maakSocket, tijd: 30 }),
    /antwoordde niet op tijd/,
  );
});
