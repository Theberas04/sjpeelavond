/**
 * app.js — de bediening van Sjpeelavond.
 * Alle spellogica staat in spel.js; hier alleen schermen, knoppen en het geluid.
 */
import * as S from './spel.js';

/* ── hulpjes ───────────────────────────────────────────────────────────── */

const $ = (kies, wortel = document) => wortel.querySelector(kies);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(pad, lichaam, extra = {}) {
  // In de Android-app is er geen server: lokaal.js doet dan hetzelfde werk.
  if (typeof window !== 'undefined' && window.SJPEEL_LOKAAL) return window.SJPEEL_LOKAAL(pad, lichaam, extra);
  const antwoord = await fetch(pad, {
    method: lichaam ? 'POST' : 'GET',
    headers: lichaam ? { 'content-type': 'application/json' } : {},
    body: lichaam ? JSON.stringify(lichaam) : undefined,
    ...extra,
  });
  const data = await antwoord.json().catch(() => ({}));
  if (!antwoord.ok) throw new Error(data.fout || `Fout ${antwoord.status}`);
  return data;
}

let meldTimer;
function meld(tekst) {
  const vak = $('#melding');
  vak.textContent = tekst;
  vak.classList.add('aan');
  clearTimeout(meldTimer);
  meldTimer = setTimeout(() => vak.classList.remove('aan'), 3600);
}

const SLEUTEL = 'sjpeelavond.spel.v1';
const bewaar = () => {
  try {
    localStorage.setItem(SLEUTEL, JSON.stringify(staat.spel));
  } catch {}
};
const herstel = () => {
  try {
    const ruw = localStorage.getItem(SLEUTEL);
    if (!ruw) return null;
    const spel = JSON.parse(ruw);
    return S.isGeldigeStaat(spel) ? spel : null;
  } catch {
    return null;
  }
};

/* ── toestand ──────────────────────────────────────────────────────────── */

const staat = {
  versie: null,
  dekken: [],
  spel: null,
  keuzes: { soort: 'tijdlijn', variant: null, namen: [], dekken: [], doel: 10, fragment: 30 },
  audio: { bezig: false, start: 0, timer: null, stopTimer: null },
  stop: null, // {speler, seconden} bij Stop 's
  gekozenPlek: null,
  steel: null, // {dief}
  aangevinkt: new Set(),
  muziek: { vanaf: 0, limiet: 100, dek: 'hits', zoek: '' },
  ingelogd: false,
};

const tijdlijnSpel = (spel) => spel.soort !== 'raojs' || spel.variant === 'raojs';
const spelersNaam = (spel, i) => esc(spel.spelers[i]?.naam || '?');
const fichesNaam = (spel) => (spel.soort === 'hittepetit' ? 'nónnevotte' : 'fiches');

/* ── schermen ──────────────────────────────────────────────────────────── */

