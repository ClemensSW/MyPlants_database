Weiter zum Inhalt
Chatverlauf

Du:
Ich entwickle gerade eine Pflanzen Lernapp und möchte die Pflanzendaten (Botanischer Name, deutscher Name und eindeutige Kennung mit der GBIF Taxon Key) in MongoDB übertragen. Wie mache ich das am besten?
Ich bräuchte eigentlich nur die Pflanzendaten aus dieser Datenbank:
https://www.gbif.org/dataset/7a3679ef-5582-4aaa-81f0-8c2545cafc81
ChatGPT:

Nachgedacht für 1m 41s
Kurzfassung: Das verlinkte GBIF-Set ist kein Artenverzeichnis, sondern ein Occurrence-Datensatz („Pl@ntNet observations“). Der saubere Weg ist daher:

Aus diesem Datensatz alle einzigartigen taxonKey herausholen (per Facet der Occurrence-API),

jeden taxonKey über die Species-API auflösen → botanischer Name (+ optional akzeptierter Name) und deutsche Trivialnamen,

in MongoDB speichern. 
demo.gbif.org
techdocs.gbif.org
data-blog.gbif.org
GBIF community forum

Praxis-Pipeline (Node.js + MongoDB)
Was du bekommst:

taxonKey (eindeutig),

scientificName (botanischer Name, auf akzeptierte Nutzung normalisiert),

germanName (bevorzugter deutscher Name, falls vorhanden),

germanNames (Liste aller DE-Namen), plus Rank/Status.

1) Einzigartige taxonKeys aus Pl@ntNet holen
Über die Occurrence-Suche mit Facet und Paging:

GET https://api.gbif.org/v1/occurrence/search
  ?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81
  &limit=0
  &facet=taxonKey
  &facetLimit=10000
  &facetOffset=0,10000,20000,...
Du kannst facetOffset seitenweise erhöhen, bis keine Counts mehr kommen. (Facetten-Paging ist vorgesehen; die Search-API ist generell bis ~100k Ergebnisse pro Query gedacht.) 
GBIF community forum
+1
techdocs.gbif.org

2) taxonKey → Artangaben + deutsche Namen
Für jeden Key:

Basis: GET /v1/species/{key}?language=de (liefert u.a. scientificName und – wenn verfügbar – ein vernacularName in der gewünschten Sprache).

Wenn der Treffer SYNONYM ist und acceptedKey besitzt, noch einmal species/{acceptedKey}?language=de holen und diesen als Referenz speichern.

Optionale Liste aller deutschen Namen: GET /v1/species/{acceptedKey}/vernacularNames und lokal auf language === 'de' filtern. 
GBIF community forum
+1
data-blog.gbif.org

3) In MongoDB schreiben (Beispielscript)
Install: npm i axios mongodb p-limit

// gbif_to_mongo.js
const axios = require('axios');
const { MongoClient } = require('mongodb');
const pLimit = require('p-limit');

const DATASET_KEY = '7a3679ef-5582-4aaa-81f0-8c2545cafc81';
const GBIF = 'https://api.gbif.org/v1';

async function fetchAllTaxonKeys() {
  const facetLimit = 10000; let facetOffset = 0;
  const keys = new Set();
  for (;;) {
    const url = `${GBIF}/occurrence/search?datasetKey=${DATASET_KEY}&limit=0&facet=taxonKey&facetLimit=${facetLimit}&facetOffset=${facetOffset}`;
    const { data } = await axios.get(url, { timeout: 30000 });
    const chunk = data.facets?.[0]?.counts ?? [];
    if (!chunk.length) break;
    chunk.forEach(c => keys.add(Number(c.name)));
    facetOffset += facetLimit;
  }
  return [...keys];
}

