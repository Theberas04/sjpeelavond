/**
 * spel.js — alle spellogica van Sjpeelavond, zonder DOM.
 * Puur genoeg om in node:test te testen; de UI (app.js) roept alleen deze functies aan.
 *
 * Spellen:
 *   tijdlijn   — Hitster-stijl: leg het nummer op de juiste plek in je tijdlijn
 *   raojs      — vier varianten (Raoj 's, Zîng 's, Stop 's, LVJao/LVNein)
 *   hittepetit — tijdlijn met nónnevotten op het Zittesje/Limburgse repertoire
 */

export const KLEUREN = [
  '#2ea3f2', '#d7263d', '#1f8a4c', '#e8a33d', '#7c4dff',
  '#0ea5b7', '#e91e8c', '#8d6e63', '#3949ab', '#00897b',
];

export const SPELLEN = {
  tijdlijn: {
    naam: 'Tijdlijn',
    ondertitel: 'Hitster-stijl',
    uitleg:
      'Iedereen bouwt een eigen tijdlijn. Je hoort een fragment en legt de kaart op de plek waar jij denkt dat het jaartal hoort. Goed is houden, fout is weg. Wie het eerst het doel aantal kaarten goed heeft liggen, wint.',
    doel: 10,
    fiches: 2,
    fichesMax: 5,
    kaartPrijs: 3,
    dekken: ['hits'],
  },
  raojs: {
    naam: "Raoj 's",
    ondertitel: 'Limburgs partyspel',
    uitleg:
      "Vier varianten met Limburgs repertoire: Raoj 's (tijdlijn), Zîng 's (meezingen), Stop 's (herkennen na de eerste klanken) en LVJao of LVNein (was dit een LVK-inzending?).",
    doel: 10,
    fiches: 2,
    fichesMax: 5,
    kaartPrijs: 3,
    dekken: ['limburg'],
  },
  hittepetit: {
    naam: 'Hittepetit',
    ondertitel: 'Zittesje vastelaovend',
    uitleg:
      "Tijdlijnspel op Zittesj en Limburgs vastelaovesrepertoire. Fiches zijn hier nónnevotte: inzetten om een liedje over te slaan, om een kaart te stelen of om een hint te kopen. Wie het eerst de eindstreep haalt, is de wènner vanaovend.",
    doel: 5,
    fiches: 2,
    fichesMax: 5,
    kaartPrijs: 3,
    dekken: ['vastelaovend'],
  },
};

export const VARIANTEN = {
  raojs: { naam: "Raoj 's", uitleg: 'Zelfde als Tijdlijn, maar met Limburgs repertoire.' },
  zings: { naam: "Zîng 's", uitleg: 'Zing mee. Na het fragment geef je aan wie de tekst kende.' },
  stops: { naam: "Stop 's", uitleg: 'Druk zo snel mogelijk op je knop als je het nummer herkent. Hoe sneller, hoe meer punten.' },
  lvjao: { naam: 'LVJao of LVNein', uitleg: 'Raad of het nummer ooit een inzending was voor het Limburgs Vastelaovesleedjes Konkoer.' },
};

/* ── helpers ───────────────────────────────────────────────────────────── */

export const secondeLabel = (s) => (s === 1 ? '1 seconde' : `${s} seconden`);

/** Juiste invoegpositie voor een jaartal in een tijdlijn (0 = vooraan). */
export function juistePlek(tijdlijn, jaar) {
  let i = 0;
  while (i < tijdlijn.length && tijdlijn[i].jaar <= jaar) i++;
  return i;
}

/**
 * Mag deze kaart op deze positie? Gelijk jaartal mag ervoor of erna,
 * dus de kaart is goed als alles links niet later is en alles rechts niet eerder.
 */
export function plaatsingGoed(tijdlijn, jaar, positie) {
  if (positie < 0 || positie > tijdlijn.length) return false;
  const links = tijdlijn.slice(0, positie);
  const rechts = tijdlijn.slice(positie);
  return links.every((k) => k.jaar <= jaar) && rechts.every((k) => k.jaar >= jaar);
}

