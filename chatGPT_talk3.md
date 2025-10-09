Weiter zum Inhalt
Chatverlauf

Du:
// enrich_taxa.js
// Liest:  plantnet_taxonKeys.json  (Array von taxonKeys)
// Schreibt: plantnet_species_de.ndjson (NDJSON) + plantnet_species_de.json (Array)

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const INPUT = "plantnet_taxonKeys.json";
const OUT_NDJSON = "plantnet_species_de.ndjson";
const OUT_JSON = "plantnet_species_de.json";
const DATASET_KEY = "7a3679ef-5582-4aaa-81f0-8c2545cafc81";
const GBIF = "https://api.gbif.org/v1";

const CONCURRENCY = 10;
const RETRIES = 5;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, tries = RETRIES) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      // Retry bei Netzfehlern, 429 & 5xx
      if (
        i < tries - 1 &&
        (status === 429 || (status >= 500 && status <= 599) || !status)
      ) {
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
  const pref = germanNames.find((v) => v.preferred);
  if (pref) return pref.name;
  // 3) erster Eintrag
  return germanNames[0]?.name || null;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function buildDocFromTaxonKey(originalKey) {
  // 1) Basis-Abruf (mit Sprache=de → evtl. vernacularName gesetzt)
  const base = await fetchWithRetry(
    ${GBIF}/species/${originalKey}?language=de
  );

  // 2) Auf akzeptierten Namen normalisieren, falls Synonym
  const acceptedKey = base.acceptedKey || base.key;
  const usage =
    acceptedKey !== base.key
      ? await fetchWithRetry(${GBIF}/species/${acceptedKey}?language=de)
      : base;

  // 3) Alle deutschen Namen laden
  let germanNames = [];
  try {
    const vn = await fetchWithRetry(
      ${GBIF}/species/${usage.key}/vernacularNames
    );
    germanNames = (vn.results || [])
      .filter((v) => v?.vernacularName)
      .filter((v) => {
        const lang = (v.language || "").toLowerCase();
        return lang === "de" || lang === "deu" || lang === "ger";
      })
      .map((v) => ({
        name: v.vernacularName,
        preferred: !!v.preferred,
        source: v.source || null,
      }));
    germanNames = uniqBy(germanNames, (x) => x.name.trim().toLowerCase());
  } catch (_) {}

  const germanName = pickPreferredGerman(usage, germanNames);

  return {
    // Schlüssel
    taxonKey: usage.key, // eindeutiger Schlüssel im Backbone
    acceptedKey, // = taxonKey, falls bereits akzeptiert
    originalKey, // der aus plantnet_taxonKeys.json
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
      retrievedAt: new Date().toISOString(),
    },
  };
}

async function main() {
  // Eingabe lesen & säubern
  const { default: pLimit } = await import("p-limit");
  const raw = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const allKeys = Array.from(
    new Set(raw.map((k) => Number(k)).filter((n) => Number.isFinite(n)))
  );
  if (!allKeys.length) throw new Error("Keine taxonKeys im Input gefunden.");

  // Output-Streams öffnen
  const nd = fs.createWriteStream(OUT_NDJSON, { flags: "w" });
  const js = fs.createWriteStream(OUT_JSON, { flags: "w" });
  js.write("[");
  let first = true;

  const failedLog = fs.createWriteStream("failed_keys.txt", { flags: "w" });

  const limit = pLimit(CONCURRENCY);
  let done = 0;

  // Fortschritt hübsch ausgeben
  function progress() {
    process.stdout.write(\rVerarbeitet: ${done}/${allKeys.length});
  }

  const tasks = allKeys.map((k) =>
    limit(async () => {
      try {
        const doc = await buildDocFromTaxonKey(k);
        // NDJSON
        nd.write(JSON.stringify(doc) + "\n");
        // JSON-Array (streaming)
        if (!first) js.write(",");
        js.write(JSON.stringify(doc));
        first = false;
      } catch (e) {
        failedLog.write(String(k) + "\n");
      } finally {
        done++;
        progress();
      }
    })
  );

  await Promise.all(tasks);

  js.write("]");
  nd.end();
  js.end();
  failedLog.end();
  process.stdout.write(
    \nFertig. OK: ${
      done -
      fs.readFileSync("failed_keys.txt", "utf8").split("\n").filter(Boolean)
        .length
    }, Fehler siehe failed_keys.txt\n
  );
}

main().catch((err) => {
  console.error("\nFehler:", err.message);
  process.exit(1);
});