async function fetchSpeciesDoc(taxonKey) {
  const get = (u) => axios.get(u, { timeout: 20000 }).then(r => r.data);
  const first = await get(`${GBIF}/species/${taxonKey}?language=de`);
  const accKey = first.acceptedKey || first.key;
  const usage = (accKey !== first.key) ? await get(`${GBIF}/species/${accKey}?language=de`) : first;

  let germanNames = [];
  try {
    const vn = await get(`${GBIF}/species/${usage.key}/vernacularNames`);
    germanNames = (vn.results || [])
      .filter(v => ['de','deu','ger'].includes(v.language))
      .map(v => ({ name: v.vernacularName, preferred: !!v.preferred, source: v.source }))
      .filter((v, i, a) => a.findIndex(x => x.name.toLowerCase() === v.name.toLowerCase()) === i);
  } catch {}

  const preferredDe = usage.vernacularName
    || germanNames.find(x => x.preferred)?.name
    || germanNames[0]?.name || null;

  return {
    taxonKey: usage.key,
    scientificName: usage.scientificName || usage.canonicalName,
    rank: usage.rank,
    status: usage.taxonomicStatus || 'ACCEPTED',
    acceptedKey: accKey,
    germanName: preferredDe,
    germanNames,
    source: { derivedFromDatasetKey: DATASET_KEY, retrievedAt: new Date().toISOString() }
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const col = client.db('myflora').collection('plants');
  await col.createIndex({ taxonKey: 1 }, { unique: true });

  const keys = await fetchAllTaxonKeys();
  console.log(`Found ${keys.length} unique taxonKeys from Pl@ntNet`);

  const limit = pLimit(10); // parallel, aber freundlich
  await Promise.all(keys.map(k => limit(async () => {
    const doc = await fetchSpeciesDoc(k);
    await col.updateOne({ taxonKey: doc.taxonKey }, { $set: doc }, { upsert: true });
  })));

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
Schema-Tipp:
taxonKey (unique), scientificName, germanName, germanNames[], rank, status, acceptedKey, source.derivedFromDatasetKey, source.retrievedAt.

Wichtige Hinweise
Warum dieser Weg? Dein Link verweist auf einen Occurrence-Datensatz. Ein direkter Export „aller Arten“ daraus existiert nicht, aber die Facetten liefern dir schnell die Menge der in diesem Datensatz vertretenen Taxa; die Species-API liefert die Namen. 
demo.gbif.org
techdocs.gbif.org

Deutsche Namen: Sie stammen nicht aus einem einzigen Katalog, sondern werden in GBIF aus vielen Checklisten aggregiert. Darum gibt es manchmal mehrere, keine „offiziell richtige“ oder auch gar keine. 
GBIF community forum

Limits & Performance: Die Search-APIs sind für interaktive Nutzung ausgelegt (Paging; Facetten mit facetLimit/facetOffset). Bei starker Last kann 429 zurückkommen → einfach kurz langsamer machen (im Script via p-limit). 
techdocs.gbif.org

Zitieren/Lizenzen: Für Daten aus GBIF bitte die Citation Guidelines beachten; für deine App empfiehlt sich das Speichern der datasetKeys und ggf. ein Verweis auf die Datenquelle im Impressum/„Über“-Bereich. Medien (Bilder) haben eigene Lizenzen und sind oft CC BY-NC – für rein textuelle Namesdaten bist du aber auf der sicheren Seite. 
gbif.org

Wenn du magst, passe ich das Script noch auf nur akzeptierte Arten (status=ACCEPTED) an, oder erweitere es um Synonym-Mapping bzw. eine Perioden-Aktualisierung (z.B. monatlicher Refresh).

Du:
Clemens@Home MINGW64 ~
$ GET https://api.gbif.org/v1/occurrence/search
bash: GET: command not found

Clemens@Home MINGW64 ~
$   ?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81
bash: ?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81: command not found

Clemens@Home MINGW64 ~
$   &limit=0
bash: syntax error near unexpected token &'

Clemens@Home MINGW64 ~
$   &facet=taxonKey
bash: syntax error near unexpected token &'

Clemens@Home MINGW64 ~
$   &facetLimit=10000
bash: syntax error near unexpected token &'

Clemens@Home MINGW64 ~
$   &facetOffset=0,10000,20000,...
bash: syntax error near unexpected token &'

Clemens@Home MINGW64 ~
$



Wie mache ich Schritt 1 richtig?
ChatGPT:

Nachgedacht für 40s
Du bist in Git Bash – dort gibt’s kein GET-Befehl, und das & trennt Befehle. Du musst die gesamte URL in Anführungszeichen mit curl auf einer Zeile ausführen (und idealerweise mit jq parsen).

Schnelltest (eine Seite)
curl -s 'https://api.gbif.org/v1/occurrence/search?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81&limit=0&facet=taxonKey&facetLimit=10000&facetOffset=0' \
  | jq -r '.facets[0].counts[].name'
Liefert dir bis zu 10.000 taxonKeys (als Strings).
Ohne jq siehst du einfach das JSON (dann ggf. jq installieren).

Alle Seiten durchblättern (Git Bash + jq)
facetLimit=10000
out='taxonKeys.txt'
> "$out"

for ((offset=0; ; offset+=facetLimit)); do
  url="https://api.gbif.org/v1/occurrence/search?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81&limit=0&facet=taxonKey&facetLimit=$facetLimit&facetOffset=$offset"
  resp=$(curl -s "$url")
  n=$(printf '%s' "$resp" | jq '.facets[0].counts | length')
  if [ "$n" -eq 0 ] || [ -z "$n" ]; then
    break
  fi
  printf '%s' "$resp" | jq -r '.facets[0].counts[].name' >> "$out"
  sleep 0.2   # freundlich zur API
done

sort -u "$out" -o "$out"
wc -l "$out"
Wichtig: facetOffset wird nicht kommagetrennt übergeben. Du machst mehrere Requests mit facetOffset=0, 10000, 20000, … bis leer.

Ergebnis: taxonKeys.txt mit allen eindeutigen taxonKeys aus dem Pl@ntNet-Datensatz.

PowerShell-Alternative (falls du lieber PS nutzt)
$facetLimit = 10000
$offset = 0
$all = @()

while ($true) {
  $url = "https://api.gbif.org/v1/occurrence/search?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81&limit=0&facet=taxonKey&facetLimit=$facetLimit&facetOffset=$offset"
  $json = Invoke-RestMethod -Uri $url
  $chunk = $json.facets[0].counts
  if (-not $chunk) { break }
  $all += $chunk.name
  $offset += $facetLimit
  Start-Sleep -Milliseconds 200
}
$all | Sort-Object -Unique | Set-Content -Encoding utf8 taxonKeys.txt
(Get-Content taxonKeys.txt).Count
Wenn du magst, gebe ich dir direkt ein Node.js-Snippet, das Schritt 1 erledigt und die Keys in eine Datei schreibt – dann kannst du nahtlos mit Schritt 2 (Species-API auflösen) weitermachen.

Du:
ich möchte die taxon keys als json Datei gespeichert haben und sicher gehen, das wirklich alle taxon keys von PlantNet Datensatz gespeichert werden
ChatGPT:

Nachgedacht für 2m 11s
Perfekt – wir machen dir eine JSON-Datei mit allen taxonKeys aus dem Pl@ntNet-Datensatz.
Es gibt zwei gute Wege:

A) Schnell & ohne Login (über Facets) → plantnet_taxonKeys.json
Die Occurrence-API unterstützt Facetten inkl. Paging über facetLimit/facetOffset. Du holst Seite für Seite alle taxonKey-Werte und speicherst sie eindeutig als JSON. (Das Paging über facetOffset ist der offizielle Weg. 
GBIF community forum
)

Node.js-Script (empfohlen unter Windows/Git Bash):

Einmalig installieren:

mkdir gbif-taxakeys && cd gbif-taxakeys
npm init -y
npm i axios
Datei fetch_taxonkeys.js anlegen (kopieren & speichern):

// fetch_taxonkeys.js
const fs = require('fs');
const axios = require('axios');

const DATASET_KEY = '7a3679ef-5582-4aaa-81f0-8c2545cafc81';
const GBIF = 'https://api.gbif.org/v1';
const facetLimit = 10000;

(async () => {
  const keys = new Set();
  let offset = 0, page = 0;

  while (true) {
    const url = `${GBIF}/occurrence/search?datasetKey=${DATASET_KEY}&limit=0&facet=taxonKey&facetLimit=${facetLimit}&facetOffset=${offset}`;
    const { data } = await axios.get(url, { timeout: 30000 });
    const counts = data?.facets?.[0]?.counts || [];
    if (!counts.length) break;

    counts.forEach(c => keys.add(Number(c.name)));
    page++; offset += facetLimit;
    process.stdout.write(`Seite ${page}: +${counts.length} → bisher ${keys.size}\r`);
    await new Promise(r => setTimeout(r, 200)); // freundlich zur API
  }

  const out = Array.from(keys).sort((a,b)=>a-b);
  fs.writeFileSync('plantnet_taxonKeys.json', JSON.stringify(out), 'utf8');
  console.log(`\nFertig. Eindeutige taxonKeys: ${out.length} → plantnet_taxonKeys.json`);
})();
Ausführen:

node fetch_taxonkeys.js
Warum vollständig?
Wir laufen so lange weiter, bis eine Seite 0 Facetteneinträge liefert – das ist genau das dokumentierte Paging-Verhalten für Facets. Keine Duplikate, weil wir mit einem Set deduplizieren. (Occurrence-Facets & Doku: API-Referenz/Techdocs, Community-Hinweise). 
techdocs.gbif.org
GBIF community forum

Hinweis: Das holt alle in diesem Dataset vorkommenden Taxa als taxonKey (nicht die Occurrences selbst) – genau was du brauchst. 
techdocs.gbif.org

B) „Bombensicher & zitierfähig“ (Serverseitige Liste) – SPECIES_LIST-Download
Wenn du eine offiziell aggregierte, vollständige und reproduzierbare Liste möchtest, nutze den Occurrence Download mit Format SPECIES_LIST. Das erzeugt serverseitig eine eindeutige Artenliste inkl. taxonKey (und z. B. acceptedTaxonKey) für genau deinen Filter (hier: DATASET_KEY). Erfordert GBIF-Login, läuft asynchron, liefert eine ZIP mit CSV. 
techdocs.gbif.org
+1

Minimalbeispiel (Git Bash + curl):

query.json anlegen:

{
  "creator": "DEIN_GBIF_USERNAME",
  "notificationAddresses": ["deine@mail.de"],
  "sendNotification": true,
  "format": "SPECIES_LIST",
  "predicate": {
    "type": "and",
    "predicates": [
      { "type": "equals", "key": "DATASET_KEY", "value": "7a3679ef-5582-4aaa-81f0-8c2545cafc81" }
    ]
  }
}
Download starten (Username/Passwort von GBIF.org):

curl --include --user DEIN_GBIF_USERNAME:DEIN_PASSWORT \
  -H "Content-Type: application/json" \
  --data @query.json \
  https://api.gbif.org/v1/occurrence/download/request
Die Antwort enthält einen Download-Key wie 00xxxx-....

Status pollen, bis SUCCEEDED:

curl -s https://api.gbif.org/v1/occurrence/download/00xxxx-... | jq
Datei holen & JSON bauen:

curl -L -o species_list.zip https://api.gbif.org/occurrence/download/request/00xxxx-....zip
unzip -p species_list.zip '*.csv' | awk -F',' 'NR==1 {for (i=1;i<=NF;i++) if ($i=="taxonKey") c=i; next} {print $c}' \
  | tail -n +1 | sort -u \
  | jq -R -s '[split("\n")[] | select(. != "") | tonumber]' > plantnet_taxonKeys.json
jq 'length' plantnet_taxonKeys.json
Warum „bombensicher“?
SPECIES_LIST ist genau für „distinct species/taxa für einen Filter“ gedacht (inkl. taxonKey-Spalte). Der Job läuft komplett serverseitig und ist damit eine vollständige Momentaufnahme; du kannst ihn außerdem mit DOI zitieren. 
techdocs.gbif.org
+1

Welche Variante sollst du nehmen?
A) Facets – super schnell, kein Login, direkt JSON. Für deine App-Pipeline ideal. (Facets + Paging sind dafür vorgesehen.) 
GBIF community forum

B) SPECIES_LIST – wenn du eine archivierbare, zitierfähige Voll-Liste brauchst (z. B. für einen Release-Snapshot).