/** Voegt de kaart toe op de juiste plek (voor stelen of kopen). */
export function voegJuistToe(tijdlijn, kaart) {
  const kopie = tijdlijn.slice();
  kopie.splice(juistePlek(kopie, kaart.jaar), 0, kaart);
  return kopie;
}

/* ── spel opzetten ─────────────────────────────────────────────────────── */

export function maakSpel({ soort = 'tijdlijn', variant = null, namen = [], dekken = [], doel = null, fragment = 30 }) {
  const regels = SPELLEN[soort] || SPELLEN.tijdlijn;
  const spelers = namen
    .map((n) => String(n).trim())
    .filter(Boolean)
    .map((naam, i) => ({
      naam,
      kleur: KLEUREN[i % KLEUREN.length],
      tijdlijn: [],
      fiches: regels.fiches,
      goed: 0,
      fout: 0,
      punten: 0,
      klaar: false,
    }));
  return {
    versie: 1,
    soort,
    variant: soort === 'raojs' ? variant || 'raojs' : null,
    dekken: dekken.length ? dekken : regels.dekken,
    doel: doel || regels.doel,
    fragment,
    spelers,
    beurt: 0,
    ronde: 1,
    fase: 'start', // start | trekken | plaatsen | onthuld | afgelopen
    gebruikt: [],
    huidig: null, // {id, kaart} — jaartal komt pas bij onthullen
    hints: {},
    log: [],
    winnaar: null,
    gestart: Date.now(),
  };
}

export const beurtSpeler = (staat) => staat.spelers[staat.beurt];
export const regelsVan = (staat) => SPELLEN[staat.soort] || SPELLEN.tijdlijn;

/* ── kaarten ───────────────────────────────────────────────────────────── */

export function legKaart(staat, kaart) {
  staat.huidig = { id: kaart.id, kaart, plaatsing: null, onthuld: null };
  staat.gebruikt.push(kaart.id);
  staat.fase = 'plaatsen';
  return staat.huidig;
}

export function onthulHuidig(staat, gegevens) {
  if (!staat.huidig) return null;
  staat.huidig.onthuld = gegevens;
  staat.fase = 'onthuld';
  return gegevens;
}

/**
 * Beoordeelt de plaatsing van de huidige kaart. Alleen voor de tijdlijnspellen.
 * Geeft {goed, positie, juistePositie} terug en werkt de speler bij.
 */
export function beoordeelPlaatsing(staat, spelerIndex, positie) {
  const speler = staat.spelers[spelerIndex];
  const jaar = staat.huidig?.onthuld?.jaar;
  if (!speler || jaar == null) return null;
  const goed = plaatsingGoed(speler.tijdlijn, jaar, positie);
  const kaart = { ...staat.huidig.onthuld, id: staat.huidig.id };
  if (goed) {
    speler.tijdlijn.splice(positie, 0, kaart);
    speler.goed += 1;
    if (speler.goed >= staat.doel) {
      speler.klaar = true;
      staat.winnaar = spelerIndex;
      staat.fase = 'afgelopen';
    }
  } else {
    speler.fout += 1;
  }
  staat.log.push({
    speler: spelerIndex,
    goed,
    titel: kaart.titel,
    artiest: kaart.artiest,
    jaar,
    positie,
    juistePositie: juistePlek(speler.tijdlijn.filter((k) => k.id !== kaart.id), jaar),
  });
  return { goed, positie, juistePositie: juistePlek(speler.tijdlijn.filter((k) => k.id !== kaart.id), jaar) };
}

/* ── fiches ────────────────────────────────────────────────────────────── */

export function geefFiche(staat, spelerIndex, aantal = 1) {
  const speler = staat.spelers[spelerIndex];
  const max = regelsVan(staat).fichesMax;
  speler.fiches = Math.min(max, speler.fiches + aantal);
  return speler.fiches;
}

export function neemFiche(staat, spelerIndex, aantal = 1) {
  const speler = staat.spelers[spelerIndex];
  if (speler.fiches < aantal) return false;
  speler.fiches -= aantal;
  return true;
}

