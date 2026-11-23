# Onderzoek: Raoj 's — kaart-ID's, de getSongId-keten en of titel/artiest publiek op te zoeken zijn

Doel: (1) vaststellen hoe een Raoj 's-kaart de bijbehorende muziek oplevert via de officiële web-app/CDN, en (2) bepalen of een eigen app daarbij ook **titel/artiest/jaar** kan vinden. Alle bevindingen zijn nagegaan met echte HTTP/DDP-verzoeken; per poging staat de exacte aanroep/URL en de letterlijke respons.

Datum: 23 november 2026. Onderzoeker: Hermes (subagent).

---

## 0. Samenvatting

| Vraag | Antwoord |
|---|---|
| ID-formaat op een Raoj 's-kaart | **4 tekens, hoofdletters + cijfers** (bv. `NPRP`, `CZ6D`, `ZKX3`, `C2B9`, `SBXY`). QR = `https://app.raojs.nl/?id=<CODE>` |
| Kaart → liednummer | Publieke Meteor-methode `getSongId(code, variantKey, deviceInfo)` → CDN-pad `"<map>/<liednummer>"` |
| CDN | `https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/<map>/<liednummer>.mp3` — **publiek, géén auth**, 30 s, 320 kbps mp3 |
| Liednummer gelijk per variant? | **Ja** — het liednummer is voor alle varianten hetzelfde; alleen de map (variant) verschilt |
| **Titel/artiest/jaar publiek op te zoeken?** | **Nee.** Geen publieke methode, subscription, JSON/manifest of ID3-tag met die gegevens. Alleen `getCard` (admin-only) of de fysieke kaart bevatten titel/artiest/jaar |
| `?game=lvk` verandert de keten? | Nee — de app leest die parameter niet; de keten is alleen op `?id=` gebaseerd |

---

## 1. Het ID-formaat (staat vast)

Een echt kaartje (gescand door Tom) gaf QR = `https://app.raojs.nl/?id=NPRP` → het **id** dat de app gebruikt is de `id`-parameter: **`NPRP`** — 4 tekens, hoofdletters/cijfers.

Uit een productievideo van Raoj 's (@raoj_s, TikTok `7470842465814187286`) heb ik met zxing-cpp uit één frame **vier extra echte kaart-QR's** gedecodeerd:

```
https://app.raojs.nl/?id=CZ6D
https://app.raojs.nl/?id=ZKX3
https://app.raojs.nl/?id=C2B9
https://app.raojs.nl/?id=SBXY
```

De app zelf bouwt de kaart-QR in de JS als `value:"https://app.raojs.nl?id=".concat(n.id)` (bestand `.../611a3071fc345eed78d12b22d565f81551e79f6d.js`) en leest bij scannen `new URL(rawValue).searchParams.get("id")`. Er is ook een handmatige invoer met `length:4` (`react-pin-field`), gelabeld _"Vul de 4 tekens in, die op het kaartje staan"_ — de 4 tekens op de kaart zijn dus precies het id.

> De id's uit de **officiële productfoto's** (`FM5H`, `TPWA` uit `dsc01203` op raojs.nl) zijn **placeholders/mockups**: die geven `[Not found]`. Alleen echte spelkaarten (uit de video en van Tom) werken.

---

## 2. De keten kaart → liedje (getSongId)

Aanroep (DDP over `wss://app.raojs.nl/websocket`, geen login):

```json
{"msg":"method","method":"getSongId","params":["<CODE>","<variantKey>",{}],"id":"1"}
```

`variantKey` ∈ `raojs | zings | stops | lvjaolvnein` (uit `PUBLIC_SETTINGS.variants`). Resultaten (letterlijk):

| code | `raojs` | `zings` | `stops` | `lvjaolvnein` |
|---|---|---|---|---|
| NPRP | `preview/93984` | `custom/93984` | `intro/93984` | `preview/93984` |
| CZ6D | `preview/163146` | `custom/163146` | `intro/163146` | `preview/163146` |
| ZKX3 | `preview/228861` | `custom/228861` | `intro/228861` | `preview/228861` |
| C2B9 | `preview/41087` | `custom/41087` | `intro/41087` | `preview/41087` |
| SBXY | `preview/99168` | `custom/99168` | `intro/99168` | `preview/99168` |