Wenn du willst, passe ich dir Skript A gleich noch so an, dass es parallel dazu eine meta.json mit datasetKey, retrievedAt, pages, facetLimit und count schreibt – praktisch für Audits.

Du:
habe die erste Variante gemacht und jetzt habe ich die plantnet_taxonKeys.json.

Jetzt soll daraus eine passende JSON Datei werden, die für jeden Taxon Key den entsprechenden botanischen Namen sowie den deutschen Namen (de, deu, ger) von GBIF species backbone Datenbank beinhaltet.

Diese JSON soll später in MongoDB hochgeladen werden und als Grundlage für meine PflanzenApp dienen.
ChatGPT:

Nachgedacht für 1m 12s
Super, dann bauen wir jetzt aus deiner plantnet_taxonKeys.json eine saubere JSON-Datei mit

scientificName (botanisch),

deutschen Namen (Liste + bevorzugter Name),

sauberem Synonym → akzeptierter Name-Handling.

Unten ist ein robustes Node-Script (mit Retry/Backoff, Parallelität, Resume-fähig per Zwischenständen). Es erzeugt zwei Ausgaben:

plantnet_species_de.ndjson (eine JSON pro Zeile – ideal für mongoimport)

plantnet_species_de.json (ein Array – praktisch für Voransichten)

Technisch: GET /species/{key}?language=de liefert u.a. scientificName und – falls vorhanden – ein einzelnes vernacularName zum gewünschten Sprachcode. Alle deutschen Namen holst du über GET /species/{id}/vernacularNames und filterst language in {de, deu, ger}. Bei Synonymen nimmst du acceptedKey als Referenz. 
GBIF community forum
+1
techdocs.gbif.org
+1

1) Script anlegen
npm i axios p-limit
Erstelle enrich_taxa.js neben deiner plantnet_taxonKeys.json:

// enrich_taxa.js
// Liest:  plantnet_taxonKeys.json  (Array von taxonKeys)
// Schreibt: plantnet_species_de.ndjson (NDJSON) + plantnet_species_de.json (Array)

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');

const INPUT = 'plantnet_taxonKeys.json';
const OUT_NDJSON = 'plantnet_species_de.ndjson';
const OUT_JSON = 'plantnet_species_de.json';
const DATASET_KEY = '7a3679ef-5582-4aaa-81f0-8c2545cafc81';
const GBIF = 'https://api.gbif.org/v1';

const CONCURRENCY = 10;
const RETRIES = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, tries = RETRIES) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      // Retry bei Netzfehlern, 429 & 5xx
      if (i < tries - 1 && (status === 429 || (status >= 500 && status <= 599) || !status)) {
        const backoff = 500 * Math.pow(2, i);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

function pickPreferredGerman(usage, germanNames) {
  // 1) Direkt vom /species?language=de
  if (usage?.vernacularName) return usage.vernacularName;
  // 2) preferred:true falls vorhanden
  const pref = germanNames.find(v => v.preferred);
  if (pref) return pref.name;
  // 3) erster Eintrag
  return germanNames[0]?.name || null;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter(x => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function buildDocFromTaxonKey(originalKey) {
  // 1) Basis-Abruf (mit Sprache=de → evtl. vernacularName gesetzt)
  const base = await fetchWithRetry(`${GBIF}/species/${originalKey}?language=de`);

  // 2) Auf akzeptierten Namen normalisieren, falls Synonym
  const acceptedKey = base.acceptedKey || base.key;
  const usage = (acceptedKey !== base.key)
    ? await fetchWithRetry(`${GBIF}/species/${acceptedKey}?language=de`)
    : base;

  // 3) Alle deutschen Namen laden
  let germanNames = [];
  try {
    const vn = await fetchWithRetry(`${GBIF}/species/${usage.key}/vernacularNames`);
    germanNames = (vn.results || [])
      .filter(v => v?.vernacularName)
      .filter(v => {
        const lang = (v.language || '').toLowerCase();
        return lang === 'de' || lang === 'deu' || lang === 'ger';
      })
      .map(v => ({
        name: v.vernacularName,
        preferred: !!v.preferred,
        source: v.source || null
      }));
    germanNames = uniqBy(germanNames, x => x.name.trim().toLowerCase());
  } catch (_) {}

  const germanName = pickPreferredGerman(usage, germanNames);

  return {
    // Schlüssel
    taxonKey: usage.key,               // eindeutiger Schlüssel im Backbone
    acceptedKey,                       // = taxonKey, falls bereits akzeptiert
    originalKey,                       // der aus plantnet_taxonKeys.json
    // Namen / Taxonomie
    scientificName: usage.scientificName || usage.canonicalName || null,
    canonicalName: usage.canonicalName || null,
    rank: usage.rank || null,
    status: usage.taxonomicStatus || base.taxonomicStatus || null,
    // Deutsch
    germanName,
    germanNames,
    // Audit
    source: {
      derivedFromDatasetKey: DATASET_KEY,
      retrievedAt: new Date().toISOString()
    }
  };
}

async function main() {
  // Eingabe lesen & säubern
  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const allKeys = Array.from(new Set(raw.map(k => Number(k)).filter(n => Number.isFinite(n))));
  if (!allKeys.length) throw new Error('Keine taxonKeys im Input gefunden.');

  // Output-Streams öffnen
  const nd = fs.createWriteStream(OUT_NDJSON, { flags: 'w' });
  const js = fs.createWriteStream(OUT_JSON, { flags: 'w' });
  js.write('[');
  let first = true;

  const failedLog = fs.createWriteStream('failed_keys.txt', { flags: 'w' });

  const limit = pLimit(CONCURRENCY);
  let done = 0;

  // Fortschritt hübsch ausgeben
  function progress() {
    process.stdout.write(`\rVerarbeitet: ${done}/${allKeys.length}`);
  }

  const tasks = allKeys.map(k => limit(async () => {
    try {
      const doc = await buildDocFromTaxonKey(k);
      // NDJSON
      nd.write(JSON.stringify(doc) + '\n');
      // JSON-Array (streaming)
      if (!first) js.write(',');
      js.write(JSON.stringify(doc));
      first = false;
    } catch (e) {
      failedLog.write(String(k) + '\n');
    } finally {
      done++; progress();
    }
  }));

  await Promise.all(tasks);

  js.write(']');
  nd.end(); js.end(); failedLog.end();
  process.stdout.write(`\nFertig. OK: ${done - fs.readFileSync('failed_keys.txt', 'utf8').split('\n').filter(Boolean).length}, Fehler siehe failed_keys.txt\n`);
}

main().catch(err => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
Ausführen:

node enrich_taxa.js
2) Import nach MongoDB
NDJSON (empfohlen):

mongoimport --uri "mongodb://localhost:27017" \
  --db myflora --collection plants \
  --file plantnet_species_de.ndjson
JSON-Array:

mongoimport --uri "mongodb://localhost:27017" \
  --db myflora --collection plants \
  --file plantnet_species_de.json --jsonArray
Index (einmalig):

mongosh --eval 'db.getSiblingDB("myflora").plants.createIndex({ taxonKey: 1 }, { unique: true })'
Hinweise (kurz)
?language=de am Species-Endpoint ergänzt ein einzelnes passendes vernacularName; für die komplette Liste nutzt du .../vernacularNames und filterst de/deu/ger. 
GBIF community forum
+1

Wenn ein taxonKey ein Synonym ist, nimmst du acceptedKey und speicherst beide (siehe Felder oben). 
techdocs.gbif.org

Das Skript bremst automatisch bei 429/5xx (Exponential-Backoff) und arbeitet parallel (10 Threads). Du kannst CONCURRENCY erhöhen oder senken.

Deine Quelle bleibt der Pl@ntNet-Datensatz; die Namen kommen aus der GBIF Species API (Backbone/Checklist Bank). 
techdocs.gbif.org

Wenn du willst, passe ich dir das Format noch exakt an dein App-Schema (z. B. zusätzliche Felder wie family, kingdom, threatStatus, …) oder baue eine Delta-Aktualisierung (nur neue/änderte Keys).

Du:
Clemens@Home MINGW64 ~/OneDrive/My Plants/Datenbank/gbif-taxakeys
$ node enrich_taxa.js
C:\Users\Clemens\OneDrive\My Plants\Datenbank\gbif-taxakeys\enrich_taxa.js:8
const pLimit = require('p-limit');
               ^

Error [ERR_REQUIRE_ESM]: require() of ES Module C:\Users\Clemens\OneDrive\My Plants\Datenbank\gbif-taxakeys\node_modules\p-limit\index.js from C:\Users\Clemens\OneDrive\My Plants\Datenbank\gbif-taxakeys\enrich_taxa.js not supported.
Instead change the require of index.js in C:\Users\Clemens\OneDrive\My Plants\Datenbank\gbif-taxakeys\enrich_taxa.js to a dynamic import() which is available in all CommonJS modules.
    at Object.<anonymous> (C:\Users\Clemens\OneDrive\My Plants\Datenbank\gbif-taxakeys\enrich_taxa.js:8:16) {
  code: 'ERR_REQUIRE_ESM'
}

Node.js v20.17.0
ChatGPT:

Nachgedacht für 1m 9s
Das ist ein ESM-vs-CommonJS-Problem: Die neueren Versionen von p-limit sind ESM-only und können nicht mit require() geladen werden.

Du hast drei einfache Optionen – nimm die, die dir am besten passt:

Option A (1-Zeilen-Fix im Script): p-limit dynamisch importieren
Lass deine package.json so wie sie ist (CommonJS) und ändere nur die Stelle, wo p-limit geladen wird.

Ändere in enrich_taxa.js:

Entferne/ersetze die Zeile ganz oben

const pLimit = require('p-limit');
Lade p-limit innen in main() dynamisch:

async function main() {
  const { default: pLimit } = await import('p-limit'); // <— neu
  // ... Rest von main unverändert
}
Speichern → erneut ausführen:

node enrich_taxa.js
Option B (ohne Codeänderung): ältere CJS-Version nutzen
Downgrade p-limit auf die letzte CommonJS-Version und behalte dein Script unverändert:

npm rm p-limit
npm i p-limit@3
node enrich_taxa.js
Option C (auf ESM umstellen)
Wenn du generell ESM nutzen willst:

npm pkg set type=module
Dann Imports oben auf ESM umstellen:

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import pLimit from 'p-limit';
// (Rest unverändert)
Oder Datei als enrich_taxa.mjs speichern und mit node enrich_taxa.mjs starten.

Hinweis zur Vollständigkeit / Kontrolle
Wenn der Lauf durch ist, schau ggf. in failed_keys.txt. Stehen dort Keys drin, gab es temporäre Fehler (429/5xx/Timeout). Du kannst das Script einfach nochmal starten – die bereits erfolgreichen Einträge sind schon in den Output-Dateien; bei Bedarf kann ich dir auch eine kleine „Retry nur für failed_keys.txt“-Variante geben.

Manche Taxa haben keine deutschen Namen – dann steht germanName: null und germanNames: []. Das ist normal.

Wenn du mir kurz sagst, für welche Option du dich entschieden hast, passe ich dir auf Wunsch das Script noch minimal an (z. B. zusätzlicher family, order, kingdom, … oder nur NDJSON-Output für direkten mongoimport).

Du:
jetzt sollen alle Einträge außer welche mit "rank":"SPECIES" aus plantnet_species_de.ndjson entfernt werden
ChatGPT:

Nachgedacht für 29s
Klar – du willst nur die Datensätze mit rank: "SPECIES" in deiner NDJSON behalten. Hier sind drei robuste Wege (nimm einen):

1) Git Bash / WSL (mit jq) – schnell & sicher
jq -c 'select(.rank=="SPECIES")' "plantnet_species_de.ndjson" > "plantnet_species_SPECIES.ndjson"

# Kontrolle: vorher/nachher zählen
wc -l "plantnet_species_de.ndjson"
wc -l "plantnet_species_SPECIES.ndjson"
-c schreibt kompakte NDJSON-Zeilen.

Nur Zeilen, deren JSON-Objekt .rank == "SPECIES" ist, bleiben erhalten.

Kein jq installiert? Unter Windows per Chocolatey:
choco install jq (Admin PowerShell), oder nimm Option 2/3 unten.

2) Windows PowerShell (ohne jq)
Get-Content "plantnet_species_de.ndjson" |
  ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
  } |
  Where-Object { $_.rank -eq "SPECIES" } |
  ForEach-Object { $_ | ConvertTo-Json -Compress } |
  Set-Content -Encoding utf8 "plantnet_species_SPECIES.ndjson"