/** Sla het getrokken nummer over (kost één fiche). */
export function slaOver(staat, spelerIndex) {
  if (!neemFiche(staat, spelerIndex, 1)) return { gelukt: false, reden: 'geen fiche' };
  staat.huidig = null;
  staat.fase = 'trekken';
  return { gelukt: true };
}

/** Koop de bovenste kaart en zet hem direct goed in je tijdlijn. */
export function koopKaart(staat, spelerIndex) {
  const prijs = regelsVan(staat).kaartPrijs;
  if (!neemFiche(staat, spelerIndex, prijs)) return { gelukt: false, reden: 'te weinig fiches' };
  return { gelukt: true, prijs };
}

/**
 * Steelpoging: een tegenstander legt een fiche in op de plek waar hij denkt dat
 * de kaart in de tijdlijn van de speler aan de beurt hoort. Klopt het, dan krijgt
 * hij de kaart en zet de app hem goed in zijn eigen tijdlijn.
 */
export function steel(staat, diefIndex, doelIndex, positie) {
  if (diefIndex === doelIndex) return { gelukt: false, reden: 'eigen beurt' };
  const jaar = staat.huidig?.onthuld?.jaar;
  const doelTijdlijn = staat.spelers[doelIndex].tijdlijn;
  if (jaar == null) return { gelukt: false, reden: 'nog niet onthuld' };
  if (!neemFiche(staat, diefIndex, 1)) return { gelukt: false, reden: 'geen fiche' };
  const goed = plaatsingGoed(doelTijdlijn, jaar, positie);
  if (!goed) return { gelukt: true, goed: false };
  const kaart = { ...staat.huidig.onthuld, id: staat.huidig.id };
  const dief = staat.spelers[diefIndex];
  dief.tijdlijn = voegJuistToe(dief.tijdlijn, kaart);
  dief.goed += 1;
  if (dief.goed >= staat.doel) {
    dief.klaar = true;
    staat.winnaar = diefIndex;
    staat.fase = 'afgelopen';
  }
  return { gelukt: true, goed: true };
}

/* ── varianten van Raoj 's ─────────────────────────────────────────────── */

/** Punten voor Stop 's: hoe sneller gedrukt, hoe meer punten. */
export function stopPunten(seconden) {
  if (seconden <= 2) return 3;
  if (seconden <= 5) return 2;
  return 1;
}

/** Wijs punten toe aan spelers (Zîng 's, Stop 's, LVJao/LVNein). Wie het eerst het doel haalt wint. */
export function geefPunten(staat, indices, aantal = 1) {
  for (const i of indices) {
    if (staat.spelers[i]) staat.spelers[i].punten += aantal;
  }
  const hoogste = Math.max(0, ...staat.spelers.map((s) => s.punten));
  if (hoogste >= staat.doel) {
    staat.winnaar = staat.spelers.findIndex((s) => s.punten === hoogste);
    staat.fase = 'afgelopen';
  }
}

/** Volgende speler; wie klaar is wordt overgeslagen. */
export function volgendeBeurt(staat) {
  staat.huidig = null;
  staat.fase = 'trekken';
  if (staat.fase !== 'afgelopen') {
    const n = staat.spelers.length;
    for (let i = 1; i <= n; i++) {
      const k = (staat.beurt + i) % n;
      if (!staat.spelers[k].klaar) {
        staat.beurt = k;
        break;
      }
    }
  }
  return staat.beurt;
}

/** Stand op punten (voor de eindstand en het scorebord). */
export function stand(staat) {
  return staat.spelers
    .map((s, i) => ({ ...s, index: i, score: s.punten + s.goed }))
    .sort((a, b) => b.score - a.score);
}

/** Controle: is dit een geldige opgeslagen spelstaat? */
export function isGeldigeStaat(staat) {
  return Boolean(
    staat &&
      typeof staat === 'object' &&
      SPELLEN[staat.soort] &&
      Array.isArray(staat.spelers) &&
      staat.spelers.length > 0 &&
      staat.spelers.every((s) => s && typeof s.naam === 'string' && Array.isArray(s.tijdlijn)),
  );
}
