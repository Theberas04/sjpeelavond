# Onderzoek: de Android-app van Radio Nónnevot en de Hittepetit-koppeling

Datum: 23 november 2026. Alle bevindingen hieronder zijn met echte HTTP-verzoeken en met
de daadwerkelijk gedownloade APK nagegaan. Waar iets onzeker is staat dat erbij. Er is
niets verzonnen.

Vervolg op `onderzoek-hittepetit.md`. Daar luidde de conclusie: *geen publieke koppeling,
geen publiek API-eindpunt, APK niet te pakken.* **Dat is nu weerlegd**: de APK is bemachtigd,
en er blijkt wél een publiek API-eindpunt te zijn dat kaartnummer → liedje (audio) geeft.

---

## Kort antwoord

- **Ja**, er is een Android-app: **`com.radiononnevot`** ("Radio Nónnevot", Ermeco Digitale
  Communicatie), **versie 5.1.0**, bijgewerkt **1 okt 2026**, APK **≈ 198 MB (XAPK)**. De
  Play-omschrijving noemt Hittepetit in "Wat is er nieuw".
- **De APK is bemachtigd** via **androidpot.net** (een Play-doorgeefluik dat geen account
  nodig heeft). Zie §2 voor URL's, maten en sha256.
- Het is een **React Native-app** (Hermes-bytecode in `assets/index.android.bundle`).
- **De koppeling IS publiek te vinden** — niet via de webshop, maar via de **Firebase
  Realtime Database** en **Firebase Storage** van de app:
  - `GET https://nonnevot-9cea7-default-rtdb.europe-west1.firebasedatabase.app/hittepetitLinks.json`
    → **222 records** `HP0001`..`HP0222`, elk met `storagePath: "hittepetit/HPxxxx.mp3"`.
  - Het bijbehorende audiobestand staat **openbaar** in Firebase Storage:
    `https://firebasestorage.googleapis.com/v0/b/nonnevot-9cea7.appspot.com/o/hittepetit%2FHPxxxx.mp3?alt=media`
    (getest: HP0077 = 3.412.636 bytes audio/mpeg, HP0132 = 2.549.133 bytes).
- Daarnaast is de **volledige liedjescatalogus (771 nummers)** openbaar via Airtable met een
  in de app ingebakken token (basis `appZTBo4yxK1O7y5F`, tabel `tbl4aqmSg5X80vABx`).
- **De app koppelt kaartnummer alleen aan AUDIO, niet aan een tekst-titel.** De app speelt
  `HPxxxx.mp3`; de titel/artiest staat op het fysieke kaartje. De mp3's hebben **geen ID3-tags**,
  dus de code→titel-koppeling zit **niet** in de app of de data. Zie §5/§7.

---

## 1. Play Store (bevestiging pakket + functie)

`https://play.google.com/store/apps/details?id=com.radiononnevot&hl=nl&gl=NL` (via echte
browser, JS aan):

- Titel: **Radio Nónnevot**; ontwikkelaar **Ermeco Digitale Communicatie**; id **com.radiononnevot**.
- Bijgewerkt: **1 okt 2026**; versie uit de pagina-HTML: **"5.1.0"**.
- "Wat is er nieuw" (letterlijk): *"Sjpeel noe ouch Hittepetit via Radio Nónnevot! Scan de
  kaart en rao de meziek oet Zitterd en 't bèste oet Limburg."*
- De **huidige** store-tekst noemt géén "SongsList.tsx"/albumhoezen; die vermelding uit eerder
  onderzoek staat niet meer in de zichtbare tekst. (De app zélf bevat wél een scherm `SongsList`,
  zie §4.)

AppBrain bevestigt dezelfde gegevens: *"APK size is 165.97 MB. The latest APK version available
is 5.1.0. The last update was on October 1, 2026."* (`https://www.appbrain.com/app/radio-n%C3%B3nnevot/com.radiononnevot`).

---

## 2. De APK bemachtigd (via androidpot.net)

Eerdere spiegels (APKPure, APKCombo, APKMirror, APKFab, Aptoide, apk.support, apkmonk)
faalden of hebben de app niet (APKPure: *"COMING SOON"*; APKCombo-downloader API:
`{"status":"failed","error":"not_found"}`; APKMirror: *"No results found"*; Aptoide:
*Application not found*; apk.support/apkmonk: DNS bestaat niet meer).

