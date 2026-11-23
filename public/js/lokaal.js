/**
 * lokaal.js — de spellogica in de pagina zelf.
 *
 * De webversie haalt alles bij de server (server.js). De Android-app heeft geen
 * server: daar zit de dataset in de app en doet deze module precies hetzelfde werk,
 * met dezelfde antwoorden, zodat de pagina er niets van merkt.
 *
 * De schil meldt zich via `window.Sjpeelavond`; zolang die er niet is (in de browser)
 * blijft de gewone fetch-route naar de server lopen.
 *
 * Twee externe diensten worden gebruikt voor het fragment: Deezer (het actuele
 * 30-secondenfragment) en iTunes als achtervang. Een browser mag die niet zomaar
 * aanroepen — Deezer stuurt geen CORS-kop mee — dus doet de schil het verzoek en
 * geeft het antwoord als tekst terug.
 */

import { losOp } from './kaart.js';
import { zeefPool, verfijningUit, legeStapelTekst } from './pool.js';

/**
 * Waar de buitenwereld om gevraagd mag worden: Deezer en iTunes voor het fragment, en
 * Spotify voor de titel, de artiest, het jaartal en het fragment van een gescand
 * kaartje (zie public/js/kaart.js).
 */
export const TOEGESTANE_GASTEN = ['api.deezer.com', 'itunes.apple.com', 'open.spotify.com'];

