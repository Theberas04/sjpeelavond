/**
 * Proeven op het lezen van de kaartjes (public/js/kaart.js).
 *
 * Er is geen camera bij nodig: dit gaat over de vraag wat er met de code van een kaartje
 * gebeurt. De QR-code zelf wordt in de app door de schil uitgelezen en hier als tekst
 * aangeboden, dus dit is precies de grens waar de app zijn werk doet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kandidaten, leesEmbed, leesKaart, losOp, zoekLied } from '../public/js/kaart.js';

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
