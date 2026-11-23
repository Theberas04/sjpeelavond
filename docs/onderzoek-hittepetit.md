# Onderzoek: koppeling kaartnummer → liedje voor Hittepetit (HP0001–HP0222)

Datum: 23 november 2026. Alle onderstaande bevindingen zijn met echte HTTP-verzoeken
nagegaan; waar iets onzeker is staat dat expliciet vermeld. Er is niets verzonnen.

Doel: de koppeling **kaartnummer (HP0001..HP0222) → liedje (titel + artiest + jaartal)**
vinden, of een **publiek eindpunt** waarmee een eigen app het liedje bij een kaartnummer
kan opzoeken.

## Kort antwoord

- **Er is GEEN publiek eindpunt en GEEN publieke kaartnummer→liedje-lijst gevonden.**
- De webkant van `hittepetit.radiononnevot.nl` kent alleen twee routes: `/q/<code>` (een
  QR-omleiding) en `/media/<id>` (dat voor een *geldige* kaart de **Apple App Store-pagina**
  teruggeeft, niet audio). Er is geen JS-bundel, geen JSON, geen API.
- Het fragment/liedje zit volledig achter de **Radio Nónnevot-app**. De APK van
  `com.radiononnevot` is **niet publiek te downloaden** (alle geprobeerde spiegels falen of
  leveren alleen een verouderde versie zonder Hittepetit). De app-binary kon dus niet worden
  uitgelezen.
- **Wel** gevonden: een **deelverzameling liedjes** (titel/artiest/jaartal) dat leesbaar is op
  foto's van kaartachterkanten (pers/shop). Zie §5. Deze zijn **niet** aan kaartnummers te
  koppelen met openbare bronnen.
- **Beste aanwijzing voor de nummering:** elke kaartachterkant heeft in een hoek een **klein
  3-cijferig nummer** (ik las o.a. 129, 139, 204) naast een plaatslabel (Zittard/Munster/
  Hulsberg). Die nummers vallen binnen 1..222 — dus waarschijnlijk is het kaartnummer
  *N* gelijk aan de QR-code `HP0<NNN>`. Dit is een **vermoeden, niet bevestigd** (geen enkele
  foto toont nummer én QR van dezelfde kaart, en `/media/HP…` levert geen data op om te
  verifiëren).

---

## 1. Website `hittepetit.radiononnevot.nl`

### 1a. Routes (alles echt opgehaald)

| Verzoek | Status | Letterlijke respons |
|---|---|---|
| `GET /q/HP0132` | **302** | `location: https://app.radiononnevot.nl` (body leeg). Idem voor HP0001, HP0222, HP0132, HP0186, HP0031, HP0202 |
| `GET /q/HP0223` | 404 | `text/plain` — `QR-code niet gevonden.` (22 bytes) |
| `GET /q/HP0000` | 200 | HTML-spelerpagina (833 bytes) met titel "Hittepetit" en `<audio controls autoplay preload="metadata" … src="/media/HP0000">` |
| `GET /q/xyz` | 404 | `text/plain` — `Hittepetit` (10 bytes) |
| `GET /` | 404 | `text/plain` — `Hittepetit` (10 bytes) |
| `GET /media/HP0132` | **200** | `content-type: text/html`, **508.550 bytes** = de **Apple App Store-pagina** van de Radio Nónnevot-app (Apple-"daiquiri"-headers, `x-apple-*`, `content-disposition: inline`). Idem voor HP0222. **Geen audio.** |
| `GET /media/HP0000` | 404 | Apache-standaard 404 (`<!DOCTYPE HTML … 404 Not Found>`, 315 bytes, iso-8859-1) |
| `GET /media/HP0999`, `/media/HP0223`, `/media/HP9999` | 404 | `Media niet gevonden.` (20 bytes) |
| `GET /media/random` | 404 | `Hittepetit` (10 bytes) |
| `OPTIONS /q/HP0132` | 405 | `allow: GET` |