Was passiert hier?
ChatGPT:
Kurz gesagt: Das Skript nimmt eine Liste von GBIF-taxonKeys, holt sich zu jedem Eintrag die (ggf. akzeptierte) Art samt deutschen Namen aus der GBIF-API, baut daraus ein einheitliches Objekt und schreibt alles parallelisiert in zwei Output-Dateien (NDJSON und JSON-Array). Fehlgeschlagene Keys landen in einer Logdatei.

Ablauf – Schritt für Schritt
Konstanten & Setup

Eingabe: plantnet_taxonKeys.json (Array von Zahlen/Strings).

Ausgaben:

plantnet_species_de.ndjson (eine JSON-Zeile pro Taxon),

plantnet_species_de.json (ein JSON-Array als Stream geschrieben).

GBIF-Basis‐URL, Dataset-Key (nur als Metadaten), Parallelität CONCURRENCY=10, Retry-Versuche RETRIES=5.

Hilfsfunktionen

fetchWithRetry(url): Holt eine URL mit axios und exponentiellem Backoff. Wiederholt bei Netzwerkfehlern, HTTP 429 (Rate Limit) und 5xx.

sleep(ms): Wartezeit zwischen Retries.

uniqBy(...): Dedupliziert Einträge (hier: deutsche Namen) case-insensitiv.

pickPreferredGerman(usage, germanNames): Wählt den bevorzugten deutschen Namen:

usage.vernacularName (wenn ?language=de direkt was liefert),

andernfalls den Eintrag mit preferred:true,

sonst den ersten deutschen Namen; ggf. null.

Pro TaxonKey → buildDocFromTaxonKey(originalKey)

Basisabruf: GET /species/{key}?language=de.

Synonym-Normalisierung: Falls Synonym, über acceptedKey den akzeptierten Eintrag nachladen (/species/{acceptedKey}?language=de). Ergebnis ist usage.

Deutsche Trivialnamen laden: GET /species/{usage.key}/vernacularNames, filtern auf Sprachen de, deu, ger; mappen auf {name, preferred, source}; deduplizieren.

Bevorzugten deutschen Namen bestimmen via pickPreferredGerman(...).

Dokument bauen:

{
  taxonKey: usage.key,          // GBIF-Backbone Schlüssel (akzeptiert)
  acceptedKey,                  // ≙ taxonKey, falls bereits akzeptiert
  originalKey,                  // aus der Inputliste
  scientificName, canonicalName,
  rank, status,                 // taxonomische Infos
  germanName,                   // bevorzugter deutscher Name (oder null)
  germanNames,                  // alle gefundenen D-Namen (dedupliziert)
  source: {
    derivedFromDatasetKey: DATASET_KEY, // Metainfo
    retrievedAt: <ISO-Date>
  }
}
Main-Logik

Input einlesen & säubern: JSON parsen, zu Zahlen casten, unique und finite filtern.

Streams öffnen: NDJSON & JSON-Array (schreibt das Array streamend: [ … , … ]).

Rate-Limiting/Parallelisierung: Mit p-limit(CONCURRENCY) werden max. 10 Requests gleichzeitig ausgeführt (trotz eigener Retries).

Pro Key:

buildDocFromTaxonKey(k) aufrufen.

Erfolg → in NDJSON eine Zeile schreiben; parallel ins JSON-Array ein Objekt (mit Komma-Handling via first Flag).

Fehler → Key in failed_keys.txt protokollieren.

Fortschritt in der Konsole (Verarbeitet: x/y) aktualisieren.

Abschluss: Streams schließen, eine kurze Zusammenfassung in der Konsole: OK-Anzahl vs. Fehler (aus failed_keys.txt gezählt).

Wichtige Details
Robustheit: Retries + Backoff + 10er-Parallelität = guter Durchsatz bei API-Limits.

Synonym-Handling: Normalisiert auf den akzeptierten Namen → einheitliche taxonKeys.

Sprachlogik: Deutsche Namen über zwei Wege (Direktfeld vernacularName + /vernacularNames).

Ausgabe im Doppel-Format: NDJSON (ideal zum Stream-Import) und klassisches JSON-Array (z. B. für Tools/Previews).

Mögliche Verbesserungen (optional)
Persistenter Fortschritt (Checkpointing), um bei Abbruch nicht von vorn zu starten.

Throttling an GBIF-Limits koppeln (z. B. bei zu vielen 429 kurz global pausieren).

Fehlerinformationen protokollieren (nicht nur Key, auch HTTP-Status).

