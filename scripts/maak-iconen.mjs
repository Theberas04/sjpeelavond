#!/usr/bin/env node
/**
 * maak-iconen.mjs — tekent de app-iconen en de social card met de eigen Chromium.
 * Geen npm-afhankelijkheden: Chromium rendert de SVG's en schrijft de PNG's.
 *
 * Gebruik: node scripts/maak-iconen.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIEK = path.join(WORTEL, 'public');
const DOCS = path.join(WORTEL, 'docs', 'img');
const TUSSEN = path.join(WORTEL, '.iconen');
mkdirSync(TUSSEN, { recursive: true });
mkdirSync(DOCS, { recursive: true });

const CHROOM =
  process.env.CHROOM ||
  [
    path.join(process.env.HOME, '.hermes/tools/chromium-1248/chrome-linux64/chrome'),
    path.join(process.env.HOME, '.hermes/tools/chromium-1208/chrome-linux64/chrome'),
  ].find((p) => existsSync(p));
if (!CHROOM) {
  console.error('Geen Chromium gevonden. Zet CHROOM=/pad/naar/chrome in de omgeving.');
  process.exit(1);
}

const NOOT = `
  <g fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"><path d="M27 44V22l17-3.6v22"/></g>
  <circle cx="22" cy="45" r="6.4" fill="#fff"/><circle cx="39" cy="41.4" r="6.4" fill="#fff"/>
  <circle cx="47" cy="14" r="4.2" fill="#f0b23c"/>`;

const icoon = (maat, maskable) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${maat}px;height:${maat}px;background:${maskable ? 'linear-gradient(135deg,#e8324a,#8c1626)' : 'transparent'}}
svg{display:block;width:${maat}px;height:${maat}px}
</style></head><body>
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8324a"/><stop offset="1" stop-color="#8c1626"/></linearGradient></defs>
  ${maskable ? '<rect width="64" height="64" fill="url(#g)"/>' : `<rect width="64" height="64" rx="16" fill="url(#g)"/>`}
  <g transform="${maskable ? 'translate(32 32) scale(0.62) translate(-32 -32)' : ''}">${NOOT}</g>
</svg></body></html>`;

const social = `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:1280px;height:640px}
body{font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  background:radial-gradient(900px 460px at 88% -10%,rgba(232,50,74,.18),transparent 60%),
             radial-gradient(700px 380px at 2% 110%,rgba(46,163,242,.16),transparent 60%),#f4f7fb;
  color:#0f1c2b;display:flex;align-items:center;gap:56px;padding:64px 72px;box-sizing:border-box}
.logo{width:150px;height:150px;flex:none;filter:drop-shadow(0 18px 30px rgba(140,22,38,.35))}
h1{font-size:66px;margin:0;letter-spacing:-.03em;line-height:1}
p.sub{font-size:24px;color:#5b6b7f;margin:14px 0 0;max-width:640px}
.chips{display:flex;gap:10px;margin-top:26px;flex-wrap:wrap}
.chip{background:#fff;border:1px solid #dde5ef;border-radius:999px;padding:8px 16px;font-size:17px;font-weight:600;color:#1e73be}
.chip.rood{background:#fdeaec;border-color:#f6ccd2;color:#a5152a}
.chip.gael{background:#fdf3e3;border-color:#f3ddb8;color:#8a5a10}
</style></head><body>
<svg class="logo" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8324a"/><stop offset="1" stop-color="#8c1626"/></linearGradient></defs>
  <rect width="64" height="64" rx="16" fill="url(#g)"/>${NOOT}
</svg>
<div>
  <h1>Sjpeelavond</h1>
  <p class="sub">Drie muziekspellen in één app: leg de hit op de juiste plek in je tijdlijn, raoj mit de Limburgse klassiekers en test je vastelaoveskennis.</p>
  <div class="chips">
    <span class="chip">Tijdlijn · Hitster-stijl</span>
    <span class="chip rood">Raoj 's</span>
    <span class="chip gael">Hittepetit</span>
    <span class="chip">1.500+ nummers</span>
  </div>
</div></body></html>`;

function schiet(html, uit, breedte, hoogte, transparant = true) {
  const bron = path.join(TUSSEN, path.basename(uit).replace(/\.png$/, '.html'));
  writeFileSync(bron, html, 'utf8');
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${breedte},${hoogte}`,
    '--virtual-time-budget=2500',
    `--screenshot=${uit}`,
  ];
  if (transparant) args.push('--default-background-color=00000000');
  args.push(`file://${bron}`);
  const uitkomst = spawnSync(CHROOM, args, {
    env: { ...process.env, LD_LIBRARY_PATH: path.join(process.env.HOME, '.local/lib') },
    encoding: 'utf8',
  });
  const melding = `${uitkomst.stdout || ''}${uitkomst.stderr || ''}`;
  if (!existsSync(uit)) throw new Error(`Maken mislukt voor ${uit}: ${melding}`);
  console.log(`${path.relative(WORTEL, uit)} gemaakt`);
}

schiet(icoon(192, false), path.join(PUBLIEK, 'icon-192.png'), 192, 192);
schiet(icoon(512, false), path.join(PUBLIEK, 'icon-512.png'), 512, 512);
schiet(icoon(512, true), path.join(PUBLIEK, 'icon-512-maskable.png'), 512, 512, false);
schiet(icoon(180, false), path.join(PUBLIEK, 'apple-touch-icon.png'), 180, 180);
schiet(social, path.join(DOCS, 'social-card.png'), 1280, 640, false);