`/media/HP0132` blijft **altijd** de App Store-HTML teruggeven, ongeacht:
- `Accept: audio/*` / `application/json` / `audio/mpeg` → 200 `text/html` 508.550 bytes
- `User-Agent` (okhttp, Dalvik, Android-WebView, Dart/Flutter, mobiel) → idem
- `Referer: …/q/HP0132`, `X-Requested-With: com.radiononnevot` → idem
- `Range: bytes=0-100` → 206 maar `content-type: text/html` (dus geen mediabestand)
- query-varianten `?t=1`, `?v=1`, `?dl=1`, `?type=audio` → idem
- lowercase `hp0132` → idem

**Conclusie 1a:** de enige publieke functie van de site is het omzetten van een kaartcode
naar de App Store (deep link). De *webspeler* op `/q/HP0000` verwijst naar `/media/HP0000`,
maar die route bestaat niet (404). Voor echte kaarten wordt `/media/HP<nnnn>` door de server
vervangen door de App Store-pagina. **Er is geen publieke audio-URL.**

### 1b. Geen JS/CSS-bundel, geen API, geen JSON

- Er is geen `<script src>` of CSS-bundel; de server levert alleen de hierboven beschreven
  HTML (geen SPA).
- Uitgebreide route-fuzz (alle → **404** `text/plain`): `/api`, `/api/`, `/api/cards`,
  `/api/songs`, `/api/card/HP0132`, `/api/HP0132`, `/api/q/HP0132`, `/api/media/HP0132`,
  `/cards`, `/songs`, `/list.json`, `/cards.json`, `/songs.json`, `/hittepetit.json`,
  `/data`, `/db.json`, `/HP0132.json`, `/song/HP0132`, `/songs/HP0132`, `/card/HP0132`,
  `/play/HP0132`, `/info/HP0132`, `/m/HP0132`, `/c/HP0132`, `/k/HP0132`, `/s/HP0132`,
  `/audio/HP0132`, `/fragment/HP0132`, `/stream`, `/m3u`, `/playlist`, `/json`, `/api/health`,
  `/health`, `/status`, `/version`, `/kaarten`, `/liedjes`, `/api/liedjes`, `/media/HP0132.mp3`,
  `/media/HP0132/mp3`, enz.
- `/q/HP0132.json`, `/q/HP0132/?format=json`, Accept-negotiatie → altijd dezelfde 302.

**Conclusie 1b:** geen publiek API-eindpunt.

---

## 2. `app.radiononnevot.nl`

| Verzoek | Resultaat |
|---|---|
| `GET https://app.radiononnevot.nl/` | **301** → `https://radiononnevot.nl/app` |
| `GET https://radiononnevot.nl/app` | **301** → `https://apps.apple.com/nl/app/radio-n%C3%B3nnevot/id1636814985` |
| `GET https://app.radiononnevot.nl/index.html` | 200, **"This is the default server vhost"** (SiteGround hosting, domein niet gekoppeld) |
| `GET /api`, `/api/`, `/health`, `/hittepetit`, `/cards`, `/q/HP0132`, `/media/HP0132`, `/version`, `/app`, `/player` | 404 (93 bytes, `text/html`) |

`app.radiononnevot.nl` is dus puur een **doorverwijzing naar de App Store** (via een Cloudflare
redirect + een niet-geconfigureerde SiteGround-vhost). Geen app-API op dit domein.

> Anomalie (eenmalig, niet reproduceerbaar): bij één van de eerste verzoeken aan
> `app.radiononnevot.nl` (met `curl -L`) kwam de **Meteor-shell van de Raoj's-webapp** terug
> (`<title>Raoj's - Spelen</title>`, 2.778 bytes). Herhaalde verzoeken en de response-headers
> geven consistent de 301→App Store-keten. Dit lijkt een stale edge/origin-cache; verder geen
> aanwijzing dat de Hittepetit-app hiermee te maken heeft.

---

## 3. DNS / subdomeinen / backend-verkenning

- `crt.sh` (certificaat-transparantie) gaf **502 Bad Gateway** (meermaals geprobeerd).
- Wayback Machine: **geen** opnames van `hittepetit.radiononnevot.nl/*` (cdx leeg).
- Resolutie:
  - `radiononnevot.nl`, `www`, `app`, `hittepetit`, `stream` → Cloudflare (104.21.88.65 /
    172.67.173.160).
  - `media.radiononnevot.nl` → **37.97.134.249** (Apache/2, buiten Cloudflare). Alles 403/404
    (geen listing), ook `Host: hittepetit.radiononnevot.nl` direct op dit IP → 404. Niet de
    Hittepetit-origin.
  - Brute-force veelvoorkomende subdomeinen: **geen** `api.`/`cdn.`/`data.`/`static.` e.d.