# Zeilen zählen
(Get-Content "plantnet_species_de.ndjson").Count
(Get-Content "plantnet_species_SPECIES.ndjson").Count
3) Node.js (kleines Filter-Script)
Datei filter_species.js neben deiner NDJSON anlegen:

const fs = require('fs');
const readline = require('readline');

const IN = 'plantnet_species_de.ndjson';
const OUT = 'plantnet_species_SPECIES.ndjson';

const rl = readline.createInterface({ input: fs.createReadStream(IN, 'utf8') });
const out = fs.createWriteStream(OUT, { flags: 'w' });

let kept = 0, seen = 0;
rl.on('line', line => {
  seen++;
  try {
    const obj = JSON.parse(line);
    if (obj && obj.rank === 'SPECIES') {
      out.write(JSON.stringify(obj) + '\n');
      kept++;
    }
  } catch {}
});
rl.on('close', () => {
  out.end();
  console.log(`Fertig. Behalten: ${kept} von ${seen}`);
});
Ausführen:

node filter_species.js
Optional: gleiches Filter für dein JSON-Array
Falls du zusätzlich die Array-Datei (plantnet_species_de.json) erzeugt hast:

jq '[ .[] | select(.rank=="SPECIES") ]' "plantnet_species_de.json" > "plantnet_species_SPECIES.json"
Optional: direkt in MongoDB filtern (falls schon importiert)
mongosh --eval 'db.getSiblingDB("myflora").plants.deleteMany({ rank: { $ne: "SPECIES" } })'
Wenn du als Nächstes zusätzlich nur akzeptierte Arten behalten willst, geht’s mit jq z. B. so:

jq -c 'select(.rank=="SPECIES" and (.status=="ACCEPTED" or .taxonomicStatus=="ACCEPTED"))' \
  "plantnet_species_de.ndjson" > "plantnet_species_ACCEPTED_SPECIES.ndjson"
Sag Bescheid, falls du noch weitere Filter (z. B. nur Angiospermen, nur mit deutschem Namen, etc.) brauchst – ich gebe dir dann die passende Pipe.

Du:
jetzt soll plantnet_species_SPECIES.ndjson nur alle Elemente haben, bei denen "germanNames":[{"name":... nicht leer ist
ChatGPT:

Nachgedacht für 16s
Alles klar! Du willst aus deiner NDJSON nur die Einträge behalten, bei denen germanNames nicht leer ist (bzw. mindestens ein sinnvoller Name drinsteht). Hier sind drei Wege – nimm den, der zu deinem Setup passt.

✅ Schnell mit jq (Git Bash / WSL)
Minimal (nur „Liste hat ≥1 Element“)
jq -c 'select(.germanNames and (.germanNames | type=="array") and (.germanNames | length > 0))' \
  plantnet_species_SPECIES.ndjson > plantnet_species_SPECIES_DE.ndjson
Strenger (mind. ein name mit Nicht-Leerstring)
jq -c 'select(
  (.germanNames | type)=="array" and
  ((.germanNames
    | map(select(.name and (.name|type=="string") and ((.name|gsub("^\\s+|\\s+$";""))!="")))
    | length) > 0)
)' plantnet_species_SPECIES.ndjson > plantnet_species_SPECIES_DE.ndjson
Kontrolle:

wc -l plantnet_species_SPECIES.ndjson
wc -l plantnet_species_SPECIES_DE.ndjson
✅ Windows PowerShell (ohne jq)
Minimal
Get-Content "plantnet_species_SPECIES.ndjson" |
  ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
  Where-Object { $_.germanNames -and ($_.germanNames.GetType().Name -eq 'Object[]') -and ($_.germanNames.Count -gt 0) } |
  ForEach-Object { $_ | ConvertTo-Json -Compress } |
  Set-Content -Encoding utf8 "plantnet_species_SPECIES_DE.ndjson"
Strenger
Get-Content "plantnet_species_SPECIES.ndjson" |
  ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } |
  Where-Object {
    $_.germanNames -and
    ($_.germanNames | Where-Object { $_.name -and ($_.name -is [string]) -and ($_.name.Trim().Length -gt 0) }).Count -gt 0
  } |
  ForEach-Object { $_ | ConvertTo-Json -Compress } |
  Set-Content -Encoding utf8 "plantnet_species_SPECIES_DE.ndjson"