Feld‐Erweiterungen: z. B. Familie/Parent-Info direkt hinzufügen, falls später benötigt.

Wenn du willst, passe ich dir das Skript sofort für eines der oben genannten Upgrades an.

Du:
wie führe ich sie aus?
ChatGPT:
Du hast hier ein Node.js-Skript.
Ausführen kannst du es so:

Node.js installieren
Falls noch nicht geschehen: Node.js herunterladen und installieren (LTS-Version reicht).

Projektordner vorbereiten
Lege deine Dateien (z. B. enrich_taxa.js und plantnet_taxonKeys.json) in einen Ordner.

Terminal öffnen

Unter Windows: Eingabeaufforderung oder PowerShell im Ordner öffnen (Rechtsklick → „Im Terminal öffnen“).

Unter macOS/Linux: Terminal öffnen und mit cd in den Ordner wechseln.

Benötigte Pakete installieren
Das Skript verwendet axios und p-limit. Installiere sie mit:

npm init -y        # einmalig, erzeugt package.json
npm install axios p-limit
Skript ausführen

node enrich_taxa.js
Ergebnis prüfen
Danach findest du im Ordner:

plantnet_species_de.ndjson → Zeilenweise JSON-Objekte

plantnet_species_de.json → Ganzes Array

failed_keys.txt → Liste von Keys, die nicht geladen werden konnten

👉 Frage: Soll ich dir ein kleines Beispiel-plantnet_taxonKeys.json (z. B. mit 3 TaxonKeys) machen, damit du sofort testen kannst, ob alles läuft?

Du:
Ich habe eine species Liste mit Daten wie diesen:
{"taxonKey":2650105,"scientificName":"Azolla caroliniana Willd.","canonicalName":"Azolla caroliniana","germanName":"Großer Algenfarn"}
{"taxonKey":2650107,"scientificName":"Azolla filiculoides Lam.","canonicalName":"Azolla filiculoides","germanName":"Algenfarn"}


Diese möchte ich mit Hilfe von GBIF anreichern. Pro Art soll die gesamte Taxonomie sowohl mit dem wissenschaftlichen Namen, wie auch dem deutschen Namen erweitert werden. Wie sollte die ndjson aufgebaut sein, damit ich die Daten in meiner App über MongoDB am effizientesten abrufen kann?
ChatGPT:

Nachgedacht für 9s
Super Use-Case! Für schnelle Abfragen in MongoDB lohnt sich eine denormalisierte Species-Collection: pro Art ein Dokument, das die komplette Taxonomie (IDs + Namen) bereits eingebettet trägt – sowohl wissenschaftlich als auch deutsch. So brauchst du beim Rendern keine weiteren Joins/Lookups.

Vorschlag: NDJSON-Schema (1 Zeile = 1 Art)
Jede Zeile ist ein JSON-Objekt wie unten. Felder, die du nicht kennst, kannst du zunächst null lassen und später per Batch anreichern.