- **`stream.radiononnevot.nl` = AzuraCast** (open-source webradio):
  - `/api` → 302 → `/docs/api/` (Swagger UI, "AzuraCast Local Docs")
  - `/api/stations` → station **id 2 "Gaaas!!! Radio"** (`vastelaovend_-_carnaval`); de
    Radio Nónnevot-stream zelf verwijst door naar `https://media.hostin.live/audio/radio-nonnevot.aac`
  - `/api/station/1/...` → 404 / 403; playlists/files vereisen login; `/api/nowplaying` toont
    "Gaaas!!! Radio" (nu: "rataratarata sjeng - wir sind spitse ft. theunisz").
  - **Dit is de radio-infra, niet de Hittepetit-backend** (geen Hittepetit-station, geen
    kaart-API).
- `media.hostin.live` = Next.js streamingprovider (307 → `media-edge3.hostin.live`); `/hittepetit/...`
  → 404.

**Conclusie 3:** de Hittepetit-origin zit achter Cloudflare en is niet publiek te benaderen;
geen publieke API-host gevonden.

---

## 4. Android-app `com.radiononnevot` (Radio Nónnevot / Ermeco) — APK NIET te pakken

- Play Store bevestigt de functie: *"Sjpeel noe ouch Hittepetit via Radio Nónnevot! Scan de
  kaart en rao de meziek oet Zitterd en 't bèste oet Limburg."* Versies: iOS **5.0**
  (itunes lookup id=1636814985), Android **5.1.0**.
- **Alle downloadpogingen gefaald** (per bron de letterlijke uitkomst):
  - **APKPure**: pagina bestaat (`https://apkpure.com/radio-n%C3%B3nnevot/com.radiononnevot`),
    maar download → `302` naar `/apk-downloader?p=com.radiononnevot` (JS-only).
    `https://d.apkpure.com/b/APK/com.radiononnevot?version=1.1.1` → **403** (redirect naar
    apkpure.com). `d.apkpure.net` idem **403**. `tapi.pureapk.com/v3/get_app_his_version` →
    `{"retcode":0,"errmsg":"success","version_list":[]}` (geen versies). APKPure vermeldt alleen
    een **oude versie 1.1.1 (14 nov 2024)** — die is van vóór Hittepetit.
  - **APKCombo**: geen vermelding. `apkcombo.com/search/com.radiononnevot` en directe URL's
    (`/radio-nonnevot/com.radiononnevot/`, `/…/download/apk`) → **404**.
  - **APKFab** → 403; **APKMirror** → 403 (Cloudflare); **apk.support**, **apkmonk.com** →
    lossen niet op (DNS); **apkaward**, **apksos**, **apkhere**, **apk.tools**, **apkdl.io** →
    404/503; **uptodown** → 404.
  - **Aptoide API** (`ws75.aptoide.com/api/7/app/getMeta?package_name=com.radiononnevot`) →
    `{"status":"FAIL"…"Application 'package:com.radiononnevot' not found"}`.
- Oude app `nl.radiononnevot.radio` (v2.4, 2023) is **verwijderd van Google Play** (26-09-2024).
- **Gevolg:** de APK kon niet worden uitgepakt; assets/dex zijn niet te doorzoeken op `HP0` of
  `hittepetit`. Daarmee is de interne scan-/afspeellogica en een eventuele ingebakken
  liedjeslijst niet in te zien.

---

## 5. Openbare bronnen met liedjes (kaartachterkanten) — DEELS

Op foto's van het spel zijn kaartachterkanten leesbaar (titel / jaartal / artiest), met in een
hoek een **klein 3-cijferig nummer** en een **plaatslabel**. Gevonden (letterlijk gelezen;
spelling in Sittards dialect, dus soms onzeker):

**Bron A — L1-persfoto** `https://i.regiogroei.cloud/4eca0096-3eb7-3757-b3b1-669424989eda.jpg`
(gerelateerd aan `https://www.l1nieuws.nl/entertainment/3272141/van-nonnevot-tot-muziekspel-radio-nonnevot-komt-met-hittepetit`):

