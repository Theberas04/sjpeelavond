/**
 * update.js — kijken of er een nieuwere versie van de app is.
 *
 * De app meldt het zelf: bij het opstarten vraagt hij bij GitHub welke uitgave de laatste
 * is (dat is een openbaar adres, geen sleutel nodig) en vergelijkt dat met zijn eigen
 * versienummer. Is die nieuwer, dan komt er een balkje op het startscherm met een knop
 * naar de nieuwe APK.
 *
 * Zonder internet of met een fout antwoord blijft het stil: dit mag het spel nooit in de
 * weg zitten. Er wordt ook niets vanzelf geïnstalleerd — Android laat dat alleen toe als
 * de gebruiker het zelf bevestigt, dus het blijft bij melden en een link.
 */

/** De laatste uitgave van de app op GitHub. */
export const UITGAVE_ADRES = 'https://api.github.com/repos/Theberas04/sjpeelavond/releases/latest';
/** Waar alle uitgaven staan (valt terug op deze pagina als er geen APK in de uitgave zit). */
export const UITGAVEN_PAGINA = 'https://github.com/Theberas04/sjpeelavond/releases/latest';

/** Versienummers vergelijken: -1 als a ouder is dan b, 0 gelijk, 1 nieuwer. */
export function vergelijkVersies(a, b) {
  const deel = (v) =>
    String(v ?? '')
      .replace(/^v/i, '')
      .trim()
      .split('.')
      .map((stuk) => Number.parseInt(stuk, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const links = deel(a);
  const rechts = deel(b);
  const lengte = Math.max(links.length, rechts.length);
  for (let i = 0; i < lengte; i++) {
    const x = links[i] || 0;
    const y = rechts[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Het antwoord van GitHub omzetten in iets waar de app iets mee kan. */
export function leesUitgave(gegevens) {
  const versie = String(gegevens?.tag_name || gegevens?.name || '')
    .replace(/^v/i, '')
    .trim();
  if (!/^\d+(\.\d+)*$/.test(versie)) return null;
  const apk = (gegevens.assets || []).find(
    (a) => /\.apk$/i.test(String(a?.name || '')) && !/-debug\.apk$/i.test(String(a?.name || '')),
  );
  return {
    versie,
    url: apk?.browser_download_url || gegevens.html_url || UITGAVEN_PAGINA,
    pagina: gegevens.html_url || UITGAVEN_PAGINA,
    notities: String(gegevens.body || '')
      .split('\n')
      .map((regel) => regel.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' ')
      .slice(0, 240),
  };
}

/**
 * Kijkt of er iets nieuwers is. Geeft null als de app bij is, als er geen internet is of
 * als het antwoord niet te lezen valt — dan is er niets te melden.
 *
 * `haalTekst` haalt het adres op (in de app en de browser gewoon fetch), zodat dit met
 * een test na te rekenen is zonder netwerk.
 */
export async function kijkVoorUpdate({ huidig, haalTekst, adres = UITGAVE_ADRES } = {}) {
  if (!huidig) return null;
  try {
    const uitgave = leesUitgave(JSON.parse(await haalTekst(adres)));
    if (!uitgave) return null;
    return vergelijkVersies(uitgave.versie, huidig) > 0 ? uitgave : null;
  } catch {
    return null;
  }
}
