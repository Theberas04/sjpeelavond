# Onderzoek: QR-codes op de kaartjes van Raoj 's en Hittepetit

Doel: uitzoeken wat er in de QR-code op de fysieke kaartjes staat, en hoe de officiële app die code omzet in een muziekfragment, zodat een eigen Android-app (Sjpeelavond) hetzelfde zou kunnen doen.

Methode: openbare webpagina's (`web_extract`), het JavaScript van de officiële web-app, en waar nodig directe HTTP/DDP-probes. Alle bevindingen hieronder zijn nagegaan met een echte pagina/endpoint; waar iets onzeker is staat dat expliciet vermeld.

Datum onderzoek: 23 november 2026.

---

## Samenvatting (kort)

| | Raoj 's | Hittepetit |
|---|---|---|
| QR op het kaartje | `https://app.raojs.nl?id=<ID>` (zoals de app zelf kaart-QR's bouwt) | `https://hittepetit.radiononnevot.nl/q/HP<nnnn>` (**bevestigd uit echte kaartfoto**) |
| Kaart-identifiers | onbekend ID-formaat (niet publiek) | `HP0001` … `HP0222` (222 kaarten) |
| Fragment ophalen | publieke Meteor-methode `getSongId(id, variant, device)` → CDN-pad → `…/raojs/<pad>.mp3` | fragment zit **achter de app**; geen publieke audio-URL gevonden |
| Door derde na te rekenen? | **ja, via de publieke `getSongId`-methode**, mits je het ID-formaat van de kaart kent | nee — alleen het kaartnummer is publiek, de muziek niet |

---

## 1. Raoj 's (raojs.nl)

### 1a. Wat staat er in de QR-code?

Er zijn bij Raoj 's **twee soorten QR-codes**: één in/op de doos naar de web-app, en één per kaartje dat door de web-app gescand wordt.

Wat ik met zekerheid heb kunnen vaststellen:

1. **De web-app bouwt de kaart-QR als `https://app.raojs.nl?id=<ID>`.**
   In de productie-JS van de officiële web-app staat letterlijk:

   > `value:"https://app.raojs.nl?id=".concat(n.id)`

   (bestand `https://app.raojs.nl/611a3071fc345eed78d12b22d565f81551e79f6d.js`, in de route `/cards`). De app toont daarnaast `n.id` als tekst én `n.artist - n.title (n.year)` op de achterkant. Dit is dus het QR-formaat dat de maker zelf voor de kaartjes genereert.

2. **De kaart-QR wordt door de app gelezen als een URL met `id`-parameter.**
   De scan-handler in `Spueel.js` (zelfde JS-bundel) doet:

   > `const ae=e=>{const t=undefined,n=new URL(e[0].rawValue).searchParams.get("id");te(n)}`

   Met andere woorden: de scanner leest de QR-tekst en haalt er `?id=…` uit. Een QR die **geen geldige URL** is, laat `new URL(...)` mislukken (en wordt dus niet verwerkt). Dit bevestigt dat de echte kaart-QR een URL is (zoals in punt 1).

3. **Echte QR-codes die ik uit gepubliceerde foto's heb gedecodeerd** (met zxing-cpp):
   - `https://raojs.nl` — de QR op de "tafel"-foto op de site zelf (doos-/promo-QR): <https://assets.zyrosite.com/Aq2qvB4MgZCb68wD/tafel-raojs-dWxBvoa1XpiN14b2.png>
   - `https://app.raojs.nl/?game=lvk` — de QR op een "spelregels"-kaart in de doos-inhoud-foto van de webshop: <https://favoshop.nl/product/raoj-s-n-limburgs-fieestspuuel> (productfoto)
   - `L2025_001` — de QR op de kaart in de "scan"-afbeelding op <https://raojs.nl/spelvarianten> (<https://assets.zyrosite.com/Aq2qvB4MgZCb68wD/scan-YbNqv4k5oEfVReMN.png>). Let op: dát plaatje is een **stylistische mockup** — de telefoon erop toont het splash-scherm (roze gradient met "raoj 's"), niet het scan-scherm. De QR is daarom waarschijnlijk een mockup-QR die de ontwerper van het kaartnummer `L2025_001` heeft gemaakt; de live app zou een QR met alléén `L2025_001` (geen URL) niet accepteren (zie punt 2).

   De spelregels-/doos-QR's (`?game=lvk`) verwijzen naar de web-app, niet naar een liedje. De string `"game"` komt overigens **niet** voor in de JS-bundel, dus die parameter lijkt door de huidige app genegeerd te worden.

**Conclusie 1a:** het meest betrouwbare antwoord is dat een Raoj 's-kaartje een QR bevat in de vorm **`https://app.raojs.nl?id=<ID>`**, waarbij `<ID>` een intern identificatienummer is. Het exacte ID-formaat kon ik niet vaststellen (zie 1c). Ik heb **geen echte kaart-QR met een volledige `?id=…`-URL** kunnen vinden; het enige echte kaartnummer dat ik zag is `L2025_001` (uit de mockup), en dat is géén geldig ID voor de app.

### 1b. Hoe zet de app de code om in muziek?

De web-app is **<https://app.raojs.nl>** (een Meteor 3.1-app; de marketingsite raojs.nl is een Zyro-site en bevat géén app-code). Uit de runtime-config in de HTML:

- `cdnBaseUrl`: `https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/`
- varianten (naam → CDN-map): `Raoj's` → `preview`, `Zing's` → `custom`, `Stop's` → `intro`, `LVjao of LVnein` → `preview`
- `ROOT_URL`: `raojs-production-caught-gmbh.svc.zcloud.ws`; appInfo `name: "Raojs"`. (De app is gemaakt door/bij "caught" — <https://caught.nu/>.)

De keten (uit de JS-bundel) is:

1. Scanner leest QR → `id` uit `?id=…`.
2. `Meteor.callAsync("getSongId", id, <variantKey>, {deviceinfo})` → geeft een **CDN-pad** terug (bijv. `preview/012`).
3. Audio-URL wordt samengesteld als:
   > `const e="".concat(i.settings.public.cdnBaseUrl).concat(I,".mp3")`
   dus **`https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/<pad>.mp3`**.

Publiek aanroepbare Meteor-methoden die ik via DDP heb gevonden en getest:

- `getSongId(id, variantKey, deviceInfo)` — **publiek, geen login nodig**. Dit is de kaart→liedje-resolver.
- `check.lvjaolvnein(nummer, {})` — publiek; geeft terug of een nummer LVK-finalist was.
- `getCard(code)` — **niet** publiek: geeft `Unauthorized [404]` (admin/login nodig).
- `foo`, `requestLoginTokenForUser` — intern.

Test: ik heb `getSongId` aangeroepen met o.a. `L2025_001`, `001`, `1`, `2025_001` (met varianten `raojs/zings/stops/lvjaolvnein`) — allemaal `[Not found]`. Er is dus een specifiek (niet-geraden) ID-formaat nodig.

### 1c. Is er een publieke kaartnummer→liedje-lijst?

**Nee.** Vastgesteld:

- Er is **geen publieke publicatie/subscription** met kaarten of liedjes (alleen Meteor-intern zoals `meteor.loginServiceConfiguration`).
- `getCard` (dat een kaart met `id`, `artist`, `title`, `year` teruggeeft) is admin-only.
- De S3-bucket **weigert listing**: `GET https://caught-cdn.s3.eu-west-1.amazonaws.com/?list-type=2&prefix=raojs/` → `AccessDenied`. Ook losse paden (bijv. `raojs/preview/001.mp3`) geven `403` (S3 geeft 403 i.p.v. 404 zonder ListBucket-rechten), dus ik kon geen bestaande bestandsnaam bevestigen.
- `app.raojs.nl/<willekeurig pad>` geeft altijd de SPA-shell (200, dezelfde HTML), dus ook daar geen mediadoorverwijzing.

**Het enige publieke aanknopingspunt** is dus de publieke methode `getSongId`: als je het kaart-ID kent, kun je het CDN-pad en daarmee de mp3 opvragen. Maar het **ID-formaat op de kaart is niet publiek** en de ID's zijn geen simpele nummers (1…5, 001…005, `L2025_001`, … gaven allemaal `[Not found]`).

### 1d. Wat ik voor Raoj 's NIET heb kunnen vinden

- Het **exacte ID-formaat** dat op de echte kaartjes in de QR staat (en of het überhaupt in de `?id=`-URL zit). De enige echte kaart-QR die ik zag (`L2025_001`) is een mockup en werkt niet tegen de live app.
- Een **voorbeeld van een echte kaart-QR** uit een review/unboxing (geen foto gevonden met een leesbare, echte kaart-QR).
- Een **kaartnummer→liedje-tabel** of een publieke lijst van de 240 nummers.
- Of het S3-bestand daadwerkelijk zonder auth afspeelbaar is (alle geprobeerde paden gaven 403).

> **Praktische consequentie voor Sjpeelavond:** als de echte kaart-QR `https://app.raojs.nl?id=<ID>` is, dan kán een eigen app het narekenen: scan → `id` eruit → roep de **publieke** Meteor-methode `getSongId` aan (via WebSocket/DDP) → speel `https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/<pad>.mp3`. Dit werkt alleen als vast te stellen is welk ID-formaat op de kaart staat; dat kon ik met openbare bronnen niet achterhalen.

---

## 2. Hittepetit (marotte.nl/hittepetit)

### 2a. Wat staat er in de QR-code?  — BEVESTIGD

Uit de persfoto bij het L1-artikel "Van nonnevot tot muziekspel: Radio Nónnevot komt met Hittepetit" (<https://www.l1nieuws.nl/entertainment/3272141/van-nonnevot-tot-muziekspel-radio-nonnevot-komt-met-hittepetit>) — foto <https://i.regiogroei.cloud/4eca0096-3eb7-3757-b3b1-669424989eda.jpg> — heb ik **vier echte kaart-QR's gedecodeerd**:

```
https://hittepetit.radiononnevot.nl/q/HP0132
https://hittepetit.radiononnevot.nl/q/HP0186
https://hittepetit.radiononnevot.nl/q/HP0031
https://hittepetit.radiononnevot.nl/q/HP0202
```

Dus: de QR op een Hittepetit-kaart is **`https://hittepetit.radiononnevot.nl/q/HP<nnnn>`** met een (4-cijferig) kaartnummer na `HP`.

Het kaartnummerbereik (gecontroleerd via HTTP-status op `/q/HP<nnnn>`): geldig zijn **HP0001 t/m HP0222** (HP0001 → 302, HP0222 → 302, HP0223 → 404). Dat komt overeen met het persbericht: *"Met maar liefst 222 kaartjes van Zittesje vastelaovesleidjes en het beste uit Limburg"* (<https://sittard-geleen.nieuws.nl/carnaval/radio-nonnevot-presenteert-in-samenwerking-met-de-marotte-zitterd-de-zittesje-hitster>).

### 2b. Hoe zet de app de code om in muziek?

- **Welke app:** de **Radio Nónnevot-app** (Android-package `com.radiononnevot`), niet Spotify. Google Play: *"Sjpeel noe ouch Hittepetit via Radio Nónnevot! Scan de kaart en rao de meziek oet Zitterd en 't bèste oet Limburg."* (<https://play.google.com/store/apps/details?id=com.radiononnevot>). L1 bevestigt: *"waar Hitster draait op streamingplatform Spotify, draait Hittepetit op de eigen gratis Radio Nónnevot-app"*.
- **Wat de QR-URL doet:** `https://hittepetit.radiononnevot.nl/q/HP<nnnn>` geeft voor een **geldig** kaartnummer een **HTTP 302** met `Location: https://app.radiononnevot.nl` (dus: open de Radio Nónnevot-app / App Store). Voor een **ongeldig** nummer (bijv. `HP0000`) geeft het een HTML-pagina "Hittepetit" met:
  > `<audio controls autoplay preload="metadata" … src="/media/HP0000">`
  Dat suggereert een web-fallback-speler met audio-pad **`/media/HP<nnnn>`**.
- **Maar `/media/HP<nnnn>` levert geen audio.** In al mijn tests gaf `https://hittepetit.radiononnevot.nl/media/HP0132` (en HP0031/HP0202) de **App Store-pagina** terug (HTML, 508.550 bytes, `content-type: text/html`), niet een mp3 — ook met `Range`, `Referer`, `Accept: audio/*`; de body was alleen bruto-gzip/brotli-gecomprimeerde HTML. Andere paden (`/media/HP0132.mp3`, `/audio/HP0132`, `/songs/HP0132`, `/fragment/HP0132`, …) geven 404. Kortom: de fragmenten zitten **achter de officiële app** en zijn niet zomaar publiek afspeelbaar; de web-speler op `/q/` lijkt niet werkend voor echte kaarten (geldige kaarten redirecten naar de app).

### 2c. Kan een derde app dit narekenen?

Deels:

- **Het kaartnummer is publiek reproduceerbaar:** QR scannen → `HP<nnnn>` (HP0001–HP0222).
- **De muziek is dat niet:** ik heb via openbare bronnen **geen werkende audio-URL of liedjelijst** gevonden. De liedjestitels/artiesten/jaartallen worden door de app getoond en zijn nergens publiek gepubliceerd.

### 2d. Wat ik voor Hittepetit NIET heb kunnen vinden

- Een **publieke audio-endpoint** voor de fragmenten (de `/media/<id>`-route gaf de App Store-pagina; geen mp3 gevonden).
- Een **publieke liedjeslijst** (kaartnummer → titel/artiest/jaar).
- De APK van `com.radiononnevot` (download via APKPure/APKCombo/ApkFab werd geblokkeerd; dus de interne scan-/afspeellogica van de app niet kunnen inzien). `app.radiononnevot.nl` is een simpele redirect/smart-banner naar de Apple App Store; `hittepetit.radiononnevot.nl` geeft voor onbekende paden een 404 met alleen de tekst "Hittepetit".

---

## 3. Algemeen: is er een publieke tabel/API?

- **Raoj 's:** geen publieke kaart→liedje-tabel, maar wél een **publieke resolver-API** (`getSongId`) die werkt op basis van het kaart-ID. Een derde app kan dus narekenen *mits* het ID-formaat van de kaart-QR bekend is (dat is het niet publiekelijk).
- **Hittepetit:** geen publieke tabel en geen publieke audio-URL; de omzetting kaart→fragment gebeurt volledig in/bij de Radio Nónnevot-app.
- **Hitster** (ter vergelijking, al opgelost in Sjpeelavond): QR = `www.hitstergame.com/<taal>/<sku>/<kaartnummer>` en de fabrikant publiceert de kaart→Spotify-tabel op <https://hitster.jumboplay.com/hitster-assets/gameset_database.json>. Voor Raoj 's en Hittepetit bestaat zo'n publieke tabel **niet**.

### Aanknopingspunten voor een eigen app

1. **Raoj 's:** scan de QR; verwacht een URL met `?id=`; gebruik dezelfde publieke Meteor-methode `getSongId(id, variant, deviceInfo)` (DDP over `wss://app.raojs.nl/websocket`) om het CDN-pad te krijgen; speel `https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/<pad>.mp3`. Randvoorwaarde: het ID-formaat op de kaart moet bekend zijn — dat is het nog niet.
2. **Hittepetit:** scan de QR → `https://hittepetit.radiononnevot.nl/q/HP<nnnn>` → kaartnummer `HP0001–HP0222`. Voor de muziek is vooralsnog geen publieke route; hoe de app precies aan het fragment komt, is niet publiek gemaakt.
3. Algemene tip: de QR's van beide spellen coderen **een identifier/URL, niet de liedjestitel**. De titel staat (bij Raoj 's, en bij Hitster/Hittepetit-stijl spellen) op de achterkant van het kaartje, maar wordt door de scanner verborgen gehouden.

---

## Bronnen (allemaal daadwerkelijk opgehaald)

- <https://raojs.nl/>, <https://raojs.nl/muziek>, <https://raojs.nl/spelvarianten>, <https://raojs.nl/koupe>
- <https://favoshop.nl/product/raoj-s-n-limburgs-fieestspuuel> (productfoto met QR `https://app.raojs.nl/?game=lvk`)
- Officiële web-app: <https://app.raojs.nl> en JS-bundel <https://app.raojs.nl/611a3071fc345eed78d12b22d565f81551e79f6d.js> (Meteor-config: `cdnBaseUrl=https://caught-cdn.s3.eu-west-1.amazonaws.com/raojs/`; scan-handler leest `?id=`; QR-generator bouwt `https://app.raojs.nl?id=<id>`)
- DDP-probes op `wss://app.raojs.nl/websocket` (methoden `getSongId`, `check.lvjaolvnein`, `getCard`)
- <https://caught-cdn.s3.eu-west-1.amazonaws.com/?list-type=2&prefix=raojs/> → AccessDenied
- QR-afbeeldingen: <https://assets.zyrosite.com/Aq2qvB4MgZCb68wD/tafel-raojs-dWxBvoa1XpiN14b2.png> (`https://raojs.nl`), <https://assets.zyrosite.com/Aq2qvB4MgZCb68wD/scan-YbNqv4k5oEfVReMN.png> (mockup `L2025_001`)
- <https://marotte.nl/hittepetit> en <https://marotte.nl/product/hittepetit/>
- <https://play.google.com/store/apps/details?id=com.radiononnevot> (Hittepetit via de app)
- <https://www.l1nieuws.nl/entertainment/3272141/van-nonnevot-tot-muziekspel-radio-nonnevot-komt-met-hittepetit> (eigen app i.p.v. Spotify; kaartfoto <https://i.regiogroei.cloud/4eca0096-3eb7-3757-b3b1-669424989eda.jpg> met de vier QR's)
- <https://sittard-geleen.nieuws.nl/carnaval/radio-nonnevot-presenteert-in-samenwerking-met-de-marotte-zitterd-de-zittesje-hitster> (222 kaartjes; QR via de Radio Nónnevot-app)
- <https://hittepetit.radiononnevot.nl/q/HP0132> (302 → app), `/q/HP0000` (200, web-speler met `src="/media/HP0000"`), `/media/HP0132` (gaf de App Store-pagina), bereik HP0001–HP0222 geldig