| Titel | Jaartal | Artiest | Hoeknummer | Plaatslabel |
|---|---|---|---|---|
| Alle Romme Los | 1995 | Jan van Daal | ± 129 | Zittard |
| Neet te Geluive | 2017 | Marleen Rutten | ± 139 | Munster |
| Rap d'r Achteraan! | 2021 | Zoes | ± 204 | Hulsberg |
| Oppe Fits | 1993 | Anja Bovendeaard | ± 12? | Zittard |

(De hoeknummers 129/139/204 zijn leesbaar maar niet 100% zeker; het zijn de enige kandidaten
voor "kaartnummer". Ze liggen alle binnen 1..222.)

**Bron B — Marotte-shop productfoto** `https://marotte.nl/wp-content/uploads/hittepetit-spel-op-tafel.jpg`
(en `…/hittepetit-spelavond-met-doos.jpg`), spel op tafel met veel kaarten:

| Titel | Jaartal | Artiest |
|---|---|---|
| Op Gooze Wai | 1977 | Chris Mips, Thei Hunnekens |
| Waer Vieve in Os (Sjtedele Vastelaoveswereld) | 1977 | Jeanne Borghmans-Pierrings |
| D'n Droum van Sinterklaos | 1981 | (onduidelijk, "Coby …") |
| Poetsj … oet de tied | 2006 | (onduidelijk) |
| Sjtaatsmeidje(s) | 2010 | (onduidelijk) |
| Dus dat! | 2019 | (onduidelijk) |
| Louf … | 2021 | (onduidelijk) |
| Neet te Geluive | 2017 | Marleen Rutten (ook hier zichtbaar) |
| (verder zichtbaar maar onleesbaar) | 2018, 2020, 2026, 2014, 2003, 2022 … | — |

**Bron C — app-screenshots** (Play/App Store): de afspeelweergave toont o.a.
**"Ich Aom Zitterd" – Nigel & Luc (2024)** en de radiospeler "Veer zeen Zitterd – Gein haor baer …".
Deze tonen de radio-/speler-UI, niet de scan-kaart met nummerkoppeling.

**Bron D — pers/tekst:** L1 (`l1nieuws.nl`), `sittard-geleen.nieuws.nl`, `nieuwskoerier.nl`,
`marotte.nl/radio-nonnevot-presenteert-…` bevestigen: **222 kaartjes**, "ongeveer 65% muziek uit
Sittard, de rest uit Limburg (o.a. LVK-liedjes)". Geen enkele bron publiceert een liedjeslijst
of kaartnummer-tabel.

**Conclusie 5:** er is een **deelverzameling** liedjes (titel/artiest/jaartal) publiek
beschikbaar via foto's, maar **geen volledige lijst** en **geen koppeling aan de HP-nummers**.

---

## 6. Heeft iemand anders dit al uitgezocht?

- Geen resultaten op GitHub/Reddit/fora over het kraken/koppelen van Hittepetit-kaartnummers.
  (Er zijn wél tal van generieke "Hitster-kaarten maken"-projecten — `rrooij/HitGuess`,
  `fjlein/hitster`, `JonasScholl/hitster`, `ruuda/hitsgame` — maar die gaan niet over Hittepetit.)

---

## 7. Kan een eigen app het liedje bij een kaartnummer opzoeken?

- **Wat publiek reproduceerbaar is:** de QR scannen → kaartcode **`HP<nnnn>`** met
  **nnnn ∈ 0001..0222** (HP0001–HP0222 geldig, HP0223 → 404). Verder niets.
- **Wat NIET publiek is:**
  - het **liedje** bij een kaartnummer (titel/artiest/jaartal), en
  - de **audio/fragment-URL** (`/media/HP<nnnn>` geeft de App Store-pagina, geen mp3),
  - en er is **geen JSON/API**, **geen publieke liedjeslijst** en **geen downloadbare APK**.
- **Praktische consequentie voor Sjpeelavond:** uit openbare bronnen kan de koppeling
  kaartnummer→liedje **niet** worden nagebouwd. Het beste dat beschikbaar is, is de
  deelverzameling kaartachterkanten uit §5 (zonder zekere nummerkoppeling).