{
  "taxonKey": 2650105,
  "acceptedKey": 2650105,
  "rank": "SPECIES",
  "status": "ACCEPTED",

  "names": {
    "scientific": {
      "species": "Azolla caroliniana",
      "genus": "Azolla",
      "family": "Salviniaceae",
      "order": "Salviniales",
      "class": "Polypodiopsida",
      "phylum": "Tracheophyta",
      "kingdom": "Plantae"
    },
    "german": {
      "species": "Großer Algenfarn",
      "genus": null,
      "family": null,
      "order": null,
      "class": null,
      "phylum": null,
      "kingdom": "Pflanzen"   // falls vorhanden, sonst null
    }
  },

  "keys": {
    "species": 2650105,
    "genus": null,
    "family": null,
    "order": null,
    "class": null,
    "phylum": null,
    "kingdom": null
  },

  "path": {
    "scientific": [
      {"rank":"KINGDOM", "key": null, "name":"Plantae"},
      {"rank":"PHYLUM",  "key": null, "name":"Tracheophyta"},
      {"rank":"CLASS",   "key": null, "name":"Polypodiopsida"},
      {"rank":"ORDER",   "key": null, "name":"Salviniales"},
      {"rank":"FAMILY",  "key": null, "name":"Salviniaceae"},
      {"rank":"GENUS",   "key": null, "name":"Azolla"},
      {"rank":"SPECIES", "key": 2650105, "name":"Azolla caroliniana"}
    ],
    "german": [
      {"rank":"KINGDOM", "name":"Pflanzen"},
      {"rank":"PHYLUM",  "name": null},
      {"rank":"CLASS",   "name": null},
      {"rank":"ORDER",   "name": null},
      {"rank":"FAMILY",  "name": null},
      {"rank":"GENUS",   "name": null},
      {"rank":"SPECIES", "name":"Großer Algenfarn"}
    ],
    "flatSci": "Plantae|Tracheophyta|Polypodiopsida|Salviniales|Salviniaceae|Azolla|Azolla caroliniana",
    "flatDe":  "Pflanzen|||||Azolla|Großer Algenfarn"
  },

  "display": {
    "scientificName": "Azolla caroliniana Willd.",
    "canonicalName":  "Azolla caroliniana",
    "germanName":     "Großer Algenfarn"
  },

  "vernacular": {
    "de": [
      {"name":"Großer Algenfarn", "preferred":true,  "source":"GBIF"},
      {"name":"Großer Schwimmfarn","preferred":false,"source":"…"}
    ]
  },

  "synonyms": [
    /* optional: weitere wissenschaftliche Synonyme */
  ],

  "source": {
    "gbifBackbone": true,
    "derivedFromDatasetKey": "7a3679ef-5582-4aaa-81f0-8c2545cafc81",
    "retrievedAt": "2025-09-18T10:15:00.000Z"
  },

  "search": {
    "tokens": ["azolla","caroliniana","großer","algenfarn"],   // optional Precompute
    "ngrams": ["azo","zol","oll","lla", "alg","lge","gen","enf","nfa","far","arn"] // optional
  }
}
Für Azolla filiculoides hättest du die gleiche Struktur mit den jeweiligen Namen; unbekannte höhere Ränge/Keys zunächst null.

Warum diese Struktur effizient ist
Ein Dokument pro Art: die App kann ohne zusätzliche Queries die gesamte Kette (Kingdom → Species) anzeigen – sowohl DE als auch wissenschaftlich.

keys + path: erlaubt schnelle Filter (z. B. alle Arten einer Familie) via keys.family oder path.scientific.rank/key.

display: sofort nutzbar für UI (Titelzeile etc.).

vernacular.de: mehrere deutsche Namen inkl. „preferred“; du wählst im Frontend oder precomputest in display.germanName.

flatSci / flatDe: super für Breadcrumbs und einfache Prefix-/LIKE-Suche.

Empfohlene MongoDB-Indexes
Passe an deine häufigsten Abfragen an – Start mit:

db.species.createIndex({ taxonKey: 1 }, { unique: true });
db.species.createIndex({ acceptedKey: 1 });
db.species.createIndex({ "keys.family": 1 });
db.species.createIndex({ "keys.genus": 1 });
db.species.createIndex({ rank: 1, "names.scientific.genus": 1 }); // z.B. Artlisten je Gattung
db.species.createIndex({ "display.germanName": 1 });
db.species.createIndex({ "display.canonicalName": 1 });
db.species.createIndex({ "vernacular.de.name": 1 });

/* Für Volltextsuche (wenn benötigt) */
db.species.createIndex({
  "display.germanName": "text",
  "display.canonicalName": "text",
  "display.scientificName": "text",
  "vernacular.de.name": "text"
}, { default_language: "none" });

/* Optional für schnelle Taxon-Pfadfilter */
db.species.createIndex({ "path.scientific.key": 1 });
Importfreundliches NDJSON
Speichere jede Art als eine Zeile im oben gezeigten Format:

{...Dokument Art 1...}
{...Dokument Art 2...}
{...}
Import:

mongoimport --db myflora --collection species --file plantnet_species_full.ndjson --jsonArray=false
Minimal-Felder (wenn du erst mal klein starten willst)
Wenn dir das oben zu viel ist, starte mit:

taxonKey, acceptedKey, rank, status

display.{scientificName, canonicalName, germanName}

names.scientific.{genus,family,order,class,phylum,kingdom}

names.german.{genus,family,order,class,phylum,kingdom}

keys.{genus,family,order,class,phylum,kingdom}

path.flatSci, path.flatDe

vernacular.de (Array)

Den Rest kannst du später problemlos nachziehen (Update per taxonKey).

Wenn du magst, schreibe ich dir dein Enrichment-Skript so um, dass es genau dieses Schema erzeugt (inkl. deutscher Taxonnamen, wenn verfügbar) – dann kannst du direkt importieren.

