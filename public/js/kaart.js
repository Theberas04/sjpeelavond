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
 * nagegaan op foto's van echte kaartjes: https://hittepetit.radiononnevot.nl/q/HP0132
 * (kaartnummers HP0001 tot HP0222). Van Raoj 's bouwt hun web-app de code als
 * https://app.raojs.nl?id=<nummer>. Wat er in beide gevallen nog niet is, is de
 * koppeling van kaartnummer naar liedje: die is niet openbaar (zie
 * docs/onderzoek-kaartscanners.md), dus herkennen kan wel en naspelen nog niet.
 */
const HITTEPETIT_ADRES = /^https?:\/\/(?:www\.)?hittepetit\.radiononnevot\.nl\/q\/(hp\d{3,5})\/?$/i;
const RAOJS_ADRES = /^https?:\/\/(?:www\.)?app\.raojs\.nl\/?\?(?:[^#]*&)?id=([^&#]+)/i;

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

  // De andere twee spellen: wel herkennen (met het kaartnummer erbij), nog niet naspelen.
  const hittepetit = HITTEPETIT_ADRES.exec(schoon);
  if (hittepetit) return { spel: 'hittepetit', kaart: hittepetit[1].toUpperCase(), ruw };
  const raojs = RAOJS_ADRES.exec(schoon);
  if (raojs) return { spel: 'raojs', kaart: decodeURIComponent(raojs[1]), ruw };

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
 * Van gescande code naar liedje.
 *
 * `haalTekst` haalt een adres op: in de app doet de schil dat (zie Buiten.java), in de
 * browser gewoon fetch. Zo werkt deze functie in beide en is hij met een test te
 * controleren zonder netwerk.
 */
export async function losOp(tekst, { tabel, haalTekst }) {
  const lees = leesKaart(tekst);
  const nummer = lees.kaart ? ` (kaartje ${lees.kaart})` : '';
  if (lees.spel === 'raojs') {
    throw new Error(`Dit is een kaartje van Raoj 's${nummer}. De koppeling van hun kaartnummers aan liedjes is niet openbaar, dus naspelen kan nog niet.`);
  }
  if (lees.spel === 'hittepetit') {
    throw new Error(`Dit is een kaartje van Hittepetit${nummer}. De koppeling van hun kaartnummers aan liedjes is niet openbaar, dus naspelen kan nog niet.`);
  }
  if (lees.spel !== 'hitster') throw new Error('Deze code hoort niet bij een van de spellen.');

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
