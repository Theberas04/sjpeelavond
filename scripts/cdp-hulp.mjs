/**
 * cdp-hulp.mjs — klein CDP-hulpje voor het maken van schermafbeeldingen en de demo-opname.
 * Geen npm: Node 22 heeft een eigen WebSocket, en de gebundelde Chromium starten we zelf.
 *
 * De klik hieronder stuurt echte pointergebeurtenissen (met een zichtbare cursor) en
 * daarna een echte click, zodat de handlers van de app zelf lopen.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

export function chromepad() {
  const kandidaten = [
    process.env.CHROOM,
    path.join(process.env.HOME, '.hermes/tools/chromium-1248/chrome-linux64/chrome'),
    path.join(process.env.HOME, '.hermes/tools/chromium-1208/chrome-linux64/chrome'),
  ].filter(Boolean);
  const gevonden = kandidaten.find((p) => existsSync(p));
  if (!gevonden) throw new Error('Geen Chromium gevonden; zet CHROOM=/pad/naar/chrome.');
  return gevonden;
}

/** Start Chromium met een eigen profiel en een zelfgekozen debug-poort. */
export async function startBrowser({ profiel, breedte = 1440, hoogte = 900, extra = [] } = {}) {
  const map = profiel || path.join('/tmp', `sjpeelavond-profiel-${Date.now()}`);
  mkdirSync(map, { recursive: true });
  const chrome = spawn(
    chromepad(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=0',
      `--user-data-dir=${map}`,
      `--window-size=${breedte},${hoogte}`,
      ...extra,
      'about:blank',
    ],
    {
      env: { ...process.env, LD_LIBRARY_PATH: path.join(process.env.HOME, '.local/lib') },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  const poortbestand = path.join(map, 'DevToolsActivePort');
  let poort = null;
  for (let i = 0; i < 120; i++) {
    if (existsSync(poortbestand)) {
      poort = readFileSync(poortbestand, 'utf8').split('\n')[0].trim();
      if (poort) break;
    }
    await wacht(120);
  }
  if (!poort) {
    chrome.kill('SIGKILL');
    throw new Error('Chromium kwam niet op (geen DevToolsActivePort).');
  }
  for (let i = 0; i < 60; i++) {
    try {
      const lijst = await (await fetch(`http://127.0.0.1:${poort}/json/list`)).json();
      const pagina = lijst.find((t) => t.type === 'page');
      if (pagina) return { chrome, poort, doel: pagina.webSocketDebuggerUrl, profiel: map };
    } catch {}
    await wacht(150);
  }
  chrome.kill('SIGKILL');
  throw new Error('Chromium heeft geen pagina aangemeld.');
}

/** Verbindt met de pagina en geeft een klein clientje terug. */
export async function verbind(doelUrl) {
  const ws = new WebSocket(doelUrl);
  // Zonder tijdslimiet blijft een WebSocket die niet opent eeuwig wachten.
  await new Promise((los, af) => {
    const klok = setTimeout(() => af(new Error('WebSocket naar Chromium opende niet binnen 15 seconden.')), 15000);
    ws.onopen = () => {
      clearTimeout(klok);
      los();
    };
    ws.onerror = (fout) => {
      clearTimeout(klok);
      af(fout);
    };
  });
  let teller = 0;
  const wachtenden = new Map();
  ws.onmessage = (gebeurtenis) => {
    const bericht = JSON.parse(gebeurtenis.data);
    if (bericht.id && wachtenden.has(bericht.id)) {
      wachtenden.get(bericht.id)(bericht);
      wachtenden.delete(bericht.id);
    }
  };
  // Elke oproep krijgt een tijdslimiet: een pagina die midden in een opname herlaadt
  // laat Chromium het antwoord op een schermafbeelding vallen, en zonder limiet blijft
  // zo'n verzoek eeuwig hangen (de opnamelus staat dan stil zonder één foutmelding).
  const stuur = (method, params = {}, { timeout = 10000 } = {}) =>
    new Promise((los, af) => {
      const id = ++teller;
      const klok = setTimeout(() => {
        wachtenden.delete(id);
        af(new Error(`CDP ${method} antwoordde niet binnen ${timeout} ms`));
      }, timeout);
      wachtenden.set(id, (bericht) => {
        clearTimeout(klok);
        los(bericht);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (uitdrukking) => {
    const antwoord = await stuur('Runtime.evaluate', { expression: uitdrukking, returnByValue: true, awaitPromise: true });
    if (antwoord.result?.exceptionDetails) {
      const fout = antwoord.result.exceptionDetails;
      throw new Error(`JS-fout: ${fout.text} ${fout.exception?.description || ''}`);
    }
    return antwoord.result?.result?.value;
  };
  return { ws, stuur, js };
}

export const CURSOR = `
(() => {
  if (document.getElementById('__cursor')) return true;
  const c = document.createElement('div');
  c.id = '__cursor';
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;'
    + 'background:rgba(15,28,43,.85);border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.45);z-index:99999;'
    + 'pointer-events:none;transition:transform .22s ease;transform:translate(-100px,-100px)';
  document.body.appendChild(c);
  return true;
})()`;

/** Beweegt de cursor naar het element en klikt het echt aan. */
export async function klik(js, kies, { vertraging = 260, dubbel = false } = {}) {
  const gevonden = await js(`(() => {
    const el = document.querySelector(${JSON.stringify(kies)});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, tekst: (el.innerText || el.value || '').slice(0, 40), buiten: b.bottom < 0 || b.top > innerHeight };
  })()`);
  if (!gevonden) throw new Error(`Element niet gevonden: ${kies}`);
  if (gevonden.buiten) {
    await js(`document.querySelector(${JSON.stringify(kies)}).scrollIntoView({block:'center'})`);
    await wacht(320);
  }
  await js(`${CURSOR}; (() => { const el = document.querySelector(${JSON.stringify(kies)}); const b = el.getBoundingClientRect();
    const c = document.getElementById('__cursor'); c.style.transform = 'translate(' + (b.left + b.width/2) + 'px,' + (b.top + b.height/2) + 'px)'; return true; })()`);
  await wacht(vertraging);
  const raak = await js(`(() => {
    const el = document.querySelector(${JSON.stringify(kies)});
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const doel = document.elementFromPoint(x, y);
    const maak = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 });
    el.dispatchEvent(maak('pointerdown'));
    el.dispatchEvent(maak('pointerup'));
    if (el.click) el.click();
    return (doel ? doel.tagName + '.' + String(doel.className).slice(0, 30) : 'niets') + ' | ' + (el.innerText || '').slice(0, 24);
  })()`);
  if (dubbel) await klik(js, kies, { vertraging });
  return raak;
}

export async function schermafbeelding(stuur, bestand, { kwaliteit = null } = {}) {
  const opties = kwaliteit ? { format: 'jpeg', quality: kwaliteit, fromSurface: true } : { format: 'png' };
  const antwoord = await stuur('Page.captureScreenshot', opties);
  mkdirSync(path.dirname(bestand), { recursive: true });
  const buffer = Buffer.from(antwoord.result.data, 'base64');
  writeFileSync(bestand, buffer);
  return buffer.length;
}

export const tel = (js, kies) => js(`document.querySelectorAll(${JSON.stringify(kies)}).length`);