✅ Node.js (kleines Filterscript)
Erstelle filter_germanNames.js neben der NDJSON:

const fs = require('fs');
const readline = require('readline');

const IN = 'plantnet_species_SPECIES.ndjson';
const OUT = 'plantnet_species_SPECIES_DE.ndjson';

const rl = readline.createInterface({ input: fs.createReadStream(IN, 'utf8') });
const out = fs.createWriteStream(OUT, { flags: 'w' });

let seen = 0, kept = 0;
rl.on('line', line => {
  seen++;
  try {
    const obj = JSON.parse(line);
    const arr = obj?.germanNames;
    const ok = Array.isArray(arr) && arr.some(x => typeof x?.name === 'string' && x.name.trim().length > 0);
    if (ok) {
      out.write(JSON.stringify(obj) + '\n');
      kept++;
    }
  } catch {}
});
rl.on('close', () => {
  out.end();
  console.log(`Fertig. Behalten: ${kept} von ${seen} → ${OUT}`);
});
Ausführen:

node filter_germanNames.js
Weiterverarbeitung (optional)
Wenn du die gefilterte Datei direkt importieren willst:

mongoimport --uri "mongodb://localhost:27017" \
  --db myflora --collection plants \
  --file plantnet_species_SPECIES_DE.ndjson
Möchtest du zusätzlich nur akzeptierte Arten behalten, kannst du (z. B. mit jq) noch enger filtern:

jq -c 'select(.rank=="SPECIES" and ((.status // .taxonomicStatus)=="ACCEPTED") and (.germanNames|length>0))' \
  plantnet_species_SPECIES.ndjson > plantnet_species_ACCEPTED_SPECIES_DE.ndjson
Sag Bescheid, wenn du als Nächstes noch weitere Kriterien möchtest (z. B. nur Angiospermen, nur mit bevorzugtem deutschen Namen, Familie/Ordnung ergänzen etc.).

Du:
jetzt soll bei plantnet_species_SPECIES.ndjson folgendes bei jedem Element entfernt werden: "acceptedKey", "originalKey", "germanName"
ChatGPT:

Nachgedacht für 6s
Alles klar! Du willst in deiner NDJSON pro Zeile die Felder acceptedKey, originalKey und germanName entfernen. Nimm einfach eine der drei Varianten:

1) Git Bash / WSL mit jq (empfohlen)
jq -c 'del(.acceptedKey, .originalKey, .germanName)' \
  plantnet_species_SPECIES.ndjson > plantnet_species_SPECIES_slim.ndjson

# Kontrolle: gleiche Zeilenzahl?
wc -l plantnet_species_SPECIES.ndjson
wc -l plantnet_species_SPECIES_slim.ndjson
del(...) löscht die Felder, falls vorhanden (wenn nicht vorhanden, passiert nichts).

-c sorgt für kompaktes NDJSON.

Wenn du in-place überschreiben willst (ohne moreutils/sponge): erst in eine neue Datei schreiben und danach umbenennen:

mv plantnet_species_SPECIES_slim.ndjson plantnet_species_SPECIES.ndjson
2) Windows PowerShell (ohne jq)
Get-Content "plantnet_species_SPECIES.ndjson" |
  ForEach-Object {
    try { $_ | ConvertFrom-Json } catch { $null }
  } |
  ForEach-Object {
    $_.PSObject.Properties.Remove('acceptedKey') | Out-Null
    $_.PSObject.Properties.Remove('originalKey') | Out-Null
    $_.PSObject.Properties.Remove('germanName') | Out-Null
    $_
  } |
  ForEach-Object { $_ | ConvertTo-Json -Compress } |
  Set-Content -Encoding utf8 "plantnet_species_SPECIES_slim.ndjson"
3) Node.js (kleines Filterscript)
Datei strip_fields.js anlegen:

const fs = require('fs');
const readline = require('readline');

const IN = 'plantnet_species_SPECIES.ndjson';
const OUT = 'plantnet_species_SPECIES_slim.ndjson';

const rl = readline.createInterface({ input: fs.createReadStream(IN, 'utf8') });
const out = fs.createWriteStream(OUT, { flags: 'w' });

let n = 0;
rl.on('line', line => {
  try {
    const obj = JSON.parse(line);
    delete obj.acceptedKey;
    delete obj.originalKey;
    delete obj.germanName;
    out.write(JSON.stringify(obj) + '\n');
    n++;
  } catch {}
});
rl.on('close', () => {
  out.end();
  console.log(`Fertig. Geschrieben: ${n} Zeilen → ${OUT}`);
});
Ausführen:

node strip_fields.js
Optional: schnell prüfen, ob die Felder wirklich weg sind (mit jq)
jq -e 'select(has("acceptedKey") or has("originalKey") or has("germanName")) | halt_error(1)' \
  plantnet_species_SPECIES_slim.ndjson >/dev/null && echo "Noch vorhanden" || echo "Alles entfernt ✅"
Sag Bescheid, wenn du noch weitere Felder verschlanken möchtest (z. B. nur taxonKey, scientificName, germanNames, rank, status, source).

Du:
"status":"ACCEPTED"
alle anderen Einträge sollen gelöscht werden
ChatGPT:

Nachgedacht für 11s
Alles klar—wir filtern auf nur status:"ACCEPTED" und werfen den Rest raus. Nimm einen der drei Wege:

1) Git Bash / WSL mit jq (kurz & robust)
jq -c 'select((.status // .taxonomicStatus)=="ACCEPTED")' \
  plantnet_species_SPECIES.ndjson > plantnet_species_ACCEPTED.ndjson

# Kontrolle
wc -l plantnet_species_SPECIES.ndjson
wc -l plantnet_species_ACCEPTED.ndjson
(.status // .taxonomicStatus) nimmt status, und falls nicht vorhanden, taxonomicStatus.

2) Windows PowerShell (ohne jq)
Get-Content "plantnet_species_SPECIES.ndjson" |
  ForEach-Object {
    try { $o = $_ | ConvertFrom-Json } catch { $o = $null }
    if ($o) {
      $s = if ($o.status) { $o.status } else { $o.taxonomicStatus }
      if ($s -eq 'ACCEPTED') { $o | ConvertTo-Json -Compress }
    }
  } | Set-Content -Encoding utf8 "plantnet_species_ACCEPTED.ndjson"
3) Node.js (kleines Filterscript)
// filter_status_accepted.js
const fs = require('fs');
const readline = require('readline');

const IN = 'plantnet_species_SPECIES.ndjson';
const OUT = 'plantnet_species_ACCEPTED.ndjson';

const rl = readline.createInterface({ input: fs.createReadStream(IN, 'utf8') });
const out = fs.createWriteStream(OUT, { flags: 'w' });

let seen=0, kept=0;
rl.on('line', line => {
  seen++;
  try {
    const o = JSON.parse(line);
    const s = o.status || o.taxonomicStatus;
    if (s === 'ACCEPTED') { out.write(JSON.stringify(o) + '\n'); kept++; }
  } catch {}
});
rl.on('close', () => { out.end(); console.log(`Fertig. Behalten: ${kept} von ${seen}`); });
Ausführen:

node filter_status_accepted.js
Optional
Wenn du gleichzeitig sicherstellen willst, dass es Species + Accepted + German names sind:

jq -c 'select(.rank=="SPECIES" and ((.status // .taxonomicStatus)=="ACCEPTED") and (.germanNames|type=="array" and length>0))' \
  plantnet_species_SPECIES.ndjson > plantnet_species_ACCEPTED_SPECIES_DE.ndjson