Du:
ist es evtl sinnvoll eine weitere NDJSON für die Taxonomie zu erstellen?
ChatGPT:
Kurz: Ja – eine zweite NDJSON/Collection für die Taxonomie ist sinnvoll, zusätzlich zur denormalisierten Species-Collection.
So bekommst du das Beste aus beiden Welten: schnelle App-Reads (alles je Art eingebettet) und eine zentrale, wiederverwendbare Taxon-Quelle für Bäume, Filter, Rebuilds und Updates.

Wann es sich lohnt
Taxonomie-Baum/Browser (Familie → Gattung → Art).

Filter/Statistiken (z. B. alle Arten einer Familie zählen).

Regelmäßige Updates der GBIF-Backbone (Namen/Parents ändern sich).

Mehrsprachigkeit: Deutsche Namen der höheren Ränge an einer Stelle pflegen.

Empfohlene Architektur (2 Collections)
species (denormalisiert, wie zuvor vorgeschlagen)

Ein Dokument pro Art, inkl. kompletter Pfad (IDs + Namen, DE+Sci).

Für die UI reicht meist ein Read.

taxa (normiert – alle Knoten, nicht nur Arten)

Ein Dokument pro Taxon (Kingdom…Species), inklusive Parent-Bezug.

Quelle für Baum, Filter, und um species-Dokumente bei Backbone-Änderungen zielgerichtet zu aktualisieren.

taxa.ndjson – Schema-Vorschlag (1 Zeile = 1 Taxon)
{
  "taxonKey": 7346,
  "parentKey": 4714,
  "rank": "FAMILY",
  "status": "ACCEPTED",

  "names": {
    "scientific": "Salviniaceae",
    "german": "Schwimmfarngewächse"
  },

  "path": {
    "keys": [6, 7707728, 7707729, 12345, 7346],   // kingdom→…→self
    "ranks": ["KINGDOM","PHYLUM","CLASS","ORDER","FAMILY"],
    "scientific": ["Plantae","Tracheophyta","Polypodiopsida","Salviniales","Salviniaceae"],
    "german": ["Pflanzen","—","—","—","Schwimmfarngewächse"]
  },

  "vernacular": {
    "de": [
      {"name":"Schwimmfarngewächse","preferred":true,"source":"GBIF"}
    ]
  },

  "counts": {
    "children": 3,
    "species": 42       // optional voraggregiert
  },

  "source": {
    "gbifBackbone": true,
    "retrievedAt": "2025-09-18T10:30:00.000Z"
  }
}
Wichtige Felder/Ideen
taxonKey, parentKey, rank → Baumstruktur + schnelle Filter.

path.* → sofortige Breadcrumbs; keys erlaubt schnelle „alle Nachfahren”-Abfragen (z. B. path.keys: 7346).

names.german auf jedem Level (falls vorhanden), sonst null/—.

Optional counts für schnelle UI (Badge-Zahlen ohne teure Aggregation).

Indexe für taxa
db.taxa.createIndex({ taxonKey: 1 }, { unique: true });
db.taxa.createIndex({ parentKey: 1 });
db.taxa.createIndex({ rank: 1 });
db.taxa.createIndex({ "path.keys": 1 });  // Nachfahren/Slice-Queries
db.taxa.createIndex({ "names.german": 1 });
db.taxa.createIndex({ "names.scientific": 1 });
Zusammenspiel species ↔ taxa
Build/Update: Enrichment zieht pro Art den Pfad aus taxa (oder direkt GBIF) und schreibt ihn eingebettet in species.

Rebuild bei Änderungen: Wenn sich z. B. parentKey einer Familie ändert:

taxa aktualisieren,