### Aanknopingspunten (indien alsnog gewenst)
1. **APK alsnog bemachtigen** (bv. via een apparaat met Hittepetit-app + APK-extractie) en
   `assets/` + dex doorzoeken op `HP0`/`hittepetit` en op API-URL's. Dit is de meest
   kansrijke route; via publieke spiegels lukt het niet.
2. **Fysieke kaartjes fotograferen** (voor- én achterkant per kaart) om de koppeling
   nummer↔HP en de liedjeslijst op te bouwen. Met ~15 leesbare kaarten uit pers/shop kom je
   niet in de buurt van 222.
3. **De officiële API achterhalen** (bv. met een MITM-proxy op het toestel) — de app praat
   vrijwel zeker met een niet-publiek eindpunt; dat eindpunt is via openbare bronnen niet
   gevonden.

---

## Alle daadwerkelijk opgehaalde URL's (met resultaat)

- `https://hittepetit.radiononnevot.nl/q/HP0132` → 302 → `https://app.radiononnevot.nl`
- `https://hittepetit.radiononnevot.nl/q/HP0000` → 200 (HTML-speler, `src="/media/HP0000"`)
- `https://hittepetit.radiononnevot.nl/q/HP0223` → 404 `QR-code niet gevonden.`
- `https://hittepetit.radiononnevot.nl/media/HP0132` → 200 text/html (Apple App Store-pagina, 508.550 B)
- `https://hittepetit.radiononnevot.nl/media/HP0000` → 404 Apache; `/media/HP0999` → 404 `Media niet gevonden.`
- `https://hittepetit.radiononnevot.nl/` → 404 `Hittepetit`
- ~40 route-varianten (`/api…`, `/songs…`, `/cards…`, `/json…`) → 404
- `https://app.radiononnevot.nl/` → 301 → `https://radiononnevot.nl/app` → 301 → `https://apps.apple.com/nl/app/radio-n%C3%B3nnevot/id1636814985`
- `https://app.radiononnevot.nl/index.html` → 200 "This is the default server vhost" (SiteGround)
- `https://media.radiononnevot.nl/` (37.97.134.249) → 403/404 (Apache); origin-probe met `Host:` → 404
- `https://stream.radiononnevot.nl/api/stations` → 200 (AzuraCast; station "Gaaas!!! Radio")
- `https://stream.radiononnevot.nl/` → 301 → `https://media.hostin.live/audio/radio-nonnevot.aac`
- `https://crt.sh/?q=radiononnevot.nl&output=json` → 502 (2×)
- `http://web.archive.org/cdx/search/cdx?url=hittepetit.radiononnevot.nl*` → leeg
- `https://play.google.com/store/apps/details?id=com.radiononnevot` → 200 (functie bevestigd)
- `https://itunes.apple.com/lookup?id=1636814985&country=nl` → 200 (iOS-app v5.0, Ermeco VOF)
- `https://apkpure.com/radio-n%C3%B3nnevot/com.radiononnevot` → 200; download → 302 `/apk-downloader`; `d.apkpure.com/.net` → 403; `tapi.pureapk.com/v3/get_app_his_version` → `version_list:[]`
- `https://apkcombo.com/…com.radiononnevot…` → 404 (geen vermelding)
- `https://www.apkmirror.com/?s=radiononnevot` → 403; `https://apkfab.com/…` → 403
- `https://ws75.aptoide.com/api/7/app/getMeta?package_name=com.radiononnevot` → `Application not found`
- Kaartfoto's: `https://i.regiogroei.cloud/4eca0096-3eb7-3757-b3b1-669424989eda.jpg` (L1),
  `https://marotte.nl/wp-content/uploads/hittepetit-spel-op-tafel.jpg`,
  `…/hittepetit-spelavond-met-doos.jpg`
- Shop/artikelen: `https://marotte.nl/hittepetit`, `https://marotte.nl/product/hittepetit/`,
  `https://marotte.nl/radio-nonnevot-presenteert-in-samenwerking-met-de-marotte-zitterd-de-zittesje-hitster/`,
  `https://www.l1nieuws.nl/entertainment/3272141/…`, `https://sittard-geleen.nieuws.nl/carnaval/…`,
  `https://nieuwskoerier.nl/artikel/842a44d6e718-…`
