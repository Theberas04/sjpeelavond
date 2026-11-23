/**
 * Proeven op het melden van een nieuwe versie (public/js/update.js).
 *
 * Dit mag nooit stukgaan door een traag of raar antwoord: zonder internet, met onzin of
 * met een oudere uitgave moet de app gewoon zwijgen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kijkVoorUpdate, leesUitgave, vergelijkVersies } from '../public/js/update.js';

const UITGAVE = {
  tag_name: 'v1.3.0',
  name: 'Sjpeelavond 1.3.0',
  html_url: 'https://github.com/Theberas04/sjpeelavond/releases/tag/v1.3.0',
  body: 'Ondertekende APK van Sjpeelavond 1.3.0 voor Android.\n\nTweede regel.',
  assets: [
    { name: 'Sjpeelavond-Android-1.3.0-debug.apk', browser_download_url: 'https://voorbeeld/debug.apk' },
    { name: 'Sjpeelavond-Android-1.3.0.apk', browser_download_url: 'https://voorbeeld/echt.apk' },
  ],
};

test('versienummers worden als getallen vergeleken', () => {
  assert.equal(vergelijkVersies('1.2.0', '1.2.0'), 0);
  assert.equal(vergelijkVersies('v1.2.0', '1.2.0'), 0);
  assert.equal(vergelijkVersies('1.2.0', '1.10.0'), -1, 'tien is nieuwer dan twee');
  assert.equal(vergelijkVersies('1.10.0', '1.2.0'), 1);
  assert.equal(vergelijkVersies('1.2', '1.2.1'), -1);
  assert.equal(vergelijkVersies('2.0.0', '1.99.99'), 1);
  assert.equal(vergelijkVersies('1.2.0', 'onzin'), 1);
});

test('een uitgave van GitHub wordt gelezen, met de gewone APK en niet de debugversie', () => {
  const uitgave = leesUitgave(UITGAVE);
  assert.equal(uitgave.versie, '1.3.0');
  assert.equal(uitgave.url, 'https://voorbeeld/echt.apk');
  assert.equal(uitgave.pagina, UITGAVE.html_url);
  assert.match(uitgave.notities, /Ondertekende APK/);
});

test('een uitgave zonder APK valt terug op de uitgavenpagina', () => {
  const uitgave = leesUitgave({ tag_name: 'v2.0.0', html_url: 'https://voorbeeld/uitgave', assets: [] });
  assert.equal(uitgave.url, 'https://voorbeeld/uitgave');
});

test('onleesbare uitgaven geven niets terug', () => {
  assert.equal(leesUitgave(null), null);
  assert.equal(leesUitgave({}), null);
  assert.equal(leesUitgave({ tag_name: 'nieuwste' }), null);
});

test('een nieuwere uitgave wordt gemeld, een oudere of gelijke niet', async () => {
  const haalTekst = async () => JSON.stringify(UITGAVE);
  const nieuw = await kijkVoorUpdate({ huidig: '1.2.0', haalTekst });
  assert.equal(nieuw.versie, '1.3.0');

  assert.equal(await kijkVoorUpdate({ huidig: '1.3.0', haalTekst }), null, 'gelijk is niet nieuw');
  assert.equal(await kijkVoorUpdate({ huidig: '1.4.0', haalTekst }), null, 'nieuwer dan de uitgave');
});

test('zonder internet of met onzin blijft het stil', async () => {
  const kapot = async () => {
    throw new Error('geen verbinding');
  };
  assert.equal(await kijkVoorUpdate({ huidig: '1.2.0', haalTekst: kapot }), null);
  assert.equal(await kijkVoorUpdate({ huidig: '1.2.0', haalTekst: async () => '<html>404</html>' }), null);
  assert.equal(await kijkVoorUpdate({ huidig: '1.2.0', haalTekst: async () => 'null' }), null);
  assert.equal(await kijkVoorUpdate({ huidig: '', haalTekst: kapot }), null);
});