betroffene species via keys.family bzw. path.keys selektieren und deren path/* + names.german.* nachziehen.

Suche/Filter:

UI wählt eine Familie in einem Taxo-Tree → holt Arten über species.find({"keys.family": <familyKey>}).

Alternativ über species.find({"path.scientific.key": <anyKeyInSubtree>}) wenn du dort eine Liste speicherst.

Import
mongoimport --db myflora --collection taxa --file taxa.ndjson
mongoimport --db myflora --collection species --file species.ndjson
Fazit
Ja: Eine zusätzliche taxa-NDJSON/Collection ist sehr sinnvoll.

Behalte die denormalisierten Pfade in species für schnelle Reads; nutze taxa als Wahrheit für Baum, Filter und Updates.

Wenn du willst, schreibe ich dir dein Enrichment-Skript so um, dass es zuerst taxa.ndjson (alle nötigen Knoten) generiert und danach species.ndjson daraus ableitet – inkl. deutscher Namen pro Rang.

Du:
Also sollte ich in species.ndjson auch den Familiennamen pro Art ergänzen und das dann für die taxa verwenden?
ChatGPT:

Nachgedacht für 9s
Kurzantwort: Ja, pro Art solltest du mindestens den Familien-Key und den Familiennamen (wissenschaftlich + deutsch) im species-Dokument mitführen – für schnelle Filter.
Aber: Die taxa-Collection solltest du idealerweise direkt aus GBIF (bzw. aus vollständigen Taxo-Pfaden) ableiten, nicht „nur“ aus den in species eingebetteten Familienfeldern. So vermeidest du Lücken/Fehlzuordnungen und bekommst auch alle höheren Ränge konsistent.

Empfohlene Strategie
In species.ndjson einbetten (für schnelle App-Reads)

keys.family (GBIF taxonKey der Familie)

names.scientific.family (z. B. "Salviniaceae")

names.german.family (falls vorhanden; sonst null)

(gleiches Schema gern auch für genus, order, class, phylum, kingdom)

Optional: path.scientific/path.german als vollständige Kette (Kingdom→…→Species)

Beispiel (Auszug pro Art):

{
  "taxonKey": 2650105,
  "rank": "SPECIES",
  "display": {
    "scientificName": "Azolla caroliniana Willd.",
    "canonicalName": "Azolla caroliniana",
    "germanName": "Großer Algenfarn"
  },
  "keys": {
    "genus": 7323136,
    "family": 7346,
    "order": 12345,
    "class": 7707729,
    "phylum": 7707728,
    "kingdom": 6
  },
  "names": {
    "scientific": {
      "genus": "Azolla",
      "family": "Salviniaceae",
      "order": "Salviniales",
      "class": "Polypodiopsida",
      "phylum": "Tracheophyta",
      "kingdom": "Plantae"
    },
    "german": {
      "genus": null,
      "family": "Schwimmfarngewächse",
      "order": null,
      "class": null,
      "phylum": null,
      "kingdom": "Pflanzen"
    }
  }
}
Indexes (Auszug):

db.species.createIndex({ "keys.family": 1 });
db.species.createIndex({ "names.scientific.family": 1 });
db.species.createIndex({ "display.germanName": 1, "display.canonicalName": 1 });
taxa.ndjson als „Single Source of Truth“

Ein Dokument pro Taxon (für alle Ränge, nicht nur Familien).

Felder: taxonKey, parentKey, rank, names.scientific, names.german, path.keys, path.scientific, path.german.

Quelle: direkt aus GBIF (oder aus deinen bereits berechneten Pfaden), damit auch Gattung/Ordnung/Klasse/… vollständig und konsistent sind.

So kannst du:

Taxobaum/Browser effizient rendern,

„alle Arten unter Familie X“ via species.find({"keys.family": X})

spätere Backbone-Änderungen kontrolliert ausrollen (erst taxa, dann betroffene species nachziehen).

„Quick Bootstrap“ (falls du taxa schnell erzeugen willst)
Falls du taxa zunächst nur grob befüllen möchtest, kannst du aus species die distinct-Keys je Rang ziehen und dann gezielt per GBIF nachladen:

// Familien-Keys extrahieren (als Startpunkt)
db.species.aggregate([
  { $match: { "keys.family": { $ne: null } } },
  { $group: { _id: "$keys.family" } }
]);
Mit der Ergebnisliste holst du für jeden Key 1× /species/{key}?language=de + parentKey und baust saubere taxa-Dokumente. Wiederhole das (rekursiv) für parentKey, bis du bei kingdom bist.

Fazit
Ja, Familieninfos (Key + Namen) gehören in species – das beschleunigt 90 % deiner App-Abfragen.

Baue/füttere taxa lieber aus vollständigen GBIF-Daten (bzw. aus deinen Pfaden), nicht nur aus „was in species steht“.

Mit beiden Collections kombiniert bekommst du schnelle Reads und saubere, updatefähige Taxonomie.

Wenn du möchtest, passe ich dein Enrichment-Skript so an, dass es:

erst taxa.ndjson aus allen benötigten Knoten erzeugt (inkl. DE-Namen),

danach species.ndjson mit kompletten Pfaden + Familienfeldern befüllt.



Keine Datei ausgewähltKeine Datei ausgewählt
ChatGPT kann Fehler machen. Überprüfe wichtige Informationen. Siehe Cookie-Voreinstellungen.