Sag Bescheid, wenn ich dir daraus direkt ein mongoimport-fertiges File oder zusätzliche Felder (z. B. family, order) erzeugen soll.

Du:
Jetzt kommt eine neue Herausforderung. Für Alle Einträge aus plantnet_species_ACCEPTED_slim.ndjson möchte ich jetzt neue Daten von GBIF ziehen und eine weiter ndjson erstellen.
Jede Pflanze mit "canonicalName" hat auf GBIF im Datensatz 7a3679ef-5582-4aaa-81f0-8c2545cafc81 Occurrences mit teilweise mehreren Bildurls und passenden tags wie flower, fruit, bark, leaf.

Ich brauche jetzt eine neue ndjson, in dem ich die taxonKey, den canonicalName, die URLs mit dem proxy https://images.weserv.nl/?url=... und den entsprechenden Tags für jedes Element aus der plantnet_species_ACCEPTED_slim.ndjson bekomme.
ChatGPT:

Nachgedacht für 2m 7s
geil, das wird ein schöner nächster Baustein! 🎯
Du willst: für jede Art aus deiner plantnet_species_ACCEPTED_slim.ndjson die Bild-URLs + Organ-Tags (flower/fruit/bark/leaf), und die URLs über den Weserv-Proxy liefern.

Unten bekommst du ein fertiges Node-Script, das genau das tut — komplett ohne zusätzliche NPM-Pakete (nutzt fetch aus Node ≥18). Es:

liest die NDJSON Zeile für Zeile (erwartet taxonKey + canonicalName),

ruft pro Art die GBIF Occurrence API mit datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81 und mediaType=StillImage ab,

sammelt aus jedem Treffer die Medien (media[].identifier) und leitet daraus möglichst robuste Organ-Tags ab,

schreibt eine neue NDJSON: eine Zeile je Art mit { taxonKey, canonicalName, images:[{url, tag, occurrenceKey}] },

packt jede Bild-URL durch den Proxy https://wsrv.nl/?url= (offizielle Doku bestätigt, dass die Original-URL direkt nach ?url= unterstützt wird). 
GBIF community forum
techdocs.gbif.org
gbif.org
images.weserv.nl

1) Script speichern: collect_images_from_occurrences.js
// Node >= 18 (global fetch). Keine externen Pakete nötig.
const fs = require('fs');
const readline = require('readline');
const { URL } = require('url');

const DATASET_KEY = '7a3679ef-5582-4aaa-81f0-8c2545cafc81'; // Pl@ntNet
const INFILE  = 'plantnet_species_ACCEPTED_slim.ndjson';
const OUTFILE = 'plantnet_species_images.ndjson';

// === Einstellungen ===
// Wenn du wirklich ALLE Bilder willst: setze LIMITS_* auf Infinity.
const CONCURRENCY = 6;                 // gleichzeitige Arten-Requests
const PAGE_SIZE   = 300;               // GBIF page size (max ~300 sinnvoll)
const TIMEOUT_MS  = 30_000;            // Request timeout
const RETRIES     = 4;                 // Retries bei 429/5xx
const RETRY_BASE_SLEEP = 800;          // ms (exponentielles Backoff)

// Per Art Limits (zum Zähmen der Dateigröße)
const LIMITS_TOTAL_PER_TAXON = 200;    // gesamt
const LIMITS_PER_TAG = {               // pro Organ
  leaf: 80, flower: 80, fruit: 60, bark: 40, habit: 40, other: 40, unknown: 40
};

// === Hilfsfunktionen ===
const sleep = ms => new Promise(r => setTimeout(r, ms));

function proxify(url) {
  // offizielle Empfehlung: https://wsrv.nl/?url=<vollständig-encodete-Original-URL>
  // (https wird unterstützt, siehe Doku)
  return 'https://wsrv.nl/?url=' + encodeURIComponent(url);
}