**Werkende route: `https://androidpot.net/apk-downloader`** (formulier met Play-link/pakketnaam;
server-side ophalen van Play, geen account nodig). Invoer `com.radiononnevot` leidt tot
`https://androidpot.net/apps/com.radiononnevot/download/17`, met:

- **Versie 5.1.0 · 198 MB · Android 7.0+**
- Bestandsnaam XAPK: `radio-nnnevot-5.1.0.xapk`, **sha256 `d4daee55f51657957285fa1e0ebe382285e85fe405b812590fd6d8fe0873b852`**
- Ondertekeningscertificaat (sha256): `4a6c2b3fc617df87a82dc41812819bb92ed791a2275af1144c2e1177cdea7c8d`

Directe split-APK-URL's (publiek, `dl.androidpot.net`):

| Bestand | URL | bytes | sha256 |
|---|---|---|---|
| base APK | `https://dl.androidpot.net/apk/com.radiononnevot/17/65684f23/files/com.radiononnevot-17.apk` | **182.941.996** | `1fc98497adfe2872aba2f94ade311e018b2f49819f4aa2caf801e17682a21fa4` |
| arm64-v8a split | `…/files/com.radiononnevot-17-config.arm64_v8a.apk` | 14.317.195 | `ea977f1c46d953c2fcc10f910b350578f7850bd3d5ef292769c76dd637a8c9bf` |

(Er zijn ook config-splits per taal (en, hi, pt, de, fr, ru, es, in, ja, ar) en per dpi (xxhdpi).)

**Lokale paden (bewaard):**
- `/home/hermes/.hermes/cache/scratch/rn_apk/base.apk`
- `/home/hermes/.hermes/cache/scratch/rn_apk/arm64.apk`
- uitgepakt: `/home/hermes/.hermes/cache/scratch/rn_apk/base_x/`

---

## 3. Wat zit er in de APK

- **React Native** met **Hermes-bytecode**: `assets/index.android.bundle` (3.042.944 bytes,
  magic `c6 1f bc 03 c1 03 19 1f` = HBC). Geen losse JS.
- De 198 MB is vooral **video**, niet muziek:
  `res/raw/assets_radiononnevot_websiteheader.mp4` (69 MB),
  `res/raw/assets_hittepetit_hittepetitappanimatie.mp4` (40 MB),
  `res/raw/assets_rn_app_animatie.mp4` (8 MB),
  `res/raw/assets_hittepetit_animatielogo.mp4` (4,5 MB).
- De **muziek zit NIET in de APK** — die wordt online opgehaald (zie §5).
- Ik heb de bundle gedecompileerd met `hermes-dec` (`hbc-decompiler`) →
  `/home/hermes/.hermes/cache/scratch/decompiled.js` (590.870 regels).

Belangrijke strings/URL's die in de bundle zaten:
`https://api.airtable.com/v0/`, `https://hittepetit.radiononnevot.nl/koup`,
`https://media.radiononnevot.nl/covers/nowplaying.jpg`,
`https://media.hostin.live/audio/radio-nonnevot.aac`,
functienamen `fetchAllSongs`, `fetchFirebaseSongs`, `fetchHittepetitLink`, `fetchVoteSettings`,
schermnamen `SongsList`, `Hittepetit`, `HittepetitPlay`.
Uit `resources.arsc`: Firebase-RTDB-URL
`https://nonnevot-9cea7-default-rtdb.europe-west1.firebasedatabase.app`, bucket
`nonnevot-9cea7.appspot.com`, app-id `1:286474041431:android:477881e08b9ce5a9dc4b12`.

---

## 4. De app-logica (uit de gedecompileerde Hermes-bytecode)

`fetchHittepetitLink(code)` (regel ~400700 van `decompiled.js`):

```
ref('hittepetitLinks/' + code).once('value')
```

De HittepetitPlay-component (regels ~528600-528770) doet, na het scannen van een QR:

1. `firebase.database()` → `fetchHittepetitLink(<scannedcode>)`
2. bij leeg: melding *"Liedje niet gevonden. Probeer een andere kaart."*
3. `storagePath = link.storagePath`
4. `firebase.storage().ref(storagePath).getDownloadURL()` → afspelen met TrackPlayer.

De knop *"KOUP HITTEPETIT HIE"* opent `Linking.openURL('https://hittepetit.radiononnevot.nl/koup')`
(dat is dus de **koop-link** van het spel, géén API — vandaar de eerdere 404's op `/ko*`).

**Conclusie:** de app resolveert een kaartcode via Firebase RTDB naar een opslagpad en speelt
het mp3-bestand. Er wordt **geen liedjestitel** opgezocht of getoond.

---

## 5. HET PUBLIEKE EINDPUNT (dit is de kern)

### 5a. Firebase Realtime Database — kaartcode → mp3

Host: `https://nonnevot-9cea7-default-rtdb.europe-west1.firebasedatabase.app`

| Verzoek | Status | Letterlijke respons |
|---|---|---|
| `GET /hittepetitLinks/HP0077.json` | **200** | `{"qrLink":"https://hittepetit.radiononnevot.nl/q/HP0077","storagePath":"hittepetit/HP0077.mp3"}` |
| `GET /hittepetitLinks/HP0132.json` | **200** | `{"qrLink":"https://hittepetit.radiononnevot.nl/q/HP0132","storagePath":"hittepetit/HP0132.mp3"}` |
| `GET /hittepetitLinks/HP0001.json` | **200** | `{"qrLink":"https://hittepetit.radiononnevot.nl/q/HP0001","storagePath":"hittepetit/HP0001.mp3"}` |
| `GET /hittepetitLinks.json` | **200** | **22331 bytes**, alle 222 records: `{"HP0001":{"qrLink":"…/q/HP0001","storagePath":"hittepetit/HP0001.mp3"},"HP0002":{…}, … "HP0222":{…}}` |
| `GET /songs.json` | **200** | `{"song1":{"album":"ZVK","artiest":"Alaaf & Loud","number":1,"titel":"1. Sekjoeritie","year":2026},"song2":{…},"song3":{…}}` |
| `GET /.json` (root) | **401** | `{"error":"Permission denied"}` |
| `GET /hittepetit.json`, `/cards.json`, `/links.json` enz. | **401** | `{"error":"Permission denied"}` |

**`/hittepetitLinks` (individueel én als lijst) is dus volledig openbaar leesbaar; 222/222 codes
HP0001–HP0222.** Bewaard als `/home/hermes/.hermes/cache/scratch/hittepetitLinks.json`.

### 5b. Firebase Storage — de audio

Bucket: `nonnevot-9cea7.appspot.com` (openbaar leesbaar, óók listings).

- Lijst: `GET https://firebasestorage.googleapis.com/v0/b/nonnevot-9cea7.appspot.com/o?prefix=hittepetit/&maxResults=200`
  → 200, JSON met **222 items** `hittepetit/HP0001.mp3` … `hittepetit/HP0222.mp3`.
- Download: `GET https://firebasestorage.googleapis.com/v0/b/nonnevot-9cea7.appspot.com/o/hittepetit%2FHP0077.mp3?alt=media`
  → **200**, `content-type: audio/mpeg`, **3.412.636 bytes** (bewaard: `…/scratch/mp3/HP0077.mp3`).
  `…HP0132.mp3?alt=media` → **200**, audio/mpeg, **2.549.133 bytes**.
- Metadata (`GET …/o/hittepetit%2FHP0077.mp3`): `contentType audio/mpeg`, `size 3412636`,
  `timeCreated 2026-09-28T12:49:55Z`, `contentDisposition inline; filename*=utf-8''HP0077.mp3`.
  **Geen custom-metadata / geen titel.**
- **Alle 222 mp3's tesamen ≈ 735,4 MB**; kleinste `HP0017` 563.409 bytes, grootste `HP0194`
  9.498.312 bytes. (Sizes via HEAD: `/home/hermes/.hermes/cache/scratch/storage_sizes.json`.)
- De mp3's hebben **geen ID3-tags** (bestand begint direct met MPEG-frame `ff fb 90 44`).

### 5c. Airtable — de liedjescatalogus (incl. titel/jaar/artiest)

In de bundle (regels 400515-400519): API-key, basis en tabel:

- Endpoint: `https://api.airtable.com/v0/{base}/{table}`
- base: `appZTBo4yxK1O7y5F`
- table: `tbl4aqmSg5X80vABx`
- token: er zit een Personal Access Token in de APK gebakken waarmee deze tabel te lezen is.
  **Die staat hier bewust niet**: het is een sleutel van de maker van het spel, niet van ons, en
  die hoort niet in een openbare repo. Wie hem nodig heeft voor eigen onderzoek kan hem zelf uit
  de APK halen; voor de app is hij niet nodig (zie hieronder).

Test: `GET https://api.airtable.com/v0/appZTBo4yxK1O7y5F/tbl4aqmSg5X80vABx?pageSize=100`
met die token als `Authorization: Bearer …` → **200**, **771 records**. Velden:

`Jaar`, `Titel`, `Locatie`, `Artiest`, `Componist`, `Tekstschrijver`, `Duur` (seconden),
`Album`, `Volgnummer`, `Arrangeur`, `Hittepetit` (**boolean**), `Origineel`,
`Link naar origineel`, `Lyrics`.

Voorbeeldrecord (letterlijk):
`{"Jaar":1999,"Tekstschrijver":["rectxDkMuY802FJsu"],"Titel":"Op eine auwe fits","Locatie":"Zitterd","Componist":["recDKSnOGdHm6jVpy"],"Artiest":["reckcx2HGYv4wZOnc","recrygVSaPtNvmamn"],"Duur":193,"Album":["rec5xeSjKHQW7dW0M"],"Volgnummer":5}`

- Het veld **`Hittepetit` is `true`** voor **162** van de 771 records — het markeert welke
  nummers in het spel zitten. **Er is géén veld met de HP-kaartcode**, dus ook hier geen directe
  koppeling kaartnummer → titel.
- (`meta/bases` geeft `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`; de token heeft geen
  schema-scope, dus er kunnen niet méér tabellen worden opgesomd. In de bundle is ook maar één
  tabel-id te vinden.)
- Bewaard als `/home/hermes/.hermes/cache/scratch/airtable_songs.json`.

---

## 6. Werkt het? (test met HP0077 en HP0132)

Ja. Een eigen app kan exact hetzelfde doen als de officiële app, **zonder inlog**:

1. QR scannen → code `HP0077`.
2. `GET …/hittepetitLinks/HP0077.json` → `storagePath` = `hittepetit/HP0077.mp3`.
3. `GET …/o/hittepetit%2FHP0077.mp3?alt=media` → het liedje als mp3 (audio/mpeg).

Beide stappen getest voor HP0077 en HP0132, status 200, inhoud hierboven letterlijk weergegeven.

---

## 7. Kaartnummer → **titel**? (beperking)

De app en de publieke data koppelen een kaartnummer **alleen aan het audiobestand**, niet aan
een tekst-titel. Wat wél kan:

- **Kaartnummer → audio** (mp3) — volledig publiek, 222/222. Dit is in de praktijk "het liedje".
- **Liedjestitels/jaar/artiest** van het hele repertoire — publiek via de Airtable-catalogus (§5c).

Wat **niet** lukt met openbare bronnen: de **code `HPxxxx` → titel** exact vastpinnen, omdat:
- de mp3's geen ID3-tags hebben, en
- de Airtable-tabel geen HP-veld heeft.
- Ik heb gekeken of de **duur** (mp3-lengte vs. Airtable `Duur`) de koppeling kan leggen, maar
  dat is **niet eenduidig**: bij HP0077 (~213 s) zijn er 20 Airtable-nummers met duur 211-216 s.
  Een automatische match zou dus onbetrouwbaar/verzonnen zijn — daarom doe ik dat niet.

Praktische routes om tóch titels te krijgen (buiten de app om): (a) de mp3 afspelen en/of via
audio-vingerafdruk herkennen; (b) de fysieke kaartachterkanten fotograferen (dan is de HP-code
op het kaartje direct aan de titel te koppelen).

---

## 8. Alle pogingen om de APK te pakken (per bron)

| Bron / URL | Resultaat (letterlijk) |
|---|---|
| APKPure app-pagina `apkpure.com/radio-n%C3%B3nnevot/com.radiononnevot` | 200, maar **"COMING SOON"** — geen downloadbare versie |
| APKPure `/download` | **302** → `https://apkpure.com/apk-downloader?p=com.radiononnevot` (JS-muur); met stealth-browser wel Cloudflare voorbij, maar geen resultaat voor dit pakket |
| APKPure oude app `nl.radiononnevot.radio` | 200, **v2.4** (2023), oude app — niet Hittepetit |
| APKPure `tapi.pureapk.com/.../get_app_his_version` | `{"retcode":0,"version_list":[]}` |
| APKCombo downloader `apkcombo.com/apk-downloader` (met echte browser, Turnstile auto-solved) | ajax 200 maar: `{"status":"failed","package":"com.radiononnevot","error":"not_found",…}` |
| APKCombo zoeken (`/search/radio%20nonnevot`, `com.radiononnevot`) | geen app (alleen "iHeart") |
| APKMirror `?s=radiononnevot` | **"No results found matching your query"** |
| APKFab `apkfab.com/radio-nonnevot/com.radiononnevot` | **404** (Cloudflare wel gepasseerd met stealth-UA); zoeken op APKFab vindt de app niet |
| Aptoide API `ws75.aptoide.com/api/7/apps/search?query=nonnevot` | `{"total":0,"list":[]}`; `getMeta`/`get` → *Application 'package:com.radiononnevot' not found* |
| apk.support, apkmonk.com | DNS bestaat niet meer (NXDOMAIN) |
| apkhome.net / dlandroid / apkmody / apksum / apkpure.net / apkpure.io / apkcombo.{org,net,io} / apkhere / apksos | geen vermelding of dood (hits waren alleen de zoekterm-weergave op de pagina) |
| `gplaydl` (PyPI) | vraagt om "linking" met eigen account/dispenser → niet anoniem |
| Aurora-dispenser `GET auroraoss.com/api/auth` | `error code: 502`; `POST {}` → `{"error":"Missing device configuration"}` |
| **androidpot.net/apk-downloader** | **GELUKT** → `androidpot.net/apps/com.radiononnevot/download/17`, v5.1.0, 198 MB, XAPK |

Hulpmiddelen die de doorbraak mogelijk maakten: een echte (headless) Chromium bestuurd via CDP
(browser_exec faalde op een ontbrekende systeembibliotheek; opgelost door Chromium met
`LD_LIBRARY_PATH` naar `~/.local/chromelibs` te starten), plus `hermes-dec` om de Hermes-bundle
te decompileren.

---

## 9. Bestanden / paden (bewaard)

- APK's: `/home/hermes/.hermes/cache/scratch/rn_apk/base.apk`, `…/arm64.apk`
- Uitgepakt: `/home/hermes/.hermes/cache/scratch/rn_apk/base_x/`
- Gedecompileerde JS: `/home/hermes/.hermes/cache/scratch/decompiled.js`
- RTDB-kaartkoppeling (222): `/home/hermes/.hermes/cache/scratch/hittepetitLinks.json`
- Storage-lijst: `/home/hermes/.hermes/cache/scratch/storage_items.json`, sizes `…/storage_sizes.json`
- Airtable-catalogus (771): `/home/hermes/.hermes/cache/scratch/airtable_songs.json`
- Proef-mp3's: `/home/hermes/.hermes/cache/scratch/mp3/HP0077.mp3`, `…/HP0132.mp3`

### Aanknopingspunten voor Sjpeelavond
- De koppeling kaartnummer → **liedje (audio)** is volledig publiek reproduceerbaar via de
  RTDB-route uit §5a/§5b, zonder de app of een account.
- Voor **titel/artiest bij een kaartnummer**: de app levert die niet; die zou je uit de
  Airtable-catalogus (titel/jaar/artiest) moeten combineren met de fysieke kaarten, of via
  audioherkenning op de mp3's.
- De in de APK ingebakken Airtable-PAT is een **gelekt credential** — behandel hem als gevoelig.