export function maakLokaleApi({ haalJson, brug = null, versie = '1.0.0' } = {}) {
  const nummers = new Map();
  const perDek = new Map();
  let index = { dekken: [], totalen: {} };
  let geladen = null;
  const fragmentCache = new Map();
  let laatsteBuitenfout = '';

  async function laad() {
    if (!geladen) {
      geladen = (async () => {
        index = (await haalJson('data/index.json')) || { dekken: [], totalen: {} };
        for (const bestand of ['data/nummers-hits.json', 'data/nummers-limburg.json']) {
          const inhoud = await haalJson(bestand);
          for (const nummer of inhoud?.nummers || []) {
            nummers.set(nummer.id, nummer);
            for (const dek of nummer.dekken || []) {
              if (!perDek.has(dek)) perDek.set(dek, []);
              perDek.get(dek).push(nummer.id);
            }
          }
        }
        if (!nummers.size) throw new Error('De muziekdatabase zit niet in deze app.');
        if (brug?.log) brug.log(`SJPEELAVOND_KLAAR nummers=${nummers.size} dekken=${(index.dekken || []).length}`);
      })();
    }
    return geladen;
  }

  /* ── buitenwereld ─────────────────────────────────────────────────────── */

  async function haalJsonBuiten(url) {
    const gastheer = (() => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    })();
    if (!TOEGESTANE_GASTEN.includes(gastheer)) return null;

    if (brug?.bron) {
      let antwoord = {};
      try {
        antwoord = JSON.parse(brug.bron(url) || '{}');
      } catch {
        antwoord = { ok: false, fout: 'onleesbaar antwoord van de schil' };
      }
      if (!antwoord.ok) {
        laatsteBuitenfout = antwoord.fout || 'geen antwoord';
        return null;
      }
      laatsteBuitenfout = '';
      try {
        return JSON.parse(antwoord.tekst);
      } catch {
        laatsteBuitenfout = 'onleesbaar antwoord';
        return null;
      }
    }

    // Terugval voor een omgeving zonder schil (bijvoorbeeld een proef in de browser).
    try {
      const antwoord = await fetch(url);
      if (!antwoord.ok) return null;
      laatsteBuitenfout = '';
      return await antwoord.json();
    } catch (fout) {
      laatsteBuitenfout = fout.message;
      return null;
    }
  }

  /**
   * Een adres als tekst ophalen — voor de Spotify-embedpagina van een gescand kaartje
   * (zie public/js/kaart.js). Alleen bij de gastheren die we toestaan, en in de app
   * doet de schil het verzoek omdat Spotify geen CORS-kop stuurt.
   */
  async function haalTekstBuiten(url) {
    const gastheer = (() => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    })();
    if (!TOEGESTANE_GASTEN.includes(gastheer)) throw new Error(`Deze app mag niets bij ${gastheer || 'dat adres'} ophalen.`);

    if (brug?.bron) {
      let antwoord = {};
      try {
        antwoord = JSON.parse(brug.bron(url) || '{}');
      } catch {
        antwoord = { ok: false, fout: 'onleesbaar antwoord van de schil' };
      }
      if (!antwoord.ok) throw new Error(antwoord.fout || `Geen antwoord van ${gastheer}`);
      return antwoord.tekst || '';
    }

    const antwoord = await fetch(url);
    if (!antwoord.ok) throw new Error(`${gastheer} antwoordde ${antwoord.status}`);
    return antwoord.text();
  }

  async function haalFragment(nummer) {
    if (!nummer || !nummer.deezerId) return null;
    const nu = Date.now();
    const bewaard = fragmentCache.get(nummer.deezerId);
    if (bewaard && bewaard.verloopt > nu) return bewaard.url;

    const viaDeezer = await haalJsonBuiten(`https://api.deezer.com/track/${nummer.deezerId}`);
    if (viaDeezer?.preview) {
      fragmentCache.set(nummer.deezerId, { url: viaDeezer.preview, verloopt: nu + 20 * 60 * 1000 });
      if (brug?.log) brug.log(`SJPEELAVOND_FRAGMENT deezer ${nummer.titel}`);
      return viaDeezer.preview;
    }

    const term = encodeURIComponent(`${nummer.titel} ${nummer.artiest}`);
    const viaItunes = await haalJsonBuiten(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`);
    const treffer = (viaItunes?.results || []).find((r) => r.previewUrl);
    if (treffer) {
      fragmentCache.set(nummer.deezerId, { url: treffer.previewUrl, verloopt: nu + 24 * 3600 * 1000 });
      if (brug?.log) brug.log(`SJPEELAVOND_FRAGMENT itunes ${nummer.titel}`);
      return treffer.previewUrl;
    }
    if (brug?.log) brug.log(`SJPEELAVOND_FRAGMENT mislukt ${laatsteBuitenfout || 'geen fragment'}`);
    return null;
  }

  /* ── de routes, precies zoals de server ze beantwoordt ────────────────── */

  async function verzoek(pad, lichaam = null) {
    await laad();
    const [route, query] = String(pad).split('?');
    const params = new URLSearchParams(query || '');
    const fout = (bericht) => {
      throw new Error(bericht);
    };

    if (route === '/api/versie') {
      // `eigen: 0` staat er net als bij de server: in de app zijn er geen eigen nummers.
      return { versie, naam: 'Sjpeelavond', totalen: { ...(index.totalen || {}), eigen: 0 }, dekken: index.dekken || [] };
    }

    if (route === '/api/dekken') {
      return { dekken: (index.dekken || []).map((d) => ({ ...d, aantal: (perDek.get(d.id) || []).length })) };
    }

    if (route === '/api/pool') {
      const dekken = Array.isArray(lichaam?.dekken) && lichaam.dekken.length ? lichaam.dekken : ['hits'];
      const verfijning = verfijningUit(lichaam || {}, dekken, lichaam?.gebruikt || []);
      return { aantal: zeefPool(nummers.values(), verfijning).length };
    }

    if (route === '/api/trek') {
      const dekken = Array.isArray(lichaam?.dekken) && lichaam.dekken.length ? lichaam.dekken : ['hits'];
      const gebruikt = new Set((lichaam?.gebruikt || []).map(Number));
      const aantal = Math.max(1, Math.min(20, parseInt(lichaam?.aantal, 10) || 1));
      // Dezelfde zeef als de server (public/js/pool.js).
      const verfijning = verfijningUit(lichaam || {}, dekken, gebruikt);
      const pool = zeefPool(nummers.values(), verfijning).map((n) => n.id);
      if (!pool.length) fout(legeStapelTekst(verfijning));
      const kaarten = [];
      for (let i = 0; i < aantal && pool.length; i++) {
        const k = Math.floor(Math.random() * pool.length);
        kaarten.push({ id: pool[k] });
        pool.splice(k, 1);
      }
      return { kaarten, resterend: pool.length };
    }

    if (route === '/api/onthul') {
      const kaarten = (lichaam?.ids || [])
        .map((id) => nummers.get(Number(id)))
        .filter(Boolean)
        .map((n) => ({
          id: n.id,
          titel: n.titel,
          artiest: n.artiest,
          jaar: n.jaar,
          jaarBron: n.jaarBron || null,
          album: n.album || null,
          hoes: n.hoes || null,
          soort: n.soort || null,
          lvk: typeof n.lvk === 'boolean' ? n.lvk : null,
          regio: n.regio || null,
          eigen: Boolean(n.eigen),
        }));
      return { kaarten };
    }

    if (route === '/api/hint') {
      const nummer = nummers.get(Number(lichaam?.id));
      if (!nummer) fout('Onbekend nummer');
      return { decennium: Math.floor(nummer.jaar / 10) * 10 };
    }

    if (route === '/api/fragment') {
      const nummer = nummers.get(Number(params.get('id')));
      if (!nummer) fout('Onbekend nummer');
      const bron = await haalFragment(nummer);
      if (!bron) {
        fout(
          laatsteBuitenfout
            ? `Geen fragment op te halen (${laatsteBuitenfout}). Heb je internet?`
            : 'Geen fragment beschikbaar voor dit nummer',
        );
      }
      return { url: bron, duur: 30 };
    }

    if (route === '/api/nummers') {
      const dek = params.get('dek') || 'hits';
      const zoek = (params.get('zoek') || '').toLowerCase().trim();
      const limiet = Math.min(500, parseInt(params.get('limiet'), 10) || 100);
      const vanaf = Math.max(0, parseInt(params.get('vanaf'), 10) || 0);
      let lijst = (perDek.get(dek) || []).map((id) => nummers.get(id)).filter(Boolean);
      if (zoek) lijst = lijst.filter((n) => `${n.titel} ${n.artiest} ${n.album || ''}`.toLowerCase().includes(zoek));
      lijst.sort((a, b) => a.jaar - b.jaar || a.artiest.localeCompare(b.artiest, 'nl'));
      const pagina = lijst.slice(vanaf, vanaf + limiet).map((n) => ({
        id: n.id,
        titel: n.titel,
        artiest: n.artiest,
        jaar: n.jaar,
        album: n.album || null,
        hoes: n.hoes || null,
        soort: n.soort || null,
        lvk: typeof n.lvk === 'boolean' ? n.lvk : null,
      }));
      return { totaal: lijst.length, vanaf, limiet, nummers: pagina };
    }

    // De kaartjes van de fysieke spellen: dezelfde tabel en dezelfde uitleg als de
    // server, maar uit de app zelf (data/hitster.json zit in de bundel).
    if (route === '/api/hitster' || route === '/api/kaart') {
      const tabel = await haalJson('data/hitster.json');
      if (!tabel || !tabel.kaarten) fout('De kaartjestabel zit niet in deze app.');
      if (route === '/api/hitster') return tabel;
      return losOp(String(lichaam?.code || ''), { tabel, haalTekst: haalTekstBuiten });
    }

    // Beheer hoort bij de serverversie: in de app zit geen database en geen wachtwoord.
    if (route === '/api/beheer/status') return { ingesteld: false, ingelogd: false };
    if (route.startsWith('/api/beheer')) {
      fout('Eigen nummers horen bij de serverversie van Sjpeelavond.');
    }

    fout(`Onbekende route: ${route}`);
  }

  return { verzoek, laad, aantalNummers: () => nummers.size };
}

/* ── aanmelden bij de schil ─────────────────────────────────────────────── */

if (typeof window !== 'undefined') {
  const schil = window.Sjpeelavond;
  const isLokaal = schil && typeof schil.lokaal === 'function' && schil.lokaal() === 'ja';
  if (isLokaal) {
    const api = maakLokaleApi({
      haalJson: async (pad) => {
        const antwoord = await fetch(pad, { cache: 'no-store' });
        if (!antwoord.ok) throw new Error(`Kon ${pad} niet lezen (${antwoord.status})`);
        return antwoord.json();
      },
      brug: schil,
      versie: typeof schil.versie === 'function' ? schil.versie() : '1.0.0',
    });
    window.SJPEEL_LOKAAL = (pad, lichaam, extra) => api.verzoek(pad, lichaam, extra);
    if (typeof schil.log === 'function') schil.log('SJPEELAVOND_SCHIL lokaal=ja');
  }
}