- **Alle 5 kaartnummers werken**, elk met een **eigen, niet-opeenvolgend liednummer** (93984, 163146, 228861, 41087, 99168). Het liednummer is dus geen kaartnummer en geen oplopend nummer.
- **Map = variant**: `raojs` → `preview`, `zings` → `custom`, `stops` → `intro`, `lvjaolvnein` → `preview` (zelfde als `raojs`).
- **Liednummer identiek over varianten** — bevestigd voor alle 5 kaarten.

Ophalen van de audio (curl, geen auth):

```
https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/preview/93984.mp3   → HTTP 200, audio/mp3, 1.213.170 bytes
https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/custom/93984.mp3    → HTTP 200, 1.213.170 bytes
https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/intro/93984.mp3     → HTTP 200, 1.166.150 bytes
```

`ffprobe`: duur **30,302 s**, mp3, 320 kbps, 44.100 Hz stereo. Range-requests werken (`206`). HEAD toont `x-amz-server-side-encryption: AES256`, `Last-Modified: Fri, 07 Feb 2025 11:26:58 GMT`, geen `x-amz-meta-*`.

**Bijzonderheid:** de `preview`- en `custom`-bestanden zijn voor élke geteste kaart **byte-identiek** (zelfde md5), bv. `93984`: `f6b2030c8cd080f01b7fd0841189fcf3` voor zowel `preview/93984.mp3` als `custom/93984.mp3`. De `intro`-variant verschilt wél. Met andere woorden: de spelvarianten **Raoj 's** en **Zìng 's** leveren in de praktijk hetzelfde audiobestand; **Stop 's** levert een ander (intro-)bestand.

Alleen `93984` bestaat in `preview/` — `preview/93983.mp3`, `preview/93985.mp3`, `preview/1.mp3`, `preview/10000.mp3` enz. geven `403`. De liednummers zijn dus unieke (random-achtige) ids, geen oplopende reeks.

---

## 3. Vraag 1 — is titel/artiest/jaar publiek op te zoeken? **Nee.**

Alle onderstaande routes zijn geprobeerd; de respons is letterlijk weergegeven.

**a) Andere publieke Meteor-methoden.** `getSongId`, `check.lvjaolvnein` en `getCard` bestaan; al het andere geeft `Method '<naam>' not found [404]`. Geprobeerd (o.a.): `getSong`, `getSongById`, `getSongInfo`, `getSongs`, `getTrack`, `getCardInfo`, `getMeta`, `checkSong`, `getCardTitle`, `getSongData`, `getMetadata`, `getAllCards`, `getTracks`, `getSongNumber(s)`, `resolveSong`, `getSongUrl`, `getSongMeta`, `checkSongId`, `getCardData`, `getAlbum`, `getArtist`. → allemaal `404 "Method '...' not found"`.

**b) `getCard` (zou `{id, artist, title, year}` teruggeven) is admin-only.**
```
getCard ["NPRP"]  → {"error":404,"reason":"Unauthorized","message":"Unauthorized [404]","errorType":"Meteor.Error"}
getCard ["93984"] → idem Unauthorized
```
→ Zonder admin-login geen titel/artiest/jaar.

**c) Publieke subscriptions/collections.** Geprobeerd: `cards`, `songs`, `allCards`, `card`, `song`, `game`, `meta`, `raojs`, `publicCards` → allemaal `nosub … Subscription '<naam>' not found [404]`. Alleen `meteor.loginServiceConfiguration` bestaat (leeg/irrelevant).

**d) JSON/manifest in de S3-bucket.** Geprobeerd: `raojs/preview/93984.json`, `raojs/93984.json`, `raojs/meta/93984.json`, `raojs/songs.json`, `raojs/cards.json`, `raojs/preview/manifest.json`, `raojs/index.json`, `raojs/raojs.json`, `raojs/93984.txt` → **allemaal `403`** (AccessDenied; de bucket staat geen listing of index toe: `?list-type=2&prefix=raojs/` → `AccessDenied`).

**e) ID3/TXXX-tags in de mp3.** De mp3's hebben alleen een minimale ID3v2.4-header met één frame:
```
TSSE = Lavf60.16.100     (encoder)
```
Geen `TIT2` (titel), `TPE1` (artiest), `TALB`, `TDRC`/`TYER` (jaar), `TXXX` of `APIC`. `ffprobe -show_format` toont enkel `TAG:encoder=Lavf60.16.100`.

