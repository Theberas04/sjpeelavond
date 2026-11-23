/**
 * zeef-limburg.mjs — haalt ruis uit de Deezer-oogst van het Limburgse repertoire.
 *
 * Waarom: bij het zoeken op trefwoorden geeft Deezer ook liedjes terug die er taalkundig
 * op lijken maar er niets mee te maken hebben. 'LVK' levert de bandjes LVKE en LVKS! op,
 * 'Zittesj' levert Duitse liedjes met 'zittern' in de tekst (vier keer de Matthäus-Passion),
 * en een artiestennaam die op een Limburgse artiest lijkt matcht soms een wereldster:
 * 'Roger Pisters' werd Roger Waters (30 nummers), 'Rowwen Hèze' werd 3js.
 *
 * Aanpak: één expliciete zeeflijst met artiesten die er níet in horen. Al het overige blijft
 * staan — de lijst is met de hand door de volledige artiestenlijst gelopen, dus wat er niet
 * op staat is bewust goedgekeurd. Zo kan een nieuwe oogst geen rommel terugbrengen.
 *
 *   node scripts/zeef-limburg.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BRON = new URL('../data/bron/limburg-ruw.json', import.meta.url);
const UIT = new URL('../data/bron/limburg-schoon.json', import.meta.url);

// Artiesten die niet in een Limburgs/vastelaovesrepertoire horen: buitenlandse pop, rap,
// klassiek en de verkeerde matches van Deezer. Alles hier is één voor één nagelopen.
const WEG = new Set(
  [
    // verkeerde match van een Limburgse naam naar een bekende artiest
    'Roger Waters', '3js', 'Neeskens', 'CesTenS', 'Josie Gillen', 'Syb van der Ploeg',
    'Suzan Seegers', 'Peter Holtslag', 'Artiom Goralsky', 'Demusmaker',
    'ICI TOUT COMMENCE', 'Lonely in the Rain',
    // 'LVK' als zoekterm: bandjes die op de afkorting lijken
    'LVK', 'LVKE', 'LVKS!', 'Lvkka Boy', 'lvkeish', 'Lvke The Artist', 'envrac', 'LVF', 'Lvl1',
    'LVD', 'LESTEF KJF BOYZ', 'LMK', 'LJK', 'Le K', 'LGZ_03', 'LACAZETTE', 'Kmat', 'Lsk', 'Lfk',
    // 'Zittesj'/'zit' als zoekterm: Duitse en klassieke liedjes met 'zittern' erin
    'Horst Laubenthal', 'Nikolaus Harnoncourt', 'Philippe Herreweghe', 'Raphaël Pichon',
    'Für Nichts Nach Bonn', 'HWZ', 'Jasmina Oder', 'KDM Shey', 'Liser', 'Patent Ochsner',
    'Rap La Rue', 'Rooky030', 'Rosa Anschütz', 'Scheppertus', 'SDP', 'SEBO TALLAVA',
    'Sosa_offiziell', 'Stimmhorn', 'Triorität', 'Yu', 'Zillertaler Schürzenjager', 'Zitten',
    'Melokind',
    // overige buitenlandse pop, rap en klassiek
    '24k.Right', '410', 'Arca', 'Atomic Spliff', 'Aït Menguellet', 'Biga*Ranx', 'Bobby Krlic',
    'Booba', 'Brown Joel', 'Carson Coma', 'Cartel Mcs', 'Chief Obi', 'Club Unicorn',
    'Daddy Mory', 'Dardan', 'Djexon', 'DJ Gil', 'Hasan Ozsut', 'Himra', 'J Balvin', 'Kelela',
    'Key Largo', 'Killerbarbacoa', "L'Entourloop", 'LetoDie', 'Lil Kleine', 'Lil Xxel', 'Luk',
    'manifest', 'Marc Segui', 'Mene', 'MIK', 'mietze conte', 'Molec', 'Motive', 'Mr Vegas',
    'Napoli Centrale', 'Naps', 'Nebrugg', 'Nightmares on Wax', 'Nuttea', 'Oum', 'Philip',
    'Qendresa', 'Relo', 'Rexxie', 'ROZZZQWEEN', 'Saamou', 'Shotas', 'Sleyfa', 'Steel Pulse',
    'Suuns', 'Taggy Matcher', 'Tayc', 'Team Scheisse', 'The Opposites', 'the Phit', 'Tigre',
    'U2', 'Valsbezig', 'Victor Mendivil', 'X-Man', 'YON!', 'Zonmai',
    // Nederlandstalig, maar geen Limburgs of vastelaovesrepertoire
    'André Rieu', 'Bløf', 'De Cast van \'t Schaep In Mokum', 'De Gouden Nachtegaaltjes',
    'De Poema\'S', 'Def Rhymz', 'Normaal', 'Rambo\'s', 'Sesamstraat', 'Yentl en de Boer',
  ].map((a) => a.toLowerCase()),
);

const ruw = JSON.parse(readFileSync(BRON, 'utf8'));
const nummers = ruw.nummers || ruw;
const schoon = nummers.filter((n) => !WEG.has(String(n.artiest || '').toLowerCase()));
const weg = nummers.length - schoon.length;

const perArtiest = {};
for (const n of schoon) perArtiest[n.artiest] = (perArtiest[n.artiest] || 0) + 1;

writeFileSync(
  UIT,
  `${JSON.stringify(
    {
      bron: 'Deezer (zoek-API) via scripts/haal-limburg.mjs',
      bewerkt: 'scripts/zeef-limburg.mjs — ruis van gelijkende trefwoorden eruit gefilterd',
      opgehaald: ruw.opgehaald || '',
      aantal: schoon.length,
      weggefilterd: weg,
      artiesten: Object.entries(perArtiest)
        .sort((a, b) => b[1] - a[1])
        .map(([naam, aantal]) => ({ naam, aantal })),
      nummers: schoon,
    },
    null,
    0,
  )}\n`,
);

console.log(`${nummers.length} nummers gelezen, ${weg} weggefilterd, ${schoon.length} over`);
console.log(`artiesten: ${Object.keys(perArtiest).length}`);
console.log(`geschreven: data/bron/limburg-schoon.json`);
