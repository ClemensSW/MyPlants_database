# Prozessdokumentation: Datenaufbereitung für My-Plants

Dieses Dokument beschreibt detailliert, wie die Pflanzendaten für die My-Plants App von GBIF extrahiert, angereichert und aufbereitet werden.

## 🎯 Ziel

Erstellung von zwei MongoDB-kompatiblen NDJSON-Dateien:
1. **species.ndjson** – Taxonomische Daten und deutsche Namen
2. **multimedia.ndjson** – Bild-URLs mit Organ-Tags

## 📊 Datenquelle

**Primäre Quelle:** [PlantNet observations on GBIF](https://www.gbif.org/dataset/7a3679ef-5582-4aaa-81f0-8c2545cafc81)

**GBIF Dataset-Key:** `7a3679ef-5582-4aaa-81f0-8c2545cafc81`

**Warum PlantNet?**
- Crowd-sourced Pflanzenfotografie
- Hohe Bildqualität mit Organ-Zuordnung
- Große Artabdeckung (besonders Europa)
- Community-basierte Validierung

**Zusätzliche Datenquellen:**
- GBIF Species API (taxonomische Namen)
- GBIF Backbone Taxonomy (Synonym-Normalisierung)
- Wikidata API (ergänzende deutsche Namen, optional)

## 🔄 Workflow-Phasen

### Phase 1: TaxonKeys sammeln

**Script:** `scripts/01_fetch_taxonkeys.js`

**Ziel:** Alle eindeutigen `taxonKey` aus dem PlantNet-Dataset extrahieren

#### API-Methode: GBIF Faceting

GBIF bietet ein **Faceting-Feature** für die Occurrence Search API, das effizient alle eindeutigen Werte eines Feldes zurückgibt – ideal für unseren Use-Case.

**API-Endpunkt:**
```
GET https://api.gbif.org/v1/occurrence/search
  ?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81
  &limit=0
  &facet=taxonKey
  &facetLimit=10000
  &facetOffset=0
```

**Parameter-Erklärung:**
- `datasetKey` – Filtert auf PlantNet-Dataset
- `limit=0` – Keine Occurrence-Ergebnisse nötig, nur Facetten
- `facet=taxonKey` – Facettiere nach taxonKey
- `facetLimit=10000` – Max. 10.000 Facetten pro Request
- `facetOffset` – Paging-Offset (0, 10000, 20000, ...)

**Paging-Logik:**
```javascript
let offset = 0;
while (true) {
  const data = await fetch(`...&facetOffset=${offset}`);
  const counts = data.facets[0].counts; // Array von {name: taxonKey, count: occurrences}

  if (!counts.length) break; // Keine weiteren Facetten

  counts.forEach(c => keys.add(Number(c.name)));
  offset += 10000;
}
```

**Output:**
- Datei: `data/intermediate/plantnet_taxonKeys.json`
- Format: Array von Zahlen (taxonKeys)
- Beispiel: `[2650105, 2650107, 2650133, ...]`
- Anzahl: ~18.000 eindeutige taxonKeys (Stand 2025)

**Dauer:** ~5-10 Minuten

---

### Phase 2: Species-Daten anreichern

**Script:** `scripts/02_enrich_species.js`

**Ziel:** Für jeden `taxonKey` vollständige taxonomische Informationen und deutsche Namen abrufen

#### 2.1 Basis-Informationen abrufen

**API-Call 1:** Species-Lookup mit Sprachparameter

```
GET https://api.gbif.org/v1/species/{taxonKey}?language=de
```

**Response-Beispiel:**
```json
{
  "key": 2650105,
  "scientificName": "Azolla caroliniana Willd.",
  "canonicalName": "Azolla caroliniana",
  "rank": "SPECIES",
  "taxonomicStatus": "ACCEPTED",
  "vernacularName": "Großer Algenfarn",  // ⚠️ Nicht immer vorhanden!
  "acceptedKey": null,  // oder eine andere key bei Synonymen
  ...
}
```

**Wichtige Felder:**
- `key` – GBIF taxonKey (eindeutig)
- `scientificName` – Vollständiger wissenschaftlicher Name mit Autor
- `canonicalName` – Name ohne Autor (für Suche/Display)
- `rank` – Taxonomischer Rang (SPECIES, GENUS, FAMILY, ...)
- `taxonomicStatus` – Status (ACCEPTED, SYNONYM, DOUBTFUL, ...)
- `acceptedKey` – Wenn Synonym: Key des akzeptierten Namens
- `vernacularName` – Deutscher Name (wenn `language=de` gesetzt)

#### 2.2 Synonym-Handling

**Problem:** PlantNet-Dataset kann veraltete/synonyme Namen enthalten.

**Lösung:** Normalisierung auf akzeptierte Namen

```javascript
const base = await getSpecies(originalKey, 'de');
const acceptedKey = base.acceptedKey || base.key;

// Wenn Synonym: Nochmal API-Call mit akzeptiertem Key
const usage = (acceptedKey !== base.key)
  ? await getSpecies(acceptedKey, 'de')
  : base;

// → usage enthält immer den akzeptierten Namen
```

**Beispiel:**
- Input: `taxonKey: 123456` (SYNONYM)
- API Response: `acceptedKey: 789012`
- Wir speichern: `taxonKey: 789012` (ACCEPTED)
- → Verhindert Duplikate in der finalen Datenbank

#### 2.3 Deutsche Namen sammeln

**Problem:** `vernacularName` (aus 2.1) ist unvollständig – oft fehlt es oder ist nicht der bevorzugte Name.

**Lösung:** Alle deutschen Namen via Vernacular Names API

**API-Call 2:**
```
GET https://api.gbif.org/v1/species/{acceptedKey}/vernacularNames
```

**Response-Beispiel:**
```json
{
  "results": [
    {
      "vernacularName": "Großer Algenfarn",
      "language": "de",
      "preferred": true,
      "source": "Deutschsprachige Namen der Pflanzen der Welt"
    },
    {
      "vernacularName": "Großer Schwimmfarn",
      "language": "deu",
      "preferred": false,
      "source": "Wikipedia"
    },
    ...
  ]
}
```

**Filterlogik:**
```javascript
const germanNames = results
  .filter(v => ['de', 'deu', 'ger'].includes(v.language.toLowerCase()))
  .map(v => ({
    name: v.vernacularName,
    preferred: !!v.preferred,
    source: v.source || null
  }));

// Deduplizierung (case-insensitive)
germanNames = uniqBy(germanNames, x => x.name.trim().toLowerCase());
```

#### 2.4 Bevorzugter Name wählen

**Priorität:**
1. `vernacularName` aus API-Call 1 (wenn vorhanden)
2. Eintrag mit `preferred: true` aus API-Call 2
3. Erster Eintrag aus API-Call 2
4. `null` (kein deutscher Name verfügbar)

```javascript
function pickPreferredGerman(usage, germanNames) {
  if (usage?.vernacularName) return usage.vernacularName;

  const pref = germanNames.find(v => v.preferred);
  if (pref) return pref.name;

  return germanNames[0]?.name || null;
}
```

#### 2.5 Dokument-Struktur (Phase 2 Output)

```json
{
  "taxonKey": 2650105,
  "acceptedKey": 2650105,
  "originalKey": 2650105,
  "scientificName": "Azolla caroliniana Willd.",
  "canonicalName": "Azolla caroliniana",
  "rank": "SPECIES",
  "status": "ACCEPTED",
  "germanName": "Großer Algenfarn",
  "germanNames": [
    {
      "name": "Großer Algenfarn",
      "preferred": true,
      "source": "Deutschsprachige Namen..."
    },
    {
      "name": "Großer Schwimmfarn",
      "preferred": false,
      "source": "Wikipedia"
    }
  ],
  "source": {
    "derivedFromDatasetKey": "7a3679ef-5582-4aaa-81f0-8c2545cafc81",
    "retrievedAt": "2025-09-07T11:46:38.720Z"
  }
}
```

**Output:**
- Datei: `data/intermediate/plantnet_species_raw.ndjson`
- Format: NDJSON (eine JSON-Zeile pro Art)
- Anzahl: ~18.000 Zeilen

**Dauer:** ~4-6 Stunden (bei Concurrency=10)

**Fehlerbehandlung:**
- Fehlgeschlagene taxonKeys werden in `data/intermediate/failed_keys.txt` protokolliert
- Automatisches Retry mit Exponential Backoff bei HTTP 429/5xx
- Nicht-kritische Fehler (z.B. keine vernacularNames) werden ignoriert

---

### Phase 3: Filtern und Bereinigen

**Script:** `scripts/03_filter_species.js`

**Ziel:** Rohdaten filtern und für MongoDB vorbereiten

#### 3.1 Filter-Kriterien

**1. Nur Species-Rang:**
```javascript
obj.rank === 'SPECIES'
```
→ Entfernt Gattungen, Familien, etc. (nur Arten behalten)

**2. Nur akzeptierte Namen:**
```javascript
obj.status === 'ACCEPTED'
```
→ Entfernt Synonyme, zweifelhafte Namen

**3. Nur mit deutschen Namen:**
```javascript
Array.isArray(obj.germanNames) &&
obj.germanNames.some(x => x.name && x.name.trim().length > 0)
```
→ App zeigt aktuell nur Pflanzen mit deutschen Namen

**Statistik (typisch):**
- Input: ~18.000 Zeilen
- Nach Filter: ~5.500 Zeilen (nur mit deutschem Namen)
- Entfernt: ~12.500 Zeilen

#### 3.2 Felder entfernen

Folgende Felder werden **nicht** für die App benötigt:
- `acceptedKey` (nur für interne Normalisierung)
- `originalKey` (nur für interne Normalisierung)
- `germanName` (redundant, da `germanNames[]` vorhanden)
- `source` (Audit-Info, nicht für App nötig)

**Finale Struktur (Phase 3 Output):**
```json
{
  "taxonKey": 2650105,
  "scientificName": "Azolla caroliniana Willd.",
  "canonicalName": "Azolla caroliniana",
  "rank": "SPECIES",
  "status": "ACCEPTED",
  "germanNames": [
    {
      "name": "Großer Algenfarn",
      "preferred": true,
      "source": "Deutschsprachige Namen..."
    }
  ]
}
```

**Output:**
- Datei: `data/output/species.ndjson`
- Format: NDJSON
- Anzahl: ~5.500 Zeilen (nur mit deutschem Namen)

**Dauer:** ~1 Minute

---

### Phase 4: Multimedia sammeln

**Script:** `scripts/04_collect_multimedia.js`

**Ziel:** Bilder mit Organ-Tags für alle Species sammeln

#### 4.1 Occurrence Search mit Bildern

**API-Call:**
```
GET https://api.gbif.org/v1/occurrence/search
  ?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81
  &taxonKey={taxonKey}
  &mediaType=StillImage
  &limit=300
  &offset=0
```

**Parameter:**
- `taxonKey` – Filtert auf eine Art
- `mediaType=StillImage` – Nur Occurrences mit Bildern
- `limit=300` – Max. Ergebnisse pro Request
- `offset` – Paging (0, 300, 600, ...)

**Paging bis `endOfRecords: true`:**
```javascript
let offset = 0;
while (true) {
  const data = await searchOccurrences({...params, offset});

  for (const occ of data.results) {
    // Bilder extrahieren
  }

  if (data.endOfRecords) break;
  offset += 300;
}
```

#### 4.2 Bild-Extraktion aus Occurrence

**Zwei Quellen für Bilder:**

**1. `media[]` Array (Standard):**
```json
{
  "key": 3949914583,
  "media": [
    {
      "identifier": "https://bs.plantnet.org/image/o/9ada0341236d...",
      "license": "CC BY-SA 4.0",
      "rightsHolder": "Alexandre Crégu"
    }
  ]
}
```

**2. Audubon Core Extension (zusätzliche Metadaten):**
```json
{
  "extensions": {
    "http://rs.tdwg.org/ac/terms/Multimedia": [
      {
        "identifier": "https://bs.plantnet.org/...",
        "ac:subjectPart": "leaf",  // ← Organ-Tag!
        "license": "CC BY-SA 4.0"
      }
    ]
  }
}
```

#### 4.3 Organ-Tag-Extraktion

**Priorität:**
1. **Audubon Core `ac:subjectPart`** (explizite Organ-Zuordnung)
2. **URL-Parameter** (`?organ=leaf` oder `?organs=leaf`)
3. **URL-Pfad** (`/leaf/`, `/flower/`, etc.)
4. **null** (kein Tag gefunden)

**Mögliche Tag-Werte:**
- `leaf` (Blatt)
- `flower` (Blüte)
- `fruit` (Frucht)
- `bark` (Rinde)
- `habit` (Habitus/Gesamtpflanze)
- `other` (Sonstiges)
- `null` (unbekannt)

**Implementierung:**
```javascript
function extractOrganTag(media, url) {
  // 1. Aus Audubon Core
  if (media['ac:subjectPart']) return media['ac:subjectPart'];

  // 2. Aus URL-Parametern
  const u = new URL(url);
  const organ = u.searchParams.get('organ') || u.searchParams.get('organs');
  if (organ) return organ.toLowerCase();

  // 3. Aus URL-Pfad
  const path = u.pathname.toLowerCase();
  if (path.includes('/leaf/')) return 'leaf';
  if (path.includes('/flower/')) return 'flower';
  // ...

  return null;
}
```

#### 4.4 URL-Proxying

**Problem:** Direkte PlantNet-URLs können langsam sein oder keine Größen-Anpassung bieten.

**Lösung:** Weserv Image Proxy

**Original:**
```
https://bs.plantnet.org/image/o/9ada0341236d166bae22e7ac1cd5cd538afbd4d9
```

**Proxied:**
```
https://images.weserv.nl/?url=https%3A%2F%2Fbs.plantnet.org%2Fimage%2Fo%2F9ada0341236d166bae22e7ac1cd5cd538afbd4d9
```

**Vorteile:**
- On-the-fly Größen-Anpassung (`&w=400&h=400`)
- Qualitäts-Kompression (`&q=80`)
- Caching & CDN
- Format-Konvertierung (`&output=webp`)

**Beispiele:**
```
# Thumbnail (400x400)
https://images.weserv.nl/?url=...&w=400&h=400&fit=cover

# Optimiert für Mobile
https://images.weserv.nl/?url=...&w=800&q=75&output=webp

# Vollbild
https://images.weserv.nl/?url=...&w=1920&q=90
```

#### 4.5 Deduplizierung

**Problem:** Manche Bilder tauchen in mehreren Occurrences auf.

**Lösung:** Set für Original-URLs (vor Proxying)

```javascript
const seen = new Set();

for (const img of images) {
  const originalUrl = new URL(img.url).searchParams.get('url');
  if (seen.has(originalUrl)) continue;
  seen.add(originalUrl);

  // Bild hinzufügen
}
```

#### 4.6 Multimedia-Dokument-Struktur

```json
{
  "taxonKey": 2650105,
  "species": "Azolla caroliniana Willd.",
  "organ": "leaf",
  "occurrenceId": 3949914583,
  "url": "https://images.weserv.nl/?url=https%3A%2F%2Fbs.plantnet.org%2F...",
  "license": "Alexandre Crégu (cc-by-sa)",
  "wilsonScore": null
}
```

**Felder:**
- `taxonKey` – Verknüpfung zu species.ndjson
- `species` – Wissenschaftlicher Name (für Anzeige)
- `organ` – Organ-Tag (leaf/flower/...)
- `occurrenceId` – GBIF Occurrence-ID (für Attribution)
- `url` – Proxied URL
- `license` – Lizenz & Urheber
- `wilsonScore` – Placeholder für zukünftige Bewertung (ML-gestützt)

**Output:**
- Datei: `data/output/multimedia.ndjson`
- Format: NDJSON (ein Bild pro Zeile)
- Anzahl: ~3.166.000 Zeilen (Stand 2025)

**Dauer:** ~8-12 Stunden (bei Concurrency=6)

---

## 🔧 Technische Details

### Retry-Strategie

**Exponential Backoff bei Fehlern:**

```javascript
async function fetchWithRetry(url, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (i === maxRetries - 1) throw err;

      const status = err.response?.status;
      if (status === 429 || status >= 500) {
        const backoff = 500 * Math.pow(2, i);  // 500ms, 1s, 2s, 4s, 8s
        await sleep(backoff);
        continue;
      }
      throw err;  // Bei anderen Fehlern: nicht retry
    }
  }
}
```

**Retry bei:**
- HTTP 429 (Rate Limit)
- HTTP 5xx (Server-Fehler)
- Netzwerk-Timeouts

**Kein Retry bei:**
- HTTP 404 (Not Found)
- HTTP 400 (Bad Request)

### Parallelisierung

**p-limit für Concurrency-Control:**

```javascript
const pLimit = require('p-limit');
const limit = pLimit(10);  // Max. 10 parallele Requests

const tasks = taxonKeys.map(key =>
  limit(() => processKey(key))
);

await Promise.all(tasks);
```

**Empfohlene Werte:**
- Phase 2 (Species): Concurrency=10
- Phase 4 (Multimedia): Concurrency=6 (mehr Daten pro Request)

### Progress-Anzeige

```javascript
let done = 0;
const total = taxonKeys.length;

function progress() {
  if (process.stdout.isTTY) {
    const percent = ((done / total) * 100).toFixed(1);
    process.stdout.write(`\rVerarbeitet: ${done}/${total} (${percent}%)`);
  }
}

// Nach jedem abgeschlossenen Task:
done++;
progress();
```

---

## 📈 Statistiken & Benchmarks

### Typische Zahlen (Stand September 2025)

| Phase | Input | Output | Dauer | Größe |
|-------|-------|--------|-------|-------|
| 1 | GBIF API | 18.673 taxonKeys | 5-10 min | 200 KB |
| 2 | 18.673 taxonKeys | 18.673 Species | 4-6 h | 9 MB |
| 3 | 18.673 Species | 5.464 Species | 1 min | 2.5 MB |
| 4 | 5.464 Species | 3.166.029 Bilder | 8-12 h | 850 MB |

### Fehlerquoten

**Phase 2 (Species):**
- Typisch: <1% failed taxonKeys
- Ursachen: HTTP 404 (taxonKey existiert nicht mehr), Timeouts

**Phase 4 (Multimedia):**
- Typisch: <0.1% Fehler pro Art
- Ursachen: API-Timeouts bei sehr häufigen Arten (>100k Occurrences)

---

## 🔄 Wiederholbarkeit

### Delta-Updates (Inkrementell)

**Szenario:** Nur neue taxonKeys seit letztem Run verarbeiten

**Ansatz:**
1. Alte `plantnet_taxonKeys.json` als `old_keys.json` speichern
2. Phase 1 neu ausführen → `new_keys.json`
3. Diff berechnen: `diff = new_keys - old_keys`
4. Phase 2-4 nur mit `diff` ausführen
5. Ergebnisse in MongoDB mergen (via `upsert`)

**Implementierung:**
```javascript
const oldKeys = JSON.parse(fs.readFileSync('old_keys.json'));
const newKeys = JSON.parse(fs.readFileSync('new_keys.json'));

const deltaKeys = newKeys.filter(k => !oldKeys.includes(k));
console.log(`Delta: ${deltaKeys.length} neue taxonKeys`);

// Phase 2-4 nur mit deltaKeys ausführen
```

### Komplett-Rebuild

**Empfohlen:** Alle 3-6 Monate

**Grund:**
- GBIF Backbone-Updates (neue Synonyme, geänderte Namen)
- Neue Bilder für bestehende Arten
- Korrigierte deutsche Namen

**Aufwand:** ~12-18 Stunden Gesamtlaufzeit

---

## ⚠️ Bekannte Limitierungen

### GBIF API Limits

**Occurrence Search:**
- Max. ~100.000 Ergebnisse pro Query (via Paging)
- Bei sehr häufigen Arten: Download API nutzen (DWCA-Format)

**Rate Limits:**
- Keine festen Limits dokumentiert
- Bei sehr hoher Last: HTTP 429
- Automatisches Backoff in Scripts implementiert

### Datenqualität

**Deutsche Namen:**
- Nicht alle Arten haben deutsche Namen (~30% Coverage)
- Mehrere Namen möglich (Synonyme, regionale Varianten)
- Keine zentrale Autorität → Quellen-basiert

**Organ-Tags:**
- Nicht alle Bilder haben Tags (~20% haben `null`)
- Tag-Qualität variiert je nach Contributor
- Mögliche Fehl-Zuordnungen

**Bilder:**
- Qualität schwankt (User-Generated Content)
- Lizenzen variieren (meist CC-BY oder CC-BY-SA)
- Manche Arten haben sehr viele, andere sehr wenige Bilder

---

## 🎓 Lessons Learned

### Was gut funktioniert hat

1. **Faceting für taxonKeys** – Viel schneller als alle Occurrences zu durchsuchen
2. **NDJSON-Format** – Streaming-fähig, einfach zu parsen, MongoDB-kompatibel
3. **Modularisierung** – Klare Phasen mit definierten Inputs/Outputs
4. **Retry-Logik** – Robustheit bei API-Instabilitäten
5. **Weserv-Proxy** – Bessere Performance und Flexibilität für Bildgrößen

### Herausforderungen & Lösungen

**Challenge:** GBIF API Rate Limits bei hoher Concurrency
→ **Lösung:** Exponential Backoff + moderate Concurrency (6-10)

**Challenge:** Inkonsistente deutsche Namen (mehrere Quellen)
→ **Lösung:** Alle Namen speichern, preferred-Flag auswerten

**Challenge:** Fehlende Organ-Tags bei vielen Bildern
→ **Lösung:** Mehrere Extraktionsmethoden (AC, URL-Parameter, Pfad)

**Challenge:** Sehr lange Laufzeiten für komplette Pipeline
→ **Lösung:** Zwischenschritte speichern, resumable Design

---

## 📚 Weiterführende Links

- [GBIF API Documentation](https://techdocs.gbif.org/en/openapi/)
- [GBIF Occurrence Search](https://www.gbif.org/developer/occurrence)
- [Audubon Core Standard](https://ac.tdwg.org/)
- [Weserv Image Proxy Docs](https://images.weserv.nl/docs/)
- [PlantNet Dataset on GBIF](https://www.gbif.org/dataset/7a3679ef-5582-4aaa-81f0-8c2545cafc81)

---

**Dokumentversion:** 1.0 (September 2025)