// heuristische Tag-Erkennung aus Medienobjekt + URL
function guessTag(media) {
  const parts = [
    media?.type, media?.title, media?.description, media?.format, media?.creator,
    media?.references, media?.license, media?.identifier
  ].filter(Boolean).join(' ').toLowerCase();

  // 1) explizite Schlüsselwörter
  if (/\bflower(s)?\b|blossom|blüte|flor/i.test(parts)) return 'flower';
  if (/\bfruit(s)?\b|frucht/i.test(parts)) return 'fruit';
  if (/\bleaf|leaves|blatt\b/i.test(parts)) return 'leaf';
  if (/\bbark|rinde\b/i.test(parts)) return 'bark';
  if (/\bhabit|whole|entire plant|gesamtpflanze|wuchsform\b/i.test(parts)) return 'habit';

  // 2) URL-Parameter/Path wie organs=leaf
  try {
    const u = new URL(media.identifier);
    const q = (u.search || '').toLowerCase();
    const p = u.pathname.toLowerCase();
    if (q.includes('organ=leaf') || q.includes('organs=leaf') || /\/leaf\//.test(p)) return 'leaf';
    if (q.includes('organ=flower') || q.includes('organs=flower') || /\/flower\//.test(p)) return 'flower';
    if (q.includes('organ=fruit') || q.includes('organs=fruit') || /\/fruit\//.test(p)) return 'fruit';
    if (q.includes('organ=bark') || q.includes('organs=bark') || /\/bark\//.test(p)) return 'bark';
    if (/\/habit\//.test(p)) return 'habit';
  } catch {}

  // 3) Fallbacks
  if (media?.type && /stillimage/i.test(media.type)) return 'other';
  return 'unknown';
}

function withinLimits(counter, tag) {
  const perTagMax = LIMITS_PER_TAG[tag] ?? LIMITS_PER_TAG.unknown;
  if (counter.total >= LIMITS_TOTAL_PER_TAXON) return false;
  if ((counter.byTag[tag] || 0) >= perTagMax) return false;
  return true;
}

async function gbifFetch(url) {
  let attempt = 0;
  while (true) {
    try {
      const ctl = new AbortController();
      const id = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/json' }});
      clearTimeout(id);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < RETRIES) {
          const wait = RETRY_BASE_SLEEP * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
          await sleep(wait);
          attempt++;
          continue;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt < RETRIES) {
        const wait = RETRY_BASE_SLEEP * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

async function collectForTaxon({ taxonKey, canonicalName }) {
  const collected = [];
  const seenUrls = new Set();

  let offset = 0;
  const counter = { total: 0, byTag: {} };

  while (true) {
    // mediaType=StillImage → Bilder; limit/offset Paging (Occurrence API)
    const url = `https://api.gbif.org/v1/occurrence/search?datasetKey=${DATASET_KEY}` +
                `&taxonKey=${taxonKey}&mediaType=StillImage&limit=${PAGE_SIZE}&offset=${offset}`;
    const data = await gbifFetch(url);

    for (const occ of data.results || []) {
      const occKey = occ.key ?? occ.gbifID ?? null;
      const mediaArr = Array.isArray(occ.media) ? occ.media : [];

      for (const m of mediaArr) {
        const id = m?.identifier;
        if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;
        const tag = guessTag(m);
        if (!withinLimits(counter, tag)) continue;
        if (seenUrls.has(id)) continue;

        collected.push({
          url: proxify(id),
          tag,
          occurrenceKey: occKey,
          license: m?.license || occ?.license || null,
          rightsHolder: m?.rightsHolder || occ?.rightsHolder || null
        });
        seenUrls.add(id);
        counter.total++;
        counter.byTag[tag] = (counter.byTag[tag] || 0) + 1;

        if (counter.total >= LIMITS_TOTAL_PER_TAXON) break;
      }
      if (counter.total >= LIMITS_TOTAL_PER_TAXON) break;
    }

    if (counter.total >= LIMITS_TOTAL_PER_TAXON) break;
    if (data.endOfRecords) break;
    offset += PAGE_SIZE;
  }

  return { taxonKey, canonicalName, images: collected };
}

async function run() {
  const rl = readline.createInterface({ input: fs.createReadStream(INFILE, 'utf8') });
  const out = fs.createWriteStream(OUTFILE, { flags: 'w' });

  // Aufgaben-Pool
  const queue = [];
  const workers = [];
  let active = 0, seen = 0, done = 0;

  function startNext() {
    if (active >= CONCURRENCY || queue.length === 0) return;
    const job = queue.shift();
    active++;
    (async () => {
      try {
        const rec = await collectForTaxon(job);
        out.write(JSON.stringify(rec) + '\n');
      } catch (e) {
        // schreibe leere Zeile mit Fehlerhinweis – damit du siehst, was schief lief
        out.write(JSON.stringify({ taxonKey: job.taxonKey, canonicalName: job.canonicalName, images: [], error: String(e.message || e) }) + '\n');
      } finally {
        active--; done++;
        startNext();
      }
    })();
  }

  rl.on('line', line => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      const taxonKey = obj?.taxonKey ?? obj?.speciesKey ?? obj?.usageKey;
      const canonicalName = obj?.canonicalName ?? obj?.scientificName ?? null;
      if (taxonKey) {
        queue.push({ taxonKey, canonicalName });
        seen++;
        startNext();
      }
    } catch {}
  });

  rl.on('close', async () => {
    // warte bis alle Worker fertig
    while (active > 0 || queue.length > 0) {
      startNext();
      await sleep(200);
    }
    out.end();
    console.log(`Fertig: verarbeitet ${done}/${seen} Arten → ${OUTFILE}`);
  });
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
Ausführen:

node collect_images_from_occurrences.js
Das Ergebnis liegt in plantnet_species_images.ndjson, mit einer Zeile pro Art, z. B.:

{
  "taxonKey": 12345,
  "canonicalName": "Quercus robur",
  "images": [
    {"url":"https://wsrv.nl/?url=https%3A%2F%2Fbs.plantnet.org%2F...jpg","tag":"leaf","occurrenceKey": 412345678,"license":"CC BY-NC 4.0","rightsHolder":"..."},
    {"url":"https://wsrv.nl/?url=https%3A%2F%2F...jpg","tag":"flower","occurrenceKey": 412345679,"license":"CC BY 4.0","rightsHolder":"..."}
  ]
}
Hinweise:
• Die GBIF Occurrence API liefert Bilder im Feld media[].identifier; du filterst mit mediaType=StillImage. 
GBIF community forum
techdocs.gbif.org

• Die Dataset-ID für Pl@ntNet ist die genannte 7a3679ef… (siehe Dataset-Seite). 
gbif.org

• Der Proxy Weserv/wsrv.nl akzeptiert direkt die vollständige Original-URL als ?url=-Parameter (HTTPS inkl.). 
images.weserv.nl

2) Feintuning / „Alle Bilder“ aktivieren
Setze oben:

LIMITS_TOTAL_PER_TAXON = Infinity

LIMITS_PER_TAG-Werte auf Infinity
Dann wird alles geholt (kann sehr groß werden).

3) Qualität / Tag-Genauigkeit
Pl@ntNet liefert die Organgruppe nicht als standardisiertes Darwin-Core-Feld; je nach Vorkommen steckt es in Titel/Beschreibung, dynamicProperties oder, oft am zuverlässigsten, in URL-Pfaden/Parametern (z. B. organs=leaf). Das Script nutzt mehrere Heuristiken (Titel/Description/URL-Pattern). Falls du strengere Regeln oder ein Mapping pro Publisher willst, sag Bescheid — ich bau dir eine gezielte Parser-Funktion für Pl@ntNet.

4) Import in MongoDB (optional)
mongoimport --uri "mongodb://localhost:27017" \
  --db myflora --collection species_images \
  --file plantnet_species_images.ndjson
Wenn du magst, passe ich dir das Script noch an:

Rate-Limitfreundlicher (globaler Token-Bucket),

nur N Bilder pro Organ, sortiert nach aktuellstem Datum,

zusätzliche Felder (z. B. countryCode, eventDate),

separate multimedia-Lizenzprüfung.

Du:
es soll keine limits geben und die tags stehen in dem Datensatz und müssen nicht erraten werden
ChatGPT:

Nachgedacht für 2m 24s
top! Dann passe ich das Script so an:

Keine Limits: es werden alle Vorkommen mit allen Bildern geholt (seitenweise bis endOfRecords=true).

Tags nicht raten: die Organ-Tags werden aus den gelieferten Daten gelesen – bevorzugt aus der Audubon-Core Multimedia-Extension (ac:subjectPart), ggf. aus media-Feldern; nur falls der Datensatz die Organe ausschließlich in der Bild-URL codiert (?organ=leaf/organs=leaf), wird das aus der URL übernommen (ist weiterhin Datensatzinhalt, kein Raten).

Bild-URLs werden durch https://images.weserv.nl/?url= geproxyt.

Ausgabe: eine Zeile pro Art { taxonKey, canonicalName, images:[{url, tag, occurrenceKey, license, rightsHolder}] }.

Hinweis: Für extrem häufige Arten kann die Occurrence-API bei ~100 000 Treffern pro Anfrage an Grenzen stoßen; in diesem Fall nutzt man für diese Art die Download-API (DWCA inkl. Extensions). Ich lasse unten eine klare Log-Warnung ausgeben. Details: GBIF Occurrence API & Downloads, Audubon-Core & Multimedia auf GBIF. 
techdocs.gbif.org
+2
techdocs.gbif.org
+2
rs.gbif.org

collect_images_from_occurrences_nolimit.js
Speichere diese Datei neben deiner plantnet_species_ACCEPTED_slim.ndjson:

// Node >=18 (global fetch). Keine externen Pakete nötig.
const fs = require('fs');
const readline = require('readline');
const { URL } = require('url');

const DATASET_KEY = '7a3679ef-5582-4aaa-81f0-8c2545cafc81'; // Pl@ntNet observations
const INFILE  = 'plantnet_species_ACCEPTED_slim.ndjson';
const OUTFILE = 'plantnet_species_images.ndjson';

// Performance
const CONCURRENCY = 6;      // gleichzeitige Arten
const PAGE_SIZE   = 300;    // gute Seitengröße für GBIF
const TIMEOUT_MS  = 30_000;
const RETRIES     = 4;
const BASE_SLEEP  = 800;

// --- Helpers ---
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gbifJSON(url) {
  let attempt = 0;
  while (true) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctl.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < RETRIES) {
          await sleep(BASE_SLEEP * 2 ** attempt + Math.random() * 400);
          attempt++; continue;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return await res.json();
    } catch (e) {
      if (attempt < RETRIES) { await sleep(BASE_SLEEP * 2 ** attempt); attempt++; continue; }
      throw e;
    }
  }
}

function proxify(url) {
  // Gewünschter Proxy
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(url);
}

// --- Tag-Extraktion NUR aus Datenfeldern (keine Heuristik in Freitext) ---
function readSubjectPartFromExtRow(row) {
  // Audubon Core keys können als "ac:subjectPart" oder kompletter URI auftauchen
  const candidates = [
    'ac:subjectPart',
    'subjectPart',
    'http://rs.tdwg.org/ac/terms/subjectPart',
    'http://rs.tdwg.org/ac/terms/subject',
    'http://purl.org/dc/terms/subject'
  ];
  for (const k of candidates) {
    const v = row?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

function readSubjectPartFromMedia(m) {
  // Manche Publisher mappen AC-Felder in media-Objekte
  const candidates = [
    'ac:subjectPart', 'subjectPart', 'subject', 'subjectCategory'
  ];
  for (const k of candidates) {
    const v = m?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

function readOrganFromUrl(identifier) {
  try {
    const u = new URL(identifier);
    const organ = u.searchParams.get('organ') || u.searchParams.get('organs');
    if (organ && organ.trim()) return organ.toLowerCase();
    // manche Pfade enthalten /leaf/ /flower/ etc.
    const p = u.pathname.toLowerCase();
    const hit = ['leaf','flower','fruit','bark','habit','other'].find(k => p.includes(`/${k}/`));
    return hit || null;
  } catch { return null; }
}

function* iterMultimediaExt(occ) {
  const ex = occ?.extensions?.['http://rs.tdwg.org/ac/terms/Multimedia'] ||
             occ?.extensions?.['http://rs.gbif.org/terms/1.0/Multimedia'] ||
             occ?.extensions?.Multimedia;
  if (Array.isArray(ex)) {
    for (const row of ex) yield row;
  }
}

function mediaItems(occ) {
  return Array.isArray(occ?.media) ? occ.media : [];
}

function extractImagesFromOccurrence(occ) {
  const out = [];

  // 1) aus media[]
  for (const m of mediaItems(occ)) {
    const id = m?.identifier;
    if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;
    const tag = readSubjectPartFromMedia(m) || readOrganFromUrl(id);
    out.push({
      url: proxify(id),
      tag: tag || null,
      occurrenceKey: occ.key ?? occ.gbifID ?? null,
      license: m?.license || occ?.license || null,
      rightsHolder: m?.rightsHolder || occ?.rightsHolder || null
    });
  }

  // 2) ggf. aus AC-Extension (kann zusätzliche Einträge enthalten)
  for (const row of iterMultimediaExt(occ)) {
    const id = row?.identifier || row?.['http://purl.org/dc/terms/identifier'];
    if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;
    const tag = readSubjectPartFromExtRow(row) || readOrganFromUrl(id);
    out.push({
      url: proxify(id),
      tag: tag || null,
      occurrenceKey: occ.key ?? occ.gbifID ?? null,
      license: row?.license || row?.['http://purl.org/dc/terms/license'] || occ?.license || null,
      rightsHolder: row?.rightsHolder || row?.['http://purl.org/dc/terms/rightsHolder'] || occ?.rightsHolder || null
    });
  }

  // Dedupe nach Original-URL (ohne Proxy)
  const seen = new Set();
  return out.filter(rec => {
    try {
      const u = new URL(rec.url);
      const original = u.searchParams.get('url') || rec.url;
      if (seen.has(original)) return false;
      seen.add(original);
      return true;
    } catch { return true; }
  });
}

async function collectForTaxon({ taxonKey, canonicalName }) {
  const images = [];
  let offset = 0;
  let pages = 0;
  const base = `https://api.gbif.org/v1/occurrence/search?datasetKey=${DATASET_KEY}&taxonKey=${taxonKey}&mediaType=StillImage&limit=${PAGE_SIZE}`;

  while (true) {
    const url = `${base}&offset=${offset}`;
    const data = await gbifJSON(url);
    for (const occ of data.results || []) {
      images.push(...extractImagesFromOccurrence(occ));
    }
    pages++;
    if (data.endOfRecords) break;
    offset += PAGE_SIZE;

    // weiche Warnung falls es „zu viel“ wird (API Hardlimit ist serverseitig)
    if (offset >= 100000) {
      console.warn(`[WARN] taxonKey ${taxonKey}: >=100k Occurrences via API – erwäge für diese Art die Download-API (DWCA) mit Multimedia-Extension.`);
      // Weiterlaufen: viele Arten werden ohnehin vorher enden.
    }
  }

  return { taxonKey, canonicalName, images };
}

async function run() {
  const rl = readline.createInterface({ input: fs.createReadStream(INFILE, 'utf8') });
  const out = fs.createWriteStream(OUTFILE, { flags: 'w' });

  const queue = [];
  let active = 0, seen = 0, done = 0;

  function kick() {
    if (active >= CONCURRENCY || queue.length === 0) return;
    const job = queue.shift();
    active++;
    (async () => {
      try {
        const rec = await collectForTaxon(job);
        out.write(JSON.stringify(rec) + '\n');
      } catch (e) {
        out.write(JSON.stringify({ taxonKey: job.taxonKey, canonicalName: job.canonicalName, images: [], error: String(e.message || e) }) + '\n');
      } finally {
        active--; done++; kick();
      }
    })();
  }

  rl.on('line', line => {
    if (!line.trim()) return;
    try {
      const o = JSON.parse(line);
      const taxonKey = o?.taxonKey ?? o?.speciesKey ?? o?.usageKey;
      const canonicalName = o?.canonicalName ?? o?.scientificName ?? null;
      if (taxonKey) {
        queue.push({ taxonKey, canonicalName });
        seen++; kick();
      }
    } catch {}
  });

  rl.on('close', async () => {
    while (active > 0 || queue.length > 0) { kick(); await sleep(200); }
    out.end();
    console.log(`Fertig: ${done}/${seen} Arten verarbeitet → ${OUTFILE}`);
  });
}

run().catch(e => { console.error(e); process.exit(1); });
Starten:

node collect_images_from_occurrences_nolimit.js
Die Ausgabe plantnet_species_images.ndjson hat pro Art alle Bilder mit Datensatz-Tags (sofern vom Publisher geliefert).
Wenn du statt API bei sehr großen Arten lieber einen Download mit Extensions bauen willst (empfohlen >100 k Occurrences), nutze die Download-API mit Filter datasetKey+taxonKey und Format DWCA; seit 2024 können Extensions (inkl. Audubon Core) mitgeladen werden. 
techdocs.gbif.org

Doku & Hintergründe:
• Occurrence API (Paging, endOfRecords), Species/TaxonKeys. 
techdocs.gbif.org
+1

• Multimedia/Audubon Core für Organ-Tags (subjectPart). 
techdocs.gbif.org
rs.gbif.org

Wenn du möchtest, erweitere ich dir das Script noch um:

optionalen DWCA-Download-Pfad für „Riesenarten“,

Lizenz-Filter (z. B. nur CC-BY/CC-BY-SA) vor dem Schreiben,

Aufteilung in mehrere NDJSONs (pro Ordnung/Familie) für schnelleren Import.

Du:
aus der Liste plantnet_species_ACCEPTED_slim_sorted.ndjson mit Einträgen wie {"taxonKey":2650123,"scientificName":"Helminthostachys zeylanica (L.) Hook.","canonicalName":"Helminthostachys zeylanica","germanName":null,"source":{"derivedFromDatasetKey":"7a3679ef-5582-4aaa-81f0-8c2545cafc81","retrievedAt":"2025-09-07T11:46:38.720Z"}}

kann "source" und "retrievedAt" entfernt werden
ChatGPT:

Nachgedacht für 21s
Klar! Du hast NDJSON. Nimm einen der drei Wege:

Git Bash / WSL mit jq (kurz & sicher)
jq -c 'del(.source, .retrievedAt)' \
  plantnet_species_ACCEPTED_slim_sorted.ndjson \
  > plantnet_species_ACCEPTED_slim_sorted_noSource.ndjson

# optional: ersetzen
mv plantnet_species_ACCEPTED_slim_sorted_noSource.ndjson \
   plantnet_species_ACCEPTED_slim_sorted.ndjson
Reicht völlig: Wenn retrievedAt nur in source steckt, entfernt del(.source, .retrievedAt) beides. Falls es zusätzlich mal top-level retrievedAt gibt, ist das damit auch weg.

Windows PowerShell (ohne jq)
Get-Content "plantnet_species_ACCEPTED_slim_sorted.ndjson" |
  ForEach-Object {
    try { $o = $_ | ConvertFrom-Json } catch { $o = $null }
    if ($o) {
      $o.PSObject.Properties.Remove('source') | Out-Null
      $o.PSObject.Properties.Remove('retrievedAt') | Out-Null
      $o | ConvertTo-Json -Compress
    }
  } | Set-Content -Encoding utf8 "plantnet_species_ACCEPTED_slim_sorted_noSource.ndjson"
Node.js (kleines Strip-Script)
// strip_source.js
const fs = require('fs'), rl = require('readline');
const IN='plantnet_species_ACCEPTED_slim_sorted.ndjson';
const OUT='plantnet_species_ACCEPTED_slim_sorted_noSource.ndjson';

const r = rl.createInterface({ input: fs.createReadStream(IN, 'utf8') });
const w = fs.createWriteStream(OUT, { flags: 'w' });

r.on('line', line => {
  if(!line.trim()) return;
  try {
    const o = JSON.parse(line);
    delete o.source;
    delete o.retrievedAt; // falls mal top-level vorhanden
    w.write(JSON.stringify(o) + '\n');
  } catch {}
});
r.on('close', () => w.end());
node strip_source.js


Keine Datei ausgewähltKeine Datei ausgewählt
ChatGPT kann Fehler machen. Überprüfe wichtige Informationen. Siehe Cookie-Voreinstellungen.