**f) S3 object-headers.** HEAD geeft geen `x-amz-meta-*`; alleen standaard `ETag`, `Last-Modified`, `Content-Type`.

**Conclusie Q1:** er is **geen publieke bron** voor liednummer → titel/artiest/jaar. De metadata leeft uitsluitend in de admin-methode `getCard` en op de achterkant van de fysieke kaart. Een eigen app kan dus wél het juiste 30-secondenfragment ophalen (via `getSongId` + CDN), maar **niet** de titel/artiest/jaar publiek opzoeken. De enige niet-API-route zou audio-herkenning (fingerprint/Shazam-achtig) van het fragment zijn — dat is geen databron en niet betrouwbaar als primaire methode.

---

## 4. Vraag 2 — werkt de keten ook voor `?game=lvk` en voor andere kaartnummers?

**Andere kaartnummers: ja.** Vijf onafhankelijke echte kaarten (NPRP, CZ6D, ZKX3, C2B9, SBXY) resolven allemaal correct; elk naar een eigen liednummer, met per variant de vaste map (zie tabel in §2). De keten is dus niet kaart-specifiek.

**`?game=lvk`: de keten verandert niets.** De doos-/spelregels-QR is `https://app.raojs.nl/?game=lvk` (gedecodeerd uit de webshop-productfoto). In de gedeployde JS-bundel komt de string `game` (en `game=`) **niet voor**; de scanner leest uitsluitend de `id`-parameter. `?game=lvk` opent dus alleen de app (vermoedelijk variant-selectie) en heeft **geen** invloed op `getSongId` of op het opgehaalde bestand. De resolver-keten is puur `?id=<CODE>`.

**Liednummer gelijk per variant: ja.** Voor alle 5 kaarten is het liednummer identiek over `raojs/zings/stops/lvjaolvnein`; alleen de map verschilt (`preview/custom/intro/preview`). Zie §2.

---

## 5. Praktische consequentie voor Sjpeelavond (eigen app)

1. **Scan** de kaart-QR → lees `id` uit `new URL(rawValue).searchParams.get("id")` (of laat de gebruiker de 4 tekens intypen, uppercase).
2. **Roep** via DDP `wss://app.raojs.nl/websocket` aan: `getSongId(id, variantKey, {})` → pad `"<map>/<liednummer>"`.
3. **Bouw** de audio-URL: `https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/<pad>.mp3` (publiek, Range-support → streaming mogelijk).
4. **Titel/artiest/jaar** zijn **niet** publiek te verkrijgen. Voor de spelbeleving (die juist op "raden" berust) is dat geen beperking: de app mag/kan de metadata verbergen. Wil je ze tóch tonen, dan moet je ze zelf invoeren (of administratieve toegang hebben tot `getCard`).

Minimale DDP-stappen (Python, websocket-client):
```json
{"msg":"connect","version":"1","support":["1"]}          → {"msg":"connected",...}
{"msg":"method","method":"getSongId","params":["NPRP","raojs",{}],"id":"1"}
                                                          → {"msg":"result","id":"1","result":"preview/93984"}
```

---

## Bronnen / gebruikte aanroepen (allemaal daadwerkelijk uitgevoerd)

- App-shell + runtime-config: `GET https://app.raojs.nl` (200) en JS-bundel `https://app.raojs.nl/611a3071fc345eed78d12b22d565f81551e79f6d.js` (200, 6,7 MB) — bevat `getSongId`-aanroep, `?id=`-QR-bouwer, `length:4` code-invoer, variantenlijst, `getCard`.
- DDP `wss://app.raojs.nl/websocket`: `getSongId`, `getCard`, `check.lvjaolvnein` en ~30 naam-probes; subscriptions `cards/songs/...`.
- CDN: `https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/{preview,custom,intro}/{93984,163146,228861,41087,99168}.mp3` (allen 200); listing/prefix/JSON → 403.
- Echte kaart-QR's: TikTok @raoj_s `7470842465814187286` (CZ6D, ZKX3, C2B9, SBXY) + door Tom gescande kaart (NPRP).
- Officiële (mockup-)codes die NIET werken: `FM5H` (productfoto raojs.nl), `TPWA` (idem), `L2025_001` (mockup raojs.nl/spelvarianten).
- Gedownloade proefbestanden staan lokaal in `/home/hermes/.hermes/cache/scratch/songs/` (15 mp3's).
