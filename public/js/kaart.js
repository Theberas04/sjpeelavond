/**
 * kaart.js — de kaartjes van de fysieke spellen lezen.
 *
 * Sjpeelavond kan de doos op tafel vervangen: je scant de QR-code op een kaartje en de
 * app speelt het fragment. Dat werkt voor Hitster, want daarvan is de koppeling tussen
 * kaartnummer en nummer openbaar: een kaartje wijst naar
 *   www.hitstergame.com/<taal>/<editie>/<kaartnummer>
 * en de tabel met kaartnummer → Spotify-nummer staat in data/hitster.json.
 *
 * De titel, de artiest, het jaartal en het fragment haalt de app bij het scannen op uit
 * de openbare Spotify-embedpagina van dat nummer. Dat is één verzoek per kaartje in
 * plaats van tienduizenden tijdens de bouw, en de fragmentadressen blijven zo geldig
 * (die verlopen namelijk na ongeveer een uur).
 *
 * Wat de speler ziet is de kern van het spel: bij het scannen wordt het fragment
 * gestart en blijven titel, artiest en jaartal verborgen tot er op onthul wordt gedrukt.
 */

export const SPOTIFY_EMBED = 'https://open.spotify.com/embed/track/';

/** Herkent het adres dat op een Hitster-kaartje staat, met en zonder editie. */
const HITSTER_ADRES = /^(?:https?:\/\/)?(?:www\.)?hitstergame\.com\/([a-z]{2}(?:[-_][a-z]{2})?)\/(?:([a-z]{4}\d{4})\/)?(\d{2,6})\/?(?:[?#].*)?$/i;

/** Wat je ook met de hand kunt intypen: de editie met het kaartnummer, of alleen het nummer. */
const EDITIE_KAART = /^([a-z]{4}\d{4})[/-](\d{2,6})$/i;
const ALLEEN_KAART = /^(\d{2,6})$/;

/**
 * De kaartjes van de twee Limburgse spellen. Van Hittepetit is de vorm van de QR-code
 * bekend uit hun eigen spel: https://hittepetit.radiononnevot.nl/q/HP0132 (kaartnummers
 * HP0001 tot HP0222). Van Raoj 's bouwt hun web-app de code als
 * https://app.raojs.nl?id=<nummer>. Van beide is de koppeling naar het liedje inmiddels
 * gevonden (zie docs/onderzoek-hittepetit-app.md), dus beide zijn te herkennen én na te
 * spelen. Alleen het nummer intypen werkt ook: HP0077 en NPRP worden herkend.
 */
const HITTEPETIT_ADRES = /^https?:\/\/(?:www\.)?hittepetit\.radiononnevot\.nl\/q\/(hp\d{3,5})\/?$/i;
const RAOJS_ADRES = /^https?:\/\/(?:www\.)?app\.raojs\.nl\/?\?(?:[^#]*&)?id=([^&#]+)/i;

/**
 * Het kaartnummer van Hittepetit ergens in de tekst. Een kaartje kan ook een ander adres
 * hebben (een korte link, een andere schrijfwijze); `HP` met drie tot vijf cijfers is
 * specifiek genoeg om het aan dit spel toe te schrijven.
 */
const HITTEPETIT_IN_TEKST = /(?:^|[^a-z0-9])hp[\s_-]*(\d{3,5})(?![0-9])/i;

/**
 * Raoj 's: de web-app van het spel vertelt zelf welk fragment bij een kaartje hoort.
 * Dat gaat over een WebSocket (het DDP-protocol van Meteor) en de methode `getSongId`
 * is openbaar — geen account nodig. Je krijgt een pad als `preview/93984` terug en het
 * fragment staat op hun CDN. Nagegaan met een echt kaartje (id NPRP → preview/93984).
 */
export const RAOJS_DDP = 'wss://app.raojs.nl/websocket';
export const RAOJS_CDN = 'https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/';
/** De spelvarianten van Raoj 's; de gewone variant heet bij hen `raojs`. */
export const RAOJS_VARIANTEN = { raojs: 'preview', zings: 'custom', stops: 'intro' };

/**
 * Hittepetit: hun app haalt het fragment van een kaartje uit de openbare opslag van de
 * spelmaker. Nagegaan met de echte bestanden (HP0001, HP0077, HP0100 en HP0222 geven alle
 * vier een mp3): het pad is steeds `hittepetit/<kaartnummer>.mp3`. Titel, artiest en
 * jaartal staan er niet bij — die staan op het kaartje zelf.
 */
export const HITTEPETIT_BRON = 'https://firebasestorage.googleapis.com/v0/b/nonnevot-9cea7.appspot.com/o/';
/** De kaartjes lopen van HP0001 tot HP0222; de code in de QR is het kaartnummer. */
const HITTEPETIT_KAART = /^HP\d{3,5}$/;

/**
 * Leest wat er in een QR-code stond.
 *
 * Geeft altijd iets terug: bij een onbekende code blijft `spel` op 'onbekend' staan,
 * zodat de pagina het kan melden in plaats van te zwijgen.
 */
export function leesKaart(tekst) {
  const schoon = String(tekst == null ? '' : tekst).trim().replace(/^["']|["']$/g, '');
  const ruw = schoon;
  if (!schoon) return { spel: 'onbekend', ruw };

  const hitster = HITSTER_ADRES.exec(schoon);
  if (hitster) {
    return {
      spel: 'hitster',
      taal: hitster[1].toLowerCase().split(/[-_]/)[0],
      editie: hitster[2] ? hitster[2].toLowerCase() : null,
      kaart: hitster[3],
      ruw,
    };
  }

  const editieKaart = EDITIE_KAART.exec(schoon);
  if (editieKaart) {
    return { spel: 'hitster', taal: null, editie: editieKaart[1].toLowerCase(), kaart: editieKaart[2], ruw };
  }

  const alleen = ALLEEN_KAART.exec(schoon);
  if (alleen) return { spel: 'hitster', taal: null, editie: null, kaart: alleen[1], ruw };

  // Alleen het kaartnummer van Hittepetit overgetypt: HP0077, hp 77 of HP-0077.
  const alleenHp = /^hp[\s_-]*(\d{3,5})$/i.exec(schoon);
  if (alleenHp) return { spel: 'hittepetit', kaart: `HP${alleenHp[1]}`, ruw };

  // Alleen de code van Raoj 's overgetypt: precies vier letters, zoals NPRP. Ruimer dan dat
  // maakt van elk willekeurig woord een kaartje van Raoj 's.
  const alleenRaojs = /^([a-z]{4})$/i.exec(schoon);
  if (alleenRaojs) return { spel: 'raojs', kaart: alleenRaojs[1].toUpperCase(), ruw };

  // De andere twee spellen: herkennen met het kaartnummer erbij, zodat de app het liedje
  // erbij kan zoeken.
  const hittepetit = HITTEPETIT_ADRES.exec(schoon);
  if (hittepetit) return { spel: 'hittepetit', kaart: hittepetit[1].toUpperCase(), ruw };
  const raojs = RAOJS_ADRES.exec(schoon);
  if (raojs) return { spel: 'raojs', kaart: decodeURIComponent(raojs[1]), ruw };

  // Een adres van een andere vorm waar het kaartnummer van Hittepetit in staat: een korte
  // link of een andere schrijfwijze. `HP` met cijfers komt bij de andere twee spellen niet
  // voor, dus dit is veilig toe te schrijven.
  const hpErgens = HITTEPETIT_IN_TEKST.exec(schoon);
  if (hpErgens) return { spel: 'hittepetit', kaart: `HP${hpErgens[1]}`, ruw };

  const laag = schoon.toLowerCase();
  if (laag.includes('raojs')) return { spel: 'raojs', kaart: null, ruw };
  if (laag.includes('hittepetit') || laag.includes('marotte') || laag.includes('nonnevot') || laag.includes('nónnevot')) {
    return { spel: 'hittepetit', kaart: null, ruw };
  }
  return { spel: 'onbekend', ruw };
}

/**
 * De manieren waarop een kaartnummer in de tabel kan staan: zoals het op de kaart staat,
 * en met voorloopnullen. De bronbestanden gebruiken vijf cijfers, een QR-code soms niet.
 */
export function kandidaten(nummer) {
  const cijfers = String(nummer).replace(/\D/g, '');
  if (!cijfers) return [];
  const uit = new Set([cijfers]);
  for (let breedte = 2; breedte <= 6; breedte++) {
    if (cijfers.length <= breedte) uit.add(cijfers.padStart(breedte, '0'));
  }
  uit.add(cijfers.replace(/^0+/, '') || cijfers);
  return [...uit];
}

/** De taalcode van een kaartje tegen de landnaam die in de tabel staat. */
const TAAL_LAND = {
  nl: ['netherlands', 'benelux'],
  de: ['germany'],
  fr: ['france'],
  es: ['spain'],
  it: ['italy'],
  en: ['united kingdom'],
  pl: ['poland'],
  pt: ['portugal'],
  sv: ['sweden'],
  hu: ['hungary'],
  ja: ['japan'],
  ko: ['korea'],
  he: ['israel'],
  hr: ['croatia'],
  ro: ['romania'],
  el: ['greece'],
  is: ['iceland'],
  cs: ['czechia'],
};

/** Zoekt het Spotify-nummer bij een gelezen kaartje. */
export function zoekLied(lees, tabel) {
  if (!lees || lees.spel !== 'hitster' || !tabel || !tabel.kaarten) return null;

  const zoek = (editie) => {
    const nummers = tabel.kaarten[editie];
    if (!nummers) return null;
    for (const sleutel of kandidaten(lees.kaart)) {
      if (nummers[sleutel]) return { spotify: nummers[sleutel], editie, kaart: sleutel };
    }
    return null;
  };

  if (lees.editie) return zoek(lees.editie);

  // Zonder editie in de code (oudere kaartjes): zoeken in alle edities. Komt hetzelfde
  // kaartnummer in meerdere edities op een verschillend nummer uit, dan is de code niet
  // eenduidig — en dan liever niets dan een verkeerd liedje. De taal van de code en de
  // gewone editie wegen alleen mee als ze de keuze eenduidig maken.
  let treffers = Object.keys(tabel.kaarten).map(zoek).filter(Boolean);
  const naamVan = (editie) => String(tabel.edities?.[editie]?.naam || '');
  const landen = TAAL_LAND[lees.taal] || [];
  const inTaal = landen.length
    ? treffers.filter((t) => landen.some((land) => String(tabel.edities?.[t.editie]?.taal || '').toLowerCase() === land))
    : [];
  if (inTaal.length) treffers = inTaal;

  const liedjes = new Set(treffers.map((t) => t.spotify));
  if (liedjes.size === 1) return treffers[0];

  const gewoon = treffers.filter((t) => /original$/i.test(naamVan(t.editie)));
  if (gewoon.length && new Set(gewoon.map((t) => t.spotify)).size === 1) return gewoon[0];
  return null;
}

/**
 * Leest de openbare embedpagina van Spotify: titel, artiest, jaartal, hoesje en het
 * adres van het 30-secondenfragment. Geeft null als de pagina geen nummer bevat
 * (bijvoorbeeld omdat het nummer uit Spotify verdwenen is).
 */
export function leesEmbed(html) {
  const blok = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!blok) return null;
  let gegevens;
  try {
    gegevens = JSON.parse(blok[1]);
  } catch {
    return null;
  }
  const nummer = gegevens?.props?.pageProps?.state?.data?.entity;
  if (!nummer || !nummer.name) return null;

  const jaar = Number(String(nummer.releaseDate?.isoString || '').slice(0, 4)) || null;
  const beelden = nummer.visualIdentity?.image || [];
  return {
    titel: String(nummer.name),
    artiest: (nummer.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    jaar,
    fragment: nummer.audioPreview?.url || null,
    hoes: beelden.length ? beelden[beelden.length - 1].url : null,
    speelbaar: nummer.isPlayable !== false,
  };
}

/**
 * Het fragment van een Hittepetit-kaartje: dat staat openbaar in de opslag van de
 * spelmaker, op het kaartnummer. Er is geen titel bij — die staat op het kaartje.
 */
export function haalHittepetitFragment(kaart) {
  const code = String(kaart || '').trim().toUpperCase();
  if (!HITTEPETIT_KAART.test(code)) {
    throw new Error('Dit kaartje van Hittepetit heeft geen nummer in de code staan.');
  }
  return HITTEPETIT_BRON + encodeURIComponent(`hittepetit/${code}.mp3`) + '?alt=media';
}

/**
 * Het fragment van een Raoj 's-kaartje opvragen bij hun eigen web-app.
 *
 * `maakSocket` is er om dit zonder netwerk te kunnen natrekken in een test; zonder die
 * optie wordt een gewone WebSocket gebruikt (die bestaat in de browser, in de WebView
 * van de app en in Node).
 */
export function haalRaojsFragment(kaart, { variant = 'raojs', maakSocket, tijd = 12000 } = {}) {
  const bouw = maakSocket || ((adres) => new WebSocket(adres));
  return new Promise((klaar, mis) => {
    let sok;
    let bel = null;
    const sluit = () => {
      clearTimeout(bel);
      try {
        sok?.close();
      } catch {
        /* niets aan te doen */
      }
    };
    const stopMet = (fout) => {
      sluit();
      mis(fout);
    };
    try {
      sok = bouw(RAOJS_DDP);
    } catch {
      stopMet(new Error('Geen verbinding met de web-app van Raoj \'s.'));
      return;
    }
    bel = setTimeout(() => stopMet(new Error('De web-app van Raoj \'s antwoordde niet op tijd.')), tijd);
    sok.onerror = () => stopMet(new Error('Geen verbinding met de web-app van Raoj \'s.'));
    sok.onopen = () => sok.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
    sok.onmessage = (bericht) => {
      let m;
      try {
        m = JSON.parse(bericht.data);
      } catch {
        return;
      }
      if (m.msg === 'connected') {
        sok.send(
          JSON.stringify({
            msg: 'method',
            method: 'getSongId',
            params: [kaart, variant, { deviceinfo: { platform: 'app' } }],
            id: '1',
          }),
        );
        return;
      }
      if (m.msg !== 'result' || m.id !== '1') return;
      if (m.error || typeof m.result !== 'string' || !m.result) {
        stopMet(new Error(`Raoj 's kent kaartje ${kaart} niet.`));
        return;
      }
      sluit();
      klaar(RAOJS_CDN + m.result + '.mp3');
    };
  });
}

/**
 * Van gescande code naar liedje.
 *
 * `haalTekst` haalt een adres op: in de app doet de schil dat (zie Buiten.java), in de
 * browser gewoon fetch. Zo werkt deze functie in beide en is hij met een test te
 * controleren zonder netwerk.
 */
export async function losOp(tekst, { tabel, haalTekst, maakSocket, variant } = {}) {
  const lees = leesKaart(tekst);
  if (lees.spel === 'raojs') {
    if (!lees.kaart) throw new Error('Dit kaartje van Raoj \'s heeft geen nummer in de code staan.');
    const fragment = await haalRaojsFragment(lees.kaart, { variant, maakSocket });
    return {
      lees,
      spel: 'raojs',
      kaart: lees.kaart,
      editie: { naam: "Raoj 's" },
      editieId: 'raojs',
      // Raoj 's geeft alleen het fragment; titel, artiest en jaartal staan op het kaartje.
      lied: { titel: null, artiest: null, jaar: null, fragment, hoes: null, speelbaar: true, antwoordOpKaartje: true },
    };
  }
  if (lees.spel === 'hittepetit') {
    if (!lees.kaart) throw new Error('Dit kaartje van Hittepetit heeft geen nummer in de code staan.');
    const fragment = haalHittepetitFragment(lees.kaart);
    return {
      lees,
      spel: 'hittepetit',
      kaart: lees.kaart,
      editie: { naam: 'Hittepetit' },
      editieId: 'hittepetit',
      // Net als bij Raoj 's geeft Hittepetit geen titel: het fragment wel, het antwoord staat
      // op het kaartje.
      lied: { titel: null, artiest: null, jaar: null, fragment, hoes: null, speelbaar: true, antwoordOpKaartje: true },
    };
  }
  if (lees.spel !== 'hitster') {
    // De code zelf erbij zetten: dan is te zien wat er op het kaartje stond in plaats van
    // alleen dat de app er niets mee kan. Zonder dat is een verkeerd gelezen kaartje niet
    // van een onbekend kaartje te onderscheiden.
    throw new Error(`Deze code hoort niet bij een van de spellen: "${lees.ruw}"`);
  }

  const gevonden = zoekLied(lees, tabel);
  if (!gevonden) {
    throw new Error(
      lees.editie
        ? `Kaartje ${lees.kaart} staat niet in de tabel van editie ${lees.editie}.`
        : 'Dit kaartnummer staat in geen enkele editie; scan het kaartje opnieuw of typ de code over.',
    );
  }

  const html = await haalTekst(SPOTIFY_EMBED + gevonden.spotify);
  const lied = leesEmbed(html);
  if (!lied) throw new Error('Spotify gaf dit nummer niet meer terug; het staat waarschijnlijk niet meer online.');

  return {
    lees,
    editie: tabel.edities?.[gevonden.editie] || null,
    editieId: gevonden.editie,
    kaart: gevonden.kaart,
    lied,
  };
}
