/**
 * pool.js — welke nummers mogen er getrokken worden?
 *
 * De dekken (hits, limburg, vastelaovend, lvk, zittesj, nederland) kiezen de grote lijnen.
 * Daar bovenop kun je verfijnen: een jaarbereik, alleen de echte LVK-inzendingen, en niets
 * wat al eens eerder op tafel lag. Dat laatste houdt een avond fris: van 1.542 nummers hoor
 * je er anders steeds dezelfde terug.
 *
 * De server (server.js) en de app (public/js/lokaal.js) gebruiken allebei deze zeef, zodat
 * ze gegarandeerd hetzelfde antwoorden; test/app.test.js vergelijkt die twee antwoorden met
 * elkaar. Zonder Android- en zonder netwerkcode, dus met `node --test` na te rekenen.
 */

/** De grenzen van de dataset; buiten dit bereik valt er niets te kiezen. */
export const JAREN_MIN = 1960;
export const JAREN_MAX = new Date().getFullYear() + 1;

/**
 * Een zeef maken: welke van deze opties horen bij dit nummer?
 *
 * @param {object} [opties]
 * @param {string[]} [opties.dekken] dekken waar het nummer in moet zitten (leeg = maakt niet uit)
 * @param {number|null} [opties.jarenVan] vroegste jaar (meenemen)
 * @param {number|null} [opties.jarenTot] laatste jaar (meenemen)
 * @param {boolean} [opties.alleenLvkInzending] alleen nummers die echt een LVK-inzending waren
 * @param {boolean} [opties.nooitGespeeld] sla nummers over die al eens op tafel lagen
 * @param {(number|string)[]} [opties.gespeeld] de nummers die al eens geweest zijn
 * @returns {(nummer: object) => boolean}
 */
export function maakZeef(opties = {}) {
  const dekken = Array.isArray(opties.dekken) ? opties.dekken.filter(Boolean) : [];
  const van = getalOfNull(opties.jarenVan);
  const tot = getalOfNull(opties.jarenTot);
  const gespeeld = new Set(nummersUit(opties.gespeeld).filter((n) => Number.isFinite(n)));

  return (nummer) => {
    if (!nummer) return false;
    if (dekken.length) {
      const eigen = Array.isArray(nummer.dekken) ? nummer.dekken : [];
      if (!eigen.some((d) => dekken.includes(d))) return false;
    }
    const jaar = getalOfNull(nummer.jaar);
    if (van !== null && (jaar === null || jaar < van)) return false;
    if (tot !== null && (jaar === null || jaar > tot)) return false;
    // Alleen de echte inzendingen: `lvk === true`. Van veel nummers is het niet bekend
    // (`null`); die vallen hier dus af, en dat is precies de bedoeling van deze schakelaar.
    if (opties.alleenLvkInzending && nummer.lvk !== true) return false;
    if (opties.nooitGespeeld && gespeeld.has(Number(nummer.id))) return false;
    return true;
  };
}

/**
 * De kandidaten uit een lijst nummers, in de volgorde waarin ze aangeboden zijn.
 *
 * @param {Iterable<object>} nummers
 * @param {object} [opties] zoals bij {@link maakZeef}
 * @param {Iterable<number>} [opties.gebruikt] nummers die in dít potje al op tafel liggen
 * @returns {object[]}
 */
export function zeefPool(nummers, opties = {}) {
  const zeef = maakZeef(opties);
  const gebruikt = new Set(nummersUit(opties.gebruikt).filter((n) => Number.isFinite(n)));
  const uit = [];
  for (const nummer of nummers) {
    if (gebruikt.has(Number(nummer.id))) continue;
    if (zeef(nummer)) uit.push(nummer);
  }
  return uit;
}

/** Is er met deze instellingen iets te kiezen? Zo niet, dan zegt de app dat vooraf. */
export function filtersActief(opties = {}) {
  return Boolean(
    getalOfNull(opties.jarenVan) !== null ||
      getalOfNull(opties.jarenTot) !== null ||
      opties.alleenLvkInzending ||
      opties.nooitGespeeld,
  );
}

/** Een leesbare regel voor in de melding: "1990-2005 · alleen LVK-inzendingen". */
export function filterTekst(opties = {}) {
  const delen = [];
  const van = getalOfNull(opties.jarenVan);
  const tot = getalOfNull(opties.jarenTot);
  if (van !== null && tot !== null) delen.push(van === tot ? `${van}` : `${van}–${tot}`);
  else if (van !== null) delen.push(`vanaf ${van}`);
  else if (tot !== null) delen.push(`tot ${tot}`);
  if (opties.alleenLvkInzending) delen.push('alleen LVK-inzendingen');
  if (opties.nooitGespeeld) delen.push('niets van een eerdere keer');
  return delen.join(' · ');
}

/** Een lijst-met-nummers of een verzameling (de aanroepers gebruiken allebei) → nummers. */
function nummersUit(waarde) {
  if (!waarde) return [];
  return Array.from(waarde).map(Number);
}

function getalOfNull(waarde) {
  if (waarde === null || waarde === undefined || waarde === '') return null;
  const getal = Number(waarde);
  return Number.isFinite(getal) ? getal : null;
}

/**
 * De verfijning zoals die in een verzoek staat omzetten naar wat de zeef verwacht.
 *
 * Server en app gebruiken deze functie, zodat dezelfde vraag gegarandeerd hetzelfde
 * antwoord geeft; zo niet, dan valt dat bij de vergelijkingsproef door de mand.
 */
export function verfijningUit(lichaam = {}, dekken = [], gebruikt = []) {
  return {
    dekken,
    jarenVan: lichaam.jarenVan,
    jarenTot: lichaam.jarenTot,
    alleenLvkInzending: lichaam.alleenLvkInzending === true,
    nooitGespeeld: lichaam.nooitGespeeld === true,
    gespeeld: lichaam.gespeeld,
    gebruikt,
  };
}

/**
 * Wat de app zegt als er met deze instellingen niets overblijft. Met een filter erop is dat
 * iets anders dan een lege stapel: dan is het de verfijning die te streng staat.
 */
export function legeStapelTekst(verfijning) {
  return filtersActief(verfijning)
    ? `Met deze verfijning (${filterTekst(verfijning)}) blijft er niets over. Zet een filter uit of kies een ander dek.`
    : 'Deze dekstapel is leeg. Kies een ander dek of begin opnieuw.';
}