function toonView(naam) {
  for (const vak of document.querySelectorAll('#app > section')) vak.hidden = vak.id !== `view-${naam}`;
  for (const knop of document.querySelectorAll('#tabs button')) knop.classList.toggle('actief', knop.dataset.view === naam);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('#tabs button').forEach((knop) => {
  knop.addEventListener('click', () => {
    const naam = knop.dataset.view;
    if (naam === 'spel' && !staat.spel) return meld('Er loopt nog geen spel.');
    if (naam === 'beheer') laadBeheer();
    if (naam === 'muziek') laadMuziek();
    toonView(naam === 'spel' ? 'spel' : naam);
  });
});

/* ── startpagina ───────────────────────────────────────────────────────── */

const ILLUSTRATIE = {
  tijdlijn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19V5m0 0 7 3-7 3M4 5l7 3"/><rect x="13" y="8" width="7" height="10" rx="1.5"/></svg>',
  raojs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v10.5"/><circle cx="9" cy="17" r="3.2"/><path d="M12 3c3 1 5 3 5 6"/></svg>',
  hittepetit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4c2 0 3 1.6 3 3.5S14 11 14 13h-4c0-2-1-3.6-1-5.5S10 4 12 4Z"/><path d="M7 20h10M9 17h6"/></svg>',
};

function renderStart() {
  const spelkaarten = Object.entries(S.SPELLEN)
    .map(
      ([id, spel]) => `
    <div class="spelkaart ${id}">
      <div class="kop">${ILLUSTRATIE[id] || ''}<div><div class="sub">${esc(spel.ondertitel)}</div><h3>${esc(spel.naam)}</h3></div></div>
      <div class="lijf">
        <p class="klein" style="margin:0">${esc(spel.uitleg)}</p>
        <button class="knop" data-act="kies-spel" data-spel="${id}">Speel ${esc(spel.naam)}</button>
      </div>
    </div>`,
    )
    .join('');
  $('#spelkaarten').innerHTML = spelkaarten;

  const totaal = staat.versie?.totalen?.samen || 0;
  const dekken = staat.versie?.dekken || [];
  const limburg = dekken.find((d) => d.id === 'limburg')?.aantal || 0;
  $('#statrij').innerHTML = [
    `${totaal.toLocaleString('nl-NL')} nummers`,
    `${limburg.toLocaleString('nl-NL')} Limburgse nummers`,
    '1965 – nu',
    '30-secondenfragmenten',
    'geen abonnement nodig',
  ]
    .map((t) => `<span class="chip blauw">${esc(t)}</span>`)
    .join('');

  // De pagina meldt zelf dat het startscherm klaar is. De schil kan dat niet weten: de
  // database komt uit de bundel en het tekenen gebeurt daarna, dus een momentopname bij
  // het laden van de pagina is te vroeg (die zag nul spelkaarten).
  if (typeof window.Sjpeelavond?.log === 'function') {
    window.Sjpeelavond.log(
      `SJPEELAVOND_START kaarten=${document.querySelectorAll('#spelkaarten .spelkaart').length} tabbladen=${document.querySelectorAll('#tabs button').length}`,
    );
  }
}

/* ── instellen ─────────────────────────────────────────────────────────── */

function openInstellen(soort) {
  const regels = S.SPELLEN[soort];
  staat.keuzes.soort = soort;
  staat.keuzes.dekken = [...regels.dekken];
  staat.keuzes.doel = regels.doel;
  staat.keuzes.variant = soort === 'raojs' ? 'raojs' : null;
  $('#instellen-titel').textContent = `${regels.naam} instellen`;
  $('#instellen-uitleg').textContent = regels.uitleg;
  if (!staat.keuzes.namen.length) staat.keuzes.namen = ['', '', ''];
  $('#variantvak').hidden = soort !== 'raojs';
  $('#variantkeuze').innerHTML = Object.entries(S.VARIANTEN)
    .map(([id, v]) => `<button data-variant="${id}">${esc(v.naam)}</button>`)
    .join('');
  renderSpelers();
  renderDekken();
  renderSegmente();
  toonView('instellen');
}

function renderSpelers() {
  const namen = staat.keuzes.namen || [];
  $('#spelerslijst').innerHTML = namen
    .map(
      (naam, i) => `
    <div class="spelerrij">
      <span class="bolletje" style="background:${S.KLEUREN[i % S.KLEUREN.length]}"></span>
      <input type="text" data-speler="${i}" value="${esc(naam)}" placeholder="Naam van speler ${i + 1}">
      ${namen.length > 2 ? `<button class="knop zacht klein" data-act="speler-weg" data-speler="${i}">✕</button>` : ''}
    </div>`,
    )
    .join('');
}

function renderDekken() {
  $('#dekkeuze').innerHTML = staat.dekken
    .map(
      (d) => `
    <label class="dek ${staat.keuzes.dekken.includes(d.id) ? 'aan' : ''}">
      <input type="checkbox" data-dek="${d.id}" ${staat.keuzes.dekken.includes(d.id) ? 'checked' : ''}>
      <span><span class="naam">${esc(d.naam)}</span> <span class="chip">${d.aantal}</span>
      <span class="uitleg">${esc(d.beschrijving)}</span></span>
    </label>`,
    )
    .join('');
}

function renderSegmente() {
  for (const knop of document.querySelectorAll('#fragmentkeuze button'))
    knop.classList.toggle('actief', Number(knop.dataset.sec) === staat.keuzes.fragment);
  for (const knop of document.querySelectorAll('#doelkeuze button'))
    knop.classList.toggle('actief', Number(knop.dataset.doel) === staat.keuzes.doel);
  for (const knop of document.querySelectorAll('#variantkeuze button')) {
    knop.classList.toggle('actief', knop.dataset.variant === staat.keuzes.variant);
    knop.onclick = () => {
      staat.keuzes.variant = knop.dataset.variant;
      if (knop.dataset.variant === 'lvjao') staat.keuzes.dekken = ['lvk'];
      else if (staat.keuzes.variant === 'raojs') staat.keuzes.dekken = ['limburg'];
      renderDekken();
      renderSegmente();
      $('#variantuitleg').textContent = S.VARIANTEN[knop.dataset.variant].uitleg;
    };
  }
  $('#variantuitleg').textContent = staat.keuzes.variant ? S.VARIANTEN[staat.keuzes.variant].uitleg : '';
}

document.addEventListener('click', async (gebeurtenis) => {
  const knop = gebeurtenis.target.closest('[data-act]');
  if (!knop) return;
  const act = knop.dataset.act;
  const i = knop.dataset.speler !== undefined ? Number(knop.dataset.speler) : null;

  try {
    switch (act) {
      case 'kies-spel':
        openInstellen(knop.dataset.spel);
        break;
      case 'speler-weg':
        staat.keuzes.namen.splice(i, 1);
        renderSpelers();
        break;
      case 'start-spel':
        await startSpel();
        break;
      case 'terug-start':
        toonView('start');
        break;
      case 'scan':
        toonView('scannen');
        scanKaartje();
        break;
      case 'scan-code':
        await verwerkScan($('#scan-code')?.value || '');
        break;
      case 'scan-speel':
        await speelScanFragment();
        break;
      case 'scan-onthul':
        onthulScan();
        break;
      case 'trek':
        await trekKaart();
        break;
      case 'speel':
      case 'pauze':
        await speelFragment();
        break;
      case 'kies-plek':
        staat.gekozenPlek = Number(knop.dataset.plek);
        renderBord();
        break;
      case 'leg-neer':
        await legNeer();
        break;
      case 'overslaan':
        await slaOver();
        break;
      case 'koop':
        await koopKaart();
        break;
      case 'hint':
        await koopHint();
        break;
      case 'hitster':
        staat.steel = staat.steel ? null : { dief: null };
        renderBord();
        break;
      case 'steel-kies':
        staat.steel = { dief: i };
        renderBord();
        break;
      case 'steel-plek':
        await steelKaart(Number(knop.dataset.plek));
        break;
      case 'fiche-titel':
        await verdienFiche(i);
        break;
      case 'onthul':
        await onthul();
        break;
      case 'punten':
        staat.aangevinkt.has(i) ? staat.aangevinkt.delete(i) : staat.aangevinkt.add(i);
        renderBord();
        break;
      case 'punten-geven':
        geefPuntenAanAangevinkten();
        break;
      case 'buzzer':
        buzz(i);
        break;
      case 'buzzer-goed':
        buzzerGoed(true);
        break;
      case 'buzzer-fout':
        buzzerGoed(false);
        break;
      case 'lvk-keuze':
        lvkKeuze(knop.dataset.keuze === 'jao');
        break;
      case 'volgende':
        volgendeSpeler();
        break;
      case 'nieuw-spel':
        staat.spel = null;
        localStorage.removeItem(SLEUTEL);
        toonView('start');
        break;
      case 'spel-stoppen':
        if (confirm('Dit spel stoppen en terug naar het begin?')) {
          staat.spel = null;
          localStorage.removeItem(SLEUTEL);
          toonView('start');
        }
        break;
      case 'spel-uitleg':
        toonView('uitleg');
        break;
    }
  } catch (fout) {
    meld(fout.message);
  }
});

document.addEventListener('input', (gebeurtenis) => {
  const doel = gebeurtenis.target;
  if (doel.dataset.speler !== undefined && doel.tagName === 'INPUT' && doel.closest('#spelerslijst')) {
    staat.keuzes.namen[Number(doel.dataset.speler)] = doel.value;
  }
  if (doel.dataset.dek) {
    const dek = doel.dataset.dek;
    if (doel.checked) {
      if (!staat.keuzes.dekken.includes(dek)) staat.keuzes.dekken.push(dek);
    } else staat.keuzes.dekken = staat.keuzes.dekken.filter((d) => d !== dek);
    renderDekken();
  }
});

$('#speler-toevoegen').addEventListener('click', () => {
  staat.keuzes.namen.push('');
  renderSpelers();
});
document.querySelectorAll('[data-aantal]').forEach((knop) =>
  knop.addEventListener('click', () => {
    const aantal = Number(knop.dataset.aantal);
    staat.keuzes.namen = Array.from({ length: aantal }, (_, i) => staat.keuzes.namen[i] || '');
    renderSpelers();
  }),
);
document.querySelectorAll('#fragmentkeuze button').forEach((knop) =>
  knop.addEventListener('click', () => {
    staat.keuzes.fragment = Number(knop.dataset.sec);
    renderSegmente();
  }),
);
document.querySelectorAll('#doelkeuze button').forEach((knop) =>
  knop.addEventListener('click', () => {
    staat.keuzes.doel = Number(knop.dataset.doel);
    renderSegmente();
  }),
);

/* ── spel starten ──────────────────────────────────────────────────────── */

function leesSpelers() {
  return (staat.keuzes.namen || []).map((n) => n.trim()).filter(Boolean);
}

async function startSpel() {
  const namen = leesSpelers();
  if (!namen.length) return meld('Vul minstens één naam in.');
  if (!staat.keuzes.dekken.length) return meld('Kies minstens één muziekdek.');
  const spel = S.maakSpel({
    soort: staat.keuzes.soort,
    variant: staat.keuzes.variant,
    namen,
    dekken: staat.keuzes.dekken,
    doel: staat.keuzes.doel,
    fragment: staat.keuzes.fragment,
  });
  staat.spel = spel;
  staat.gekozenPlek = null;
  staat.steel = null;
  staat.stop = null;

  if (tijdlijnSpel(spel)) {
    // Iedere speler begint met één open kaart als startpunt.
    for (let i = 0; i < spel.spelers.length; i++) {
      const { kaarten } = await api('/api/trek', { dekken: spel.dekken, gebruikt: spel.gebruikt, aantal: 1 });
      const kaart = kaarten[0];
      if (!kaart) break;
      spel.gebruikt.push(kaart.id);
      const { kaarten: onthuld } = await api('/api/onthul', { ids: [kaart.id] });
      if (onthuld[0]) spel.spelers[i].tijdlijn.push({ ...onthuld[0] });
    }
  }
  spel.fase = 'trekken';
  bewaar();
  toonView('spel');
  renderBord();
  meld('Klaar voor de eerste kaart!');
}

/* ── kaarten trekken, spelen en onthullen ──────────────────────────────── */

async function trekKaart() {
  const spel = staat.spel;
  staat.gekozenPlek = null;
  staat.steel = null;
  staat.aangevinkt.clear();
  const { kaarten, resterend } = await api('/api/trek', { dekken: spel.dekken, gebruikt: spel.gebruikt, aantal: 1 });
  if (!kaarten.length) return meld('De stapel is leeg.');
  S.legKaart(spel, kaarten[0]);
  spel.resterend = resterend;
  staat.stop = null;
  bewaar();
  renderBord();
  await speelFragment();
}

async function speelFragment() {
  const spel = staat.spel;
  const kaart = spel?.huidig;
  if (!kaart) return;
  const speler = $('#speler');

  if (!speler.paused && speler.src) {
    speler.pause();
    staat.audio.bezig = false;
    renderBord();
    return;
  }

  if (!speler.src || staat.audio.kaartId !== kaart.id) {
    const { url } = await api(`/api/fragment?id=${kaart.id}`);
    speler.src = url;
    staat.audio.kaartId = kaart.id;
  }
  speler.currentTime = 0;
  try {
    await speler.play();
  } catch {
    meld('Druk nog eens op de afspeelknop om het fragment te starten.');
    return;
  }
  staat.audio.bezig = true;
  staat.audio.start = performance.now();
  clearTimeout(staat.audio.stopTimer);
  staat.audio.stopTimer = setTimeout(() => {
    speler.pause();
    staat.audio.bezig = false;
    renderBord();
  }, spel.fragment * 1000);
  clearInterval(staat.audio.timer);
  staat.audio.timer = setInterval(() => {
    const balk = $('#balkvulling');
    if (!balk) return clearInterval(staat.audio.timer);
    const deel = Math.min(1, (performance.now() - staat.audio.start) / (spel.fragment * 1000));
    balk.style.width = `${deel * 100}%`;
  }, 120);
  renderBord();
}

async function onthul() {
  const spel = staat.spel;
  if (!spel.huidig) return;
  const { kaarten } = await api('/api/onthul', { ids: [spel.huidig.id] });
  if (!kaarten.length) return meld('Kaart niet gevonden.');
  S.onthulHuidig(spel, kaarten[0]);
  spel.fase = 'onthuld';
  bewaar();
  renderBord();
}

/* ── tijdlijnspellen ───────────────────────────────────────────────────── */

async function legNeer() {
  const spel = staat.spel;
  if (staat.gekozenPlek === null) return meld('Kies eerst een plek in de tijdlijn.');
  const plek = staat.gekozenPlek;
  await onthul();
  const uitkomst = S.beoordeelPlaatsing(spel, spel.beurt, plek);
  spel.laatste = uitkomst;
  bewaar();
  renderBord();
  meld(uitkomst.goed ? 'Goed gelegd!' : 'Helaas, die kaart gaat eruit.');
}

async function slaOver() {
  const spel = staat.spel;
  const uitkomst = S.slaOver(spel, spel.beurt);
  if (!uitkomst.gelukt) return meld('Je hebt geen fiches meer.');
  staat.gekozenPlek = null;
  bewaar();
  await trekKaart();
}

async function koopKaart() {
  const spel = staat.spel;
  const uitkomst = S.koopKaart(spel, spel.beurt);
  if (!uitkomst.gelukt) return meld(uitkomst.reden);
  await onthul();
  const jaar = spel.huidig.onthuld.jaar;
  const speler = spel.spelers[spel.beurt];
  S.beoordeelPlaatsing(spel, spel.beurt, S.juistePlek(speler.tijdlijn, jaar));
  spel.laatste = { goed: true, gekocht: true };
  bewaar();
  renderBord();
  meld('Kaart gekocht en goed neergelegd.');
}

async function koopHint() {
  const spel = staat.spel;
  if (!S.neemFiche(spel, spel.beurt, 2)) return meld('Daar heb je twee fiches voor nodig.');
  const { decennium } = await api('/api/hint', { id: spel.huidig.id });
  spel.hint = decennium;
  bewaar();
  renderBord();
  meld(`De hint: dit nummer is uit de jaren ${decennium === 1970 ? 'zeventig' : decennium === 1980 ? 'tachtig' : decennium === 1990 ? 'negentig' : decennium === 1960 ? 'zestig' : decennium === 2000 ? 'nul' : decennium === 2010 ? 'tien' : 'twintig'}.`);
}

async function steelKaart(plek) {
  const spel = staat.spel;
  if (!staat.steel?.dief && staat.steel?.dief !== 0) return meld('Kies eerst wie er steelt.');
  const dief = staat.steel.dief;
  await onthul();
  const uitkomst = S.steel(spel, dief, spel.beurt, plek);
  staat.steel = null;
  spel.laatste = { goed: false, gestolen: uitkomst.goed, dief: uitkomst.goed ? dief : null };
  bewaar();
  renderBord();
  meld(uitkomst.goed ? 'Gestolen! De kaart gaat naar de uitdager.' : 'Helaas, de kaart lag goed. Fiche kwijt.');
}

async function verdienFiche(i) {
  const spel = staat.spel;
  spel.fichesGegeven = spel.fichesGegeven || [];
  if (spel.fichesGegeven.includes(i)) {
    meld('Die fiche is al gegeven.');
    return;
  }
  spel.fichesGegeven.push(i);
  S.geefFiche(spel, i, 1);
  bewaar();
  renderBord();
  meld(`Fiche voor ${spelersNaam(spel, i)}.`);
}

/* ── Raoj 's varianten ─────────────────────────────────────────────────── */

function geefPuntenAanAangevinkten() {
  const spel = staat.spel;
  if (!staat.aangevinkt.size) return meld('Vink aan wie het goed had.');
  const wie = [...staat.aangevinkt];
  S.geefPunten(spel, wie, 1);
  const kaart = spel.huidig?.onthuld;
  if (kaart) {
    spel.log.push({ speler: wie[0], goed: true, titel: `${kaart.titel} — punten voor ${wie.map((i) => spel.spelers[i].naam).join(', ')}`, artiest: kaart.artiest, jaar: kaart.jaar, positie: 0, juistePositie: 0 });
  }
  staat.aangevinkt.clear();
  bewaar();
  if (spel.fase === 'afgelopen') return renderBord();
  volgendeSpeler();
}

function buzz(i) {
  const spel = staat.spel;
  if (spel.variant !== 'stops' || staat.stop || spel.fase !== 'plaatsen') return;
  const seconden = Math.max(0.4, (performance.now() - staat.audio.start) / 1000);
  $('#speler').pause();
  staat.audio.bezig = false;
  clearTimeout(staat.audio.stopTimer);
  staat.stop = { speler: i, seconden };
  renderBord();
}

function buzzerGoed(gelukt) {
  const spel = staat.spel;
  if (!staat.stop) return;
  const { speler: i, seconden } = staat.stop;
  if (gelukt) {
    const punten = S.stopPunten(seconden);
    S.geefPunten(spel, [i], punten);
    spel.laatste = { speler: i, punten, seconden };
    staat.stop = null;
    const alAfgelopen = spel.fase === 'afgelopen';
    spel.fase = 'plaatsen';
    onthul().then(() => {
      if (!alAfgelopen && spel.fase !== 'afgelopen') spel.fase = 'onthuld';
      bewaar();
      renderBord();
    });
    meld(`${spelersNaam(spel, i)}: ${punten} punten na ${seconden.toFixed(1)} seconden.`);
  } else {
    spel.spelers[i].fout += 1;
    spel.afgevallen = spel.afgevallen || [];
    if (!spel.afgevallen.includes(i)) spel.afgevallen.push(i);
    staat.stop = null;
    bewaar();
    renderBord();
    meld('Fout — de anderen mogen verder raden.');
    speelFragment();
  }
}

async function lvkKeuze(jao) {
  const spel = staat.spel;
  spel.laatste = { keuze: jao };
  await onthul();
  const kaart = spel.huidig.onthuld;
  spel.log.push({ speler: spel.beurt, goed: (kaart.lvk === true) === jao, titel: kaart.titel, artiest: kaart.artiest, jaar: kaart.jaar, positie: 0, juistePositie: 0 });
  bewaar();
  renderBord();
}

/* ── beurten ───────────────────────────────────────────────────────────── */

function volgendeSpeler() {
  const spel = staat.spel;
  if (spel.fase === 'afgelopen') return renderBord();
  S.volgendeBeurt(spel);
  spel.ronde = (spel.ronde || 1) + 1;
  spel.laatste = null;
  spel.hint = null;
  spel.fichesGegeven = null;
  spel.afgevallen = null;
  staat.stop = null;
  staat.aangevinkt.clear();
  staat.gekozenPlek = null;
  staat.steel = null;
  bewaar();
  renderBord();
}

/* ── bord tekenen ──────────────────────────────────────────────────────── */

function kaartjeHtml(kaart, opties = {}) {
  return `
  <div class="kaartje ${opties.rugg ? 'rugg' : ''}">
    ${opties.rugg ? '<span class="vraag">?</span>' : ''}
    ${!opties.rugg && kaart.hoes ? `<img class="hoes" src="${esc(kaart.hoes)}" alt="" loading="lazy">` : ''}
    ${!opties.rugg ? `<div class="jaar">${esc(kaart.jaar)}</div><div class="titel">${esc(kaart.titel)}<br><span class="kleiner">${esc(kaart.artiest)}</span></div>` : ''}
  </div>`;
}

function gleufHtml(plek, gekozen) {
  return `<div class="gleuf ${gekozen === plek ? 'gekozen' : ''}"><button data-act="kies-plek" data-plek="${plek}" title="Hier neerleggen">${gekozen === plek ? '✓' : '+'}</button></div>`;
}

function tijdlijnHtml(speler, opties = {}) {
  const delen = [];
  speler.tijdlijn.forEach((kaart, i) => {
    if (opties.gleuven) delen.push(gleufHtml(i, opties.gekozen));
    delen.push(kaartjeHtml(kaart));
  });
  if (opties.gleuven) delen.push(gleufHtml(speler.tijdlijn.length, opties.gekozen));
  if (!speler.tijdlijn.length && !opties.gleuven) delen.push('<p class="klein">Nog geen kaarten.</p>');
  return `<div class="tijdlijn">${delen.join('')}</div>`;
}

function spelersHtml(spel) {
  return spel.spelers
    .map((s, i) => {
      const score = tijdlijnSpel(spel) ? `${s.goed}/${spel.doel} kaarten` : `${s.punten} punten`;
      return `
    <div class="speler ${i === spel.beurt ? 'aan' : ''}" style="border-left-color:${s.kleur}">
      <div class="naam">${i === spel.beurt ? '▸ ' : ''}${esc(s.naam)}</div>
      <div class="score"><span>${score}</span><span>${s.fout ? `${s.fout} mis` : ''}</span></div>
      <div class="fiches stippen" title="${fichesNaam(spel)}: ${s.fiches}">
        ${Array.from({ length: S.regelsVan(spel).fichesMax }, (_, k) => `<span class="stip ${k < s.fiches ? '' : 'leeg'}"></span>`).join('')}
      </div>
    </div>`;
    })
    .join('');
}

function fragmentbalkHtml(spel, { knop = true } = {}) {
  return `
  <div class="fragmentbalk">
    ${knop ? `<button class="speelknop" data-act="${staat.audio.bezig ? 'pauze' : 'speel'}" title="Fragment afspelen">
      <svg viewBox="0 0 24 24" fill="currentColor">${staat.audio.bezig ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>' : '<path d="M8 5.5v13l11-6.5z"/>'}</svg>
    </button>` : ''}
    <div class="balk"><i id="balkvulling"></i></div>
    <span class="chip">${spel.fragment}s fragment</span>
  </div>`;
}

function onthullingHtml(spel) {
  const kaart = spel.huidig?.onthuld;
  if (!kaart) return '';
  const laatste = spel.laatste || {};
  const oordeel = laatste.goed === true ? '<span class="oordeel goed">Goed!</span>' : laatste.goed === false ? '<span class="oordeel fout">Helaas</span>' : '';
  const lvkTekst = kaart.lvk === true ? '<span class="chip gael">LVK-inzending</span>' : kaart.lvk === false ? '<span class="chip">Geen LVK-inzending</span>' : '';
  return `
  <div class="onthulling">
    ${kaart.hoes ? `<img class="hoes" src="${esc(kaart.hoes)}" alt="">` : ''}
    <div style="flex:1;min-width:220px">
      <div class="jaar">${esc(kaart.jaar)}</div>
      <h3>${esc(kaart.titel)}</h3>
      <p class="klein" style="margin:0">${esc(kaart.artiest)}${kaart.album ? ` · ${esc(kaart.album)}` : ''}</p>
      <p class="kleiner">jaartal volgens: ${esc(kaart.jaarBron || 'onbekend')}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${oordeel} ${lvkTekst}</div>
    </div>
  </div>`;
}

function fichesKnoppenHtml(spel) {
  return `
  <div style="margin-top:12px">
    <label class="veld">Titel én artiest genoemd? Dan een ${spel.soort === 'hittepetit' ? 'nónnevot' : 'fiche'} erbij</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${spel.spelers.map((s, i) => `<button class="knop zacht klein" data-act="fiche-titel" data-speler="${i}" ${spel.fichesGegeven?.includes(i) ? 'disabled' : ''}>+ ${esc(s.naam)}</button>`).join('')}
    </div>
  </div>`;
}

function renderBord() {
  const spel = staat.spel;
  if (!spel) return;
  const regels = S.regelsVan(spel);
  $('#spel-titel').textContent = `${regels.naam}${spel.variant && spel.variant !== 'raojs' ? ` — ${S.VARIANTEN[spel.variant].naam}` : ''}`;
  $('#spel-ronde').textContent = `beurt ${spel.ronde}`;
  $('#spel-rest').textContent = spel.resterend !== undefined ? `${spel.resterend} kaarten in de stapel` : '';
  $('#spelers').innerHTML = spelersHtml(spel);

  const bord = $('#bord');
  if (spel.fase === 'afgelopen') return renderEinde(bord);

  const actief = spel.spelers[spel.beurt];
  const blokken = [];

  if (spel.fase === 'trekken') {
    blokken.push(`
      <div class="speelveld">
        <h2>${esc(actief.naam)} is aan de beurt</h2>
        <p class="klein">Trek een kaart en luister naar het fragment. Zet daarna de kaart op de plek waar jij het jaartal verwacht.</p>
        <button class="knop groot" data-act="trek">Trek een kaart</button>
      </div>`);
  }

  if (spel.fase === 'plaatsen' || spel.fase === 'onthuld') {
    blokken.push(`<div class="speelveld">${fragmentbalkHtml(spel)}${spel.fase === 'plaatsen' ? hintHtml(spel) : ''}</div>`);
  }

  if (spel.fase === 'plaatsen') {
    if (spel.variant === 'stops') blokken.push(buzzerBlok(spel));
    else if (spel.variant === 'lvjao') blokken.push(lvkBlok(spel));
    else if (tijdlijnSpel(spel)) blokken.push(plaatsBlok(spel));
    else blokken.push(zingBlok(spel));
  }

  if (spel.fase === 'onthuld') {
    blokken.push(`<div class="speelveld" style="margin-top:14px">${onthullingHtml(spel)}${naOnthullingHtml(spel)}</div>`);
  }

  if (tijdlijnSpel(spel) && spel.fase !== 'afgelopen') {
    blokken.push(`
      <div class="kaart" style="margin-top:14px">
        <h3>Tijdlijn van ${esc(actief.naam)}</h3>
        ${tijdlijnHtml(actief)}
      </div>`);
    const anderen = spel.spelers.map((s, i) => (i === spel.beurt ? '' : `<div style="margin-top:10px"><h3>${esc(s.naam)} <span class="klein">(${s.goed}/${spel.doel})</span></h3>${tijdlijnHtml(s)}</div>`)).join('');
    if (anderen) blokken.push(`<div class="kaart" style="margin-top:14px">${anderen}</div>`);
  }

  bord.innerHTML = blokken.join('');
  renderLog();
}

function hintHtml(spel) {
  if (spel.hint) {
    const namen = { 1950: 'vijftig', 1960: 'zestig', 1970: 'zeventig', 1980: 'tachtig', 1990: 'negentig', 2000: 'nul', 2010: 'tien', 2020: 'twintig' };
    return `<p class="klein" style="margin-top:10px"><strong>Hint:</strong> dit nummer is uit de jaren ${namen[spel.hint] || spel.hint}.</p>`;
  }
  return '';
}

function plaatsBlok(spel) {
  const actief = spel.spelers[spel.beurt];
  const fiches = actief.fiches;
  const prijs = S.regelsVan(spel).kaartPrijs;
  const steelOpen = Boolean(staat.steel);
  return `
  <div class="speelveld" style="margin-top:14px">
    <h2>Waar hoort deze kaart in de tijdlijn van ${esc(actief.naam)}?</h2>
    <p class="klein">Druk op een van de plusjes tussen de kaarten en leg hem daar neer.</p>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:10px 0">
      ${kaartjeHtml({}, { rugg: true })}
      <div style="flex:1;min-width:240px">${tijdlijnHtml(actief, { gleuven: true, gekozen: staat.gekozenPlek })}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="knop groot" data-act="leg-neer" ${staat.gekozenPlek === null ? 'disabled' : ''}>Leg hier neer</button>
      <button class="knop zacht" data-act="overslaan" ${fiches < 1 ? 'disabled' : ''}>Overslaan (1 ${spel.soort === 'hittepetit' ? 'nónnevot' : 'fiche'})</button>
      <button class="knop zacht" data-act="hint" ${fiches < 2 ? 'disabled' : ''}>Hint: decennium (2)</button>
      <button class="knop zacht" data-act="koop" ${fiches < prijs ? 'disabled' : ''}>Kaart kopen (${prijs})</button>
      <button class="knop ${steelOpen ? 'rood' : 'zacht'}" data-act="hitster">HITSTER! — iemand legt verkeerd</button>
    </div>
    ${steelOpen ? steelBlok(spel) : ''}
  </div>`;
}

function steelBlok(spel) {
  const anderen = spel.spelers.map((s, i) => (i === spel.beurt ? '' : `<button class="knop ${staat.steel.dief === i ? '' : 'zacht'} klein" data-act="steel-kies" data-speler="${i}">${esc(s.naam)}</button>`)).join('');
  const klaar = staat.steel.dief !== null && staat.steel.dief !== undefined;
  const actief = spel.spelers[spel.beurt];
  return `
  <div class="kaart" style="margin-top:12px;border-color:var(--rood)">
    <h3>Wie roept HITSTER?</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${anderen}</div>
    ${klaar ? `<p class="klein">Wijs in de tijdlijn van ${esc(actief.naam)} de plek aan waar de kaart volgens jou hoort. De kaart wordt daarna omgedraaid.</p>${tijdlijnHtml(actief, { gleuven: true, gekozen: null }).replace(/data-act="kies-plek"/g, 'data-act="steel-plek"')}` : '<p class="klein">Kies eerst wie er steelt.</p>'}
  </div>`;
}

function zingBlok(spel) {
  return `
  <div class="speelveld" style="margin-top:14px">
    <h2>Zîng 's — zing mee!</h2>
    <p class="klein">Laat het fragment horen en laat iedereen meezingen. Vink daarna aan wie de tekst kende.</p>
    <button class="knop groot" data-act="onthul">Onthullen wie het was</button>
  </div>`;
}

function lvkBlok(spel) {
  return `
  <div class="speelveld" style="margin-top:14px">
    <h2>Was dit ooit een LVK-inzending?</h2>
    <p class="klein">Het Limburgs Vastelaovesleedjes Konkoer bestaat sinds 1977.</p>
    <div class="grotekeuze" style="margin-top:12px">
      <button data-act="lvk-keuze" data-keuze="jao">Jao — LVK</button>
      <button data-act="lvk-keuze" data-keuze="nein">Nein — geen LVK</button>
    </div>
  </div>`;
}

function buzzerBlok(spel) {
  const klaar = Boolean(staat.stop);
  const afgevallen = Array.isArray(spel.afgevallen) ? spel.afgevallen : [];
  return `
  <div class="speelveld" style="margin-top:14px">
    <h2>Stop 's — druk zo snel mogelijk</h2>
    <p class="klein">${klaar ? `${esc(spel.spelers[staat.stop.speler].naam)} drukte na ${staat.stop.seconden.toFixed(1)} seconden.` : 'Wie het nummer herkent, drukt op zijn knop. Op een toetsenbord werken ook de cijfers 1 tot en met 9.'}</p>
    <div class="buzzer" style="margin-top:12px">
      ${spel.spelers
        .map(
          (s, i) =>
            `<button data-act="buzzer" data-speler="${i}" ${klaar || afgevallen.includes(i) ? 'disabled' : ''} class="${staat.stop?.speler === i ? 'geraden' : ''}">${i + 1}. ${esc(s.naam)}</button>`,
        )
        .join('')}
    </div>
    ${
      klaar
        ? `<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
             <button class="knop groen groot" data-act="buzzer-goed">Goed geraden</button>
             <button class="knop rood groot" data-act="buzzer-fout">Fout geraden</button>
           </div>`
        : ''
    }
  </div>`;
}

function naOnthullingHtml(spel) {
  const laatste = spel.laatste || {};
  if (spel.variant === 'lvjao') {
    const goed = laatsteGoed(spel);
    return `
    <p class="klein" style="margin-top:10px">Jouw keuze was <strong>${laatste.keuze ? 'Jao' : 'Nein'}</strong> — dat is ${goed ? 'goed' : 'fout'}.</p>
    <div style="margin-top:10px">
      <label class="veld">Wie had het goed?</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${spel.spelers.map((s, i) => `<button class="knop ${staat.aangevinkt.has(i) ? 'groen' : 'zacht'} klein" data-act="punten" data-speler="${i}">${esc(s.naam)}</button>`).join('')}
      </div>
      <button class="knop" style="margin-top:10px" data-act="punten-geven">Punten geven</button>
    </div>`;
  }
  if (spel.variant === 'zings') {
    return `
    <div style="margin-top:10px">
      <label class="veld">Wie kende de tekst?</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${spel.spelers.map((s, i) => `<button class="knop ${staat.aangevinkt.has(i) ? 'groen' : 'zacht'} klein" data-act="punten" data-speler="${i}">${esc(s.naam)}</button>`).join('')}
      </div>
      <button class="knop" style="margin-top:10px" data-act="punten-geven">Punten geven</button>
    </div>`;
  }
  return `
  ${fichesKnoppenHtml(spel)}
  <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
    <button class="knop groot" data-act="volgende">Volgende speler</button>
    ${laatste.goed === false ? '<span class="chip rood">De kaart gaat van tafel</span>' : ''}
    ${laatste.gestolen ? '<span class="chip gael">De kaart is gestolen</span>' : ''}
  </div>`;
}

function laatsteGoed(spel) {
  const kaart = spel.huidig?.onthuld;
  if (!kaart) return false;
  return (kaart.lvk === true) === Boolean(spel.laatste?.keuze);
}

function renderEinde(bord) {
  const spel = staat.spel;
  const rang = S.stand(spel);
  const winnaar = spel.spelers[spel.winnaar ?? 0];
  bord.innerHTML = `
  <div class="speelveld">
    <h1 style="margin-bottom:6px">${esc(winnaar?.naam || 'Niemand')} wint!</h1>
    <p class="klein">Eindstand na ${spel.log.length} kaarten.</p>
    <table class="tabel" style="margin-top:12px">
      <thead><tr><th>#</th><th>Speler</th><th>Kaarten goed</th><th>Mis</th><th>Punten</th></tr></thead>
      <tbody>
        ${rang
          .map(
            (s, i) => `<tr><td>${i + 1}</td><td><span class="bolletje" style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${s.kleur}"></span> ${esc(s.naam)}</td><td>${s.goed}</td><td>${s.fout}</td><td>${s.punten}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="knop groot" data-act="nieuw-spel">Nieuw spel</button>
      <button class="knop zacht" data-act="spel-uitleg">Spelregels</button>
    </div>
  </div>`;
  renderLog();
}

function renderLog() {
  const spel = staat.spel;
  const vak = $('#spellog');
  if (!spel.log.length) {
    vak.innerHTML = '<p class="klein">Nog niets gebeurd.</p>';
    return;
  }
  vak.innerHTML = spel.log
    .slice()
    .reverse()
    .map(
      (r) => `<div class="regel"><span class="${r.goed ? 'goed' : 'fout'}">${r.goed ? 'goed' : 'mis'}</span>
      <span>${esc(spel.spelers[r.speler]?.naam || '?')} — ${esc(r.artiest)} · ${esc(r.titel)} <span class="kleiner">(${esc(r.jaar)})</span></span></div>`,
    )
    .join('');
}

/* ── toetsenbord (buzzers en afspelen) ─────────────────────────────────── */

document.addEventListener('keydown', (gebeurtenis) => {
  const spel = staat.spel;
  if (!spel || $('#view-spel').hidden) return;
  if (gebeurtenis.target.tagName === 'INPUT') return;
  if (spel.variant === 'stops' && spel.fase === 'plaatsen' && /^[1-9]$/.test(gebeurtenis.key)) {
    const i = Number(gebeurtenis.key) - 1;
    if (spel.spelers[i]) buzz(i);
    return;
  }
  if (gebeurtenis.code === 'Space') {
    gebeurtenis.preventDefault();
    if (spel.fase === 'trekken') trekKaart().catch((f) => meld(f.message));
    else speelFragment().catch((f) => meld(f.message));
  }
});

/* ── muziekbibliotheek ─────────────────────────────────────────────────── */

async function laadMuziek() {
  const keuze = $('#muziek-dek');
  if (!keuze.options.length) {
    keuze.innerHTML = staat.dekken.map((d) => `<option value="${esc(d.id)}">${esc(d.naam)} (${d.aantal})</option>`).join('');
    keuze.value = staat.muziek.dek;
  }
  await zoekMuziek(0);
}

async function zoekMuziek(vanaf) {
  staat.muziek.dek = $('#muziek-dek').value || 'hits';
  staat.muziek.zoek = $('#muziek-zoek').value.trim();
  staat.muziek.vanaf = Math.max(0, vanaf);
  const data = await api(
    `/api/nummers?dek=${encodeURIComponent(staat.muziek.dek)}&zoek=${encodeURIComponent(staat.muziek.zoek)}&vanaf=${staat.muziek.vanaf}&limiet=${staat.muziek.limiet}`,
  );
  $('#muziek-telling').textContent = `${data.totaal.toLocaleString('nl-NL')} nummers — nu ${staat.muziek.vanaf + 1} tot ${Math.min(data.totaal, staat.muziek.vanaf + data.limiet)}`;
  $('#muziek-lijst').innerHTML = data.nummers
    .map(
      (n) => `<tr>
      <td>${n.hoes ? `<img src="${esc(n.hoes)}" alt="" loading="lazy">` : ''}</td>
      <td>${esc(n.titel)}</td>
      <td>${esc(n.artiest)}</td>
      <td class="jaar">${esc(n.jaar)}</td>
      <td><span class="chip">${esc(n.soort === 'vastelaovend' ? 'vastelaovend' : n.soort === 'limburg' ? 'Limburgs' : n.soort === 'eigen' ? 'eigen' : 'hit')}</span>${n.lvk === true ? ' <span class="chip gael">LVK</span>' : ''}</td>
      <td><button class="knop zacht klein" data-act="luister" data-id="${n.id}">▶</button></td>
    </tr>`,
    )
    .join('');
}

$('#muziek-laden').addEventListener('click', () => zoekMuziek(0).catch((f) => meld(f.message)));
$('#muziek-zoek').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') zoekMuziek(0).catch((f) => meld(f.message));
});
$('#muziek-volgende').addEventListener('click', () => zoekMuziek(staat.muziek.vanaf + staat.muziek.limiet).catch((f) => meld(f.message)));
$('#muziek-vorige').addEventListener('click', () => zoekMuziek(Math.max(0, staat.muziek.vanaf - staat.muziek.limiet)).catch((f) => meld(f.message)));

document.addEventListener('click', async (gebeurtenis) => {
  const knop = gebeurtenis.target.closest('[data-act="luister"]');
  if (!knop) return;
  const speler = $('#speler');
  try {
    const { url } = await api(`/api/fragment?id=${knop.dataset.id}`);
    speler.src = url;
    await speler.play();
    meld('Fragment speelt.');
  } catch (fout) {
    meld(fout.message);
  }
});

/* ── beheer ────────────────────────────────────────────────────────────── */

async function laadBeheer() {
  const status = await api('/api/beheer/status').catch(() => ({}));
  staat.ingelogd = Boolean(status.ingelogd);
  $('#beheer-inlog').hidden = staat.ingelogd;
  $('#beheer-paneel').hidden = !staat.ingelogd;
  $('#beheer-melding').textContent = status.ingesteld
    ? ''
    : 'Op deze server is nog geen beheerderswachtwoord ingesteld (omgevingsvariabele SJPEELAVOND_WACHTWOORD).';
  if (staat.ingelogd) laadEigen();
}

async function laadEigen() {
  const data = await api('/api/beheer/eigen');
  $('#eigen-lijst').innerHTML = data.nummers.length
    ? `<table class="tabel"><thead><tr><th>Titel</th><th>Artiest</th><th>Jaar</th><th></th></tr></thead><tbody>
      ${data.nummers
        .map(
          (n) => `<tr><td>${esc(n.titel)}</td><td>${esc(n.artiest)}</td><td class="jaar">${esc(n.jaar)}</td>
        <td><button class="knop rood klein" data-act="eigen-weg" data-id="${n.id}">Verwijderen</button></td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="klein">Nog geen eigen nummers toegevoegd.</p>';
}

$('#beheer-inloggen').addEventListener('click', async () => {
  try {
    await api('/api/beheer/inloggen', { wachtwoord: $('#beheer-wachtwoord').value });
    $('#beheer-wachtwoord').value = '';
    meld('Ingelogd.');
    laadBeheer();
  } catch (fout) {
    $('#beheer-melding').textContent = fout.message;
  }
});

$('#eigen-opslaan').addEventListener('click', async () => {
  const bestand = $('#eigen-bestand').files[0];
  if (!bestand) return meld('Kies eerst een muziekbestand.');
  try {
    await api('/api/beheer/eigen', null, {
      method: 'POST',
      headers: {
        'x-titel': $('#eigen-titel').value,
        'x-artiest': $('#eigen-artiest').value,
        'x-jaar': $('#eigen-jaar').value,
        'x-album': $('#eigen-album').value,
        'x-bestandsnaam': encodeURIComponent(bestand.name),
        'content-type': bestand.type || 'application/octet-stream',
      },
      body: bestand,
    });
    meld('Toegevoegd.');
    $('#eigen-titel').value = $('#eigen-artiest').value = $('#eigen-jaar').value = $('#eigen-album').value = '';
    $('#eigen-bestand').value = '';
    laadEigen();
    laadVersie();
  } catch (fout) {
    meld(fout.message);
  }
});

document.addEventListener('click', async (gebeurtenis) => {
  const knop = gebeurtenis.target.closest('[data-act="eigen-weg"]');
  if (!knop) return;
  if (!confirm('Dit nummer verwijderen?')) return;
  try {
    await api(`/api/beheer/eigen/${knop.dataset.id}`, null, { method: 'DELETE' });
    meld('Verwijderd.');
    laadEigen();
    laadVersie();
  } catch (fout) {
    meld(fout.message);
  }
});

/* ── opstarten ─────────────────────────────────────────────────────────── */

async function laadVersie() {
  staat.versie = await api('/api/versie');
  staat.dekken = staat.versie.dekken;
  $('#versiechip').textContent = `v${staat.versie.versie}`;
  $('#voetversie').textContent = `versie ${staat.versie.versie}`;
  renderStart();
}

/* ── de kaartjes van de fysieke spellen scannen ────────────────────────── */

/**
 * De doos op tafel met de app als dj. De schil leest de QR-code en geeft de tekst
 * door aan {@link verwerkScan}; het opzoeken gaat via /api/kaart, zodat de app en de
 * serverversie precies hetzelfde doen (zie public/js/kaart.js).
 */
const scan = { kaart: null, ronde: [], timer: null, stopTimer: null, onthuld: false };

function scanMelding(tekst) {
  const vak = $('#scan-melding');
  if (vak) vak.textContent = tekst || '';
}

/** De camera openen. Zonder schil (in de browser) blijft het bij de code overtypen. */
function scanKaartje() {
  const schil = window.Sjpeelavond;
  if (!schil || typeof schil.scanKaart !== 'function') {
    scanMelding('Scannen kan in de Android-app; typ hiernaast de code van het kaartje over.');
    return;
  }
  scanMelding('De camera gaat open…');
  schil.scanKaart();
}

async function verwerkScan(tekst) {
  if (!tekst) {
    scanMelding('Geen code gelezen; probeer het nog eens.');
    return;
  }
  scanMelding('Kaartje gelezen, nummer opzoeken…');
  try {
    const uitkomst = await api('/api/kaart', { code: tekst });
    scan.kaart = uitkomst;
    scan.onthuld = false;
    scan.ronde.push({ kaart: uitkomst.kaart, editie: uitkomst.editie?.naam || uitkomst.editieId, lied: uitkomst.lied, onthuld: false });
    // Waar de rooktest op wacht: de code is opgezocht, er is een jaartal en er is een
    // fragment. Zonder een van die drie is het scannen niet gelukt.
    if (typeof window.Sjpeelavond?.log === 'function') {
      window.Sjpeelavond.log(
        `SJPEELAVOND_SCAN kaartje=${uitkomst.kaart} jaar=${uitkomst.lied.jaar} fragment=${uitkomst.lied.fragment ? 'ja' : 'nee'}`,
      );
    }
    renderScan();
    await speelScanFragment();
    scanMelding(`Kaartje ${uitkomst.kaart} van ${uitkomst.editie?.naam || uitkomst.editieId}.`);
  } catch (fout) {
    scan.kaart = null;
    renderScan();
    scanMelding(fout.message);
    meld(fout.message);
  }
}

/** Het fragment van het gescande kaartje, met dezelfde speler als het spel. */
async function speelScanFragment() {
  const lied = scan.kaart?.lied;
  const speler = $('#speler');
  if (!lied?.fragment) {
    scanMelding('Voor dit nummer is geen fragment beschikbaar.');
    return;
  }
  speler.pause();
  speler.src = lied.fragment;
  speler.currentTime = 0;
  try {
    await speler.play();
  } catch (fout) {
    scanMelding(`Het fragment kon niet starten: ${fout.message}`);
    return;
  }
  scan.start = performance.now();
  clearTimeout(scan.stopTimer);
  scan.stopTimer = setTimeout(() => {
    speler.pause();
    scanMelding('Fragment afgelopen. Onthul of scan het volgende kaartje.');
  }, 30000);
  clearInterval(scan.timer);
  scan.timer = setInterval(tekenScanBalk, 120);
  renderScan();
}

function tekenScanBalk() {
  const balk = $('#scan-balk');
  if (!balk) return clearInterval(scan.timer);
  const deel = Math.min(1, (performance.now() - (scan.start || 0)) / 30000);
  balk.style.width = `${deel * 100}%`;
}

function renderScan() {
  const vak = $('#scan-kaart');
  if (!vak) return;
  const kaart = scan.kaart;
  if (!kaart) {
    vak.innerHTML = '<p class="klein">Nog geen kaartje gescand. Pak een kaart uit de doos en scan de QR-code — je hoort het fragment en ziet nog niets.</p>';
    return;
  }
  const editie = kaart.editie?.naam || kaart.editieId;
  vak.innerHTML = `
    <p class="klein" style="margin:0 0 10px">Kaartje <strong>${esc(kaart.kaart)}</strong> · ${esc(editie)}</p>
    <div class="fragmentbalk">
      <button class="speelknop" data-act="scan-speel" title="Fragment afspelen">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
      </button>
      <div class="balk"><i id="scan-balk"></i></div>
      <span class="chip">30 seconden</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <button class="knop" data-act="scan-onthul">Onthul</button>
      <button class="knop zacht" data-act="scan">Volgende kaartje scannen</button>
    </div>
    <div id="scan-onthulling" style="margin-top:14px" ${scan.onthuld ? '' : 'hidden'}>
      ${scan.onthuld ? scanOnthullingHtml(kaart) : ''}
    </div>`;
}

function scanOnthullingHtml(kaart) {
  const lied = kaart.lied;
  const naam = kaart.editie?.naam || kaart.editieId;
  if (!lied.titel) {
    // Raoj 's geeft alleen het fragment; de titel, artiest en het jaartal staan op het
    // kaartje zelf, dus daar verwijzen we naar in plaats van iets te verzinnen.
    return `
  <div class="onthulling">
    <div style="flex:1;min-width:200px">
      <h3>Kaartje ${esc(kaart.kaart)}</h3>
      <p class="klein" style="margin:0">Draai het kaartje om: titel, artiest en jaartal staan erop. ${esc(naam)} geeft ze niet vrij.</p>
      <p class="kleiner">kaartje ${esc(kaart.kaart)} · ${esc(naam)}</p>
    </div>
  </div>`;
  }
  return `
  <div class="onthulling">
    ${lied.hoes ? `<img class="hoes" src="${esc(lied.hoes)}" alt="">` : ''}
    <div style="flex:1;min-width:200px">
      <div class="jaar">${esc(lied.jaar ?? '?')}</div>
      <h3>${esc(lied.titel)}</h3>
      <p class="klein" style="margin:0">${esc(lied.artiest)}</p>
      <p class="kleiner">kaartje ${esc(kaart.kaart)} · ${esc(naam)}</p>
    </div>
  </div>`;
}

/** Het kaartje omdraaien: nu mogen titel, artiest en jaartal gezien worden. */
function onthulScan() {
  if (!scan.kaart) return;
  scan.onthuld = true;
  const laatste = scan.ronde[scan.ronde.length - 1];
  if (laatste) laatste.onthuld = true;
  const vak = $('#scan-onthulling');
  if (vak) {
    vak.hidden = false;
    vak.innerHTML = scanOnthullingHtml(scan.kaart);
  }
  renderScanRonde();
}

function renderScanRonde() {
  const vak = $('#scan-ronde');
  const houder = $('#scan-rondevak');
  if (!vak || !houder) return;
  houder.hidden = scan.ronde.length === 0;
  vak.innerHTML = scan.ronde
    .map((k, i) => {
      const jaar = k.onthuld && k.lied?.jaar ? ` · ${esc(k.lied.jaar)}` : '';
      return `<p class="klein" style="margin:0 0 6px">${i + 1}. kaartje ${esc(k.kaart)} · ${esc(k.editie)}${jaar}</p>`;
    })
    .join('');
}

/* ── diepe link ────────────────────────────────────────────────────────── */

/**
 * Een adres als `index.html#muziek` of `#spel-kaart` opent meteen dat scherm.
 * De Android-schil gebruikt dit om een scherm te openen voor een foto, en het is
 * tegelijk een gewone deeplink: #muziek, #uitleg, #instellen, #spel, #spel-kaart
 * en #hittepetit doen allemaal wat je verwacht.
 */
async function startVanAdres() {
  const naam = String(location.hash || '').replace(/^#/, '').trim();
  if (!naam) return false;
  if (naam === 'muziek') {
    await laadMuziek();
    toonView('muziek');
    return true;
  }
  if (naam === 'uitleg') {
    toonView('uitleg');
    return true;
  }
  if (naam === 'scannen') {
    toonView('scannen');
    return true;
  }
  const soorten = { instellen: 'tijdlijn', spel: 'tijdlijn', 'spel-kaart': 'tijdlijn', hittepetit: 'hittepetit' };
  if (!(naam in soorten)) return false;
  openInstellen(soorten[naam]);
  if (naam === 'instellen') return true;
  staat.keuzes.namen = ['Speler 1', 'Speler 2'];
  await startSpel();
  if (naam === 'spel-kaart') await trekKaart();
  return true;
}

async function opstarten() {
  // De schil geeft de code van een gescand kaartje hierlangs door.
  if (typeof window !== 'undefined') {
    window.SJPEEL_SCAN = (tekst) => {
      toonView('scannen');
      verwerkScan(tekst).catch((fout) => meld(fout.message));
    };
  }
  await laadVersie();
  if (await startVanAdres()) return;
  const spel = herstel();
  if (spel) {
    staat.spel = spel;
    toonView('spel');
    renderBord();
    meld('Spel hersteld.');
    return;
  }
  toonView('start');
}

opstarten().catch((fout) => meld(`Kon niet opstarten: ${fout.message}`));
