# GBIF API Referenz für My-Plants

Dieses Dokument enthält alle relevanten GBIF API Endpoints, Parameter, Best Practices und Troubleshooting-Tipps für die My-Plants Datenbeschaffung.

## 🌐 Basis-Informationen

**GBIF API Base URL:** `https://api.gbif.org/v1`

**Dokumentation:** [techdocs.gbif.org](https://techdocs.gbif.org/en/openapi/)

**Rate Limits:** Keine festen Limits, aber bei sehr hoher Last: HTTP 429

**Authentication:** Nicht erforderlich für Read-Operations

---

## 📡 Verwendete Endpoints

### 1. Occurrence Search (mit Faceting)

**Verwendung:** Phase 1 – TaxonKeys sammeln

#### Endpoint
```
GET /v1/occurrence/search
```

#### Parameter

| Parameter | Typ | Beschreibung | Pflicht | Beispiel |
|-----------|-----|--------------|---------|----------|
| `datasetKey` | UUID | Filtert nach Dataset | Ja | `7a3679ef-5582-4aaa-81f0-8c2545cafc81` |
| `limit` | Integer | Anzahl Ergebnisse (0-300) | Nein | `0` (für Faceting) |
| `offset` | Integer | Paging-Offset | Nein | `0` |
| `facet` | String | Feld zum Facettieren | Nein | `taxonKey` |
| `facetLimit` | Integer | Max. Facetten pro Request (max 10.000) | Nein | `10000` |
| `facetOffset` | Integer | Facet-Paging-Offset | Nein | `0` |
| `taxonKey` | Integer | Filtert nach Art | Nein | `2650105` |
| `mediaType` | String | Filtert nach Medium-Typ | Nein | `StillImage` |

#### Beispiel-Request (Faceting)
```bash
curl -X GET "https://api.gbif.org/v1/occurrence/search?\
datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81&\
limit=0&\
facet=taxonKey&\
facetLimit=10000&\
facetOffset=0"
```

#### Response-Struktur
```json
{
  "offset": 0,
  "limit": 0,
  "endOfRecords": false,
  "count": 12847302,
  "results": [],
  "facets": [
    {
      "field": "TAXON_KEY",
      "counts": [
        {
          "name": "2650105",
          "count": 42857
        },
        {
          "name": "2650107",
          "count": 38142
        }
        // ... bis zu 10.000 Einträge
      ]
    }
  ]
}
```

#### Beispiel-Request (Occurrences mit Bildern)
```bash
curl -X GET "https://api.gbif.org/v1/occurrence/search?\
datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81&\
taxonKey=2650105&\
mediaType=StillImage&\
limit=300&\
offset=0"
```

#### Response-Struktur (mit Media)
```json
{
  "offset": 0,
  "limit": 300,
  "endOfRecords": false,
  "count": 42857,
  "results": [
    {
      "key": 3949914583,
      "datasetKey": "7a3679ef-5582-4aaa-81f0-8c2545cafc81",
      "taxonKey": 2650105,
      "scientificName": "Azolla caroliniana Willd.",
      "media": [
        {
          "type": "StillImage",
          "identifier": "https://bs.plantnet.org/image/o/9ada0341...",
          "license": "http://creativecommons.org/licenses/by-sa/4.0/",
          "rightsHolder": "Alexandre Crégu"
        }
      ],
      "extensions": {
        "http://rs.tdwg.org/ac/terms/Multimedia": [
          {
            "http://purl.org/dc/terms/identifier": "https://bs.plantnet.org/...",
            "ac:subjectPart": "leaf",
            "http://purl.org/dc/terms/license": "CC BY-SA 4.0"
          }
        ]
      }
    }
  ]
}
```

#### Paging

**Standard-Paging (für Occurrences):**
```javascript
let offset = 0;
while (true) {
  const data = await fetch(`...&offset=${offset}`);
  // Verarbeite data.results

  if (data.endOfRecords) break;
  offset += data.limit;
}
```

**Facet-Paging:**
```javascript
let facetOffset = 0;
while (true) {
  const data = await fetch(`...&facetOffset=${facetOffset}`);
  const counts = data.facets[0].counts;

  if (!counts.length) break;
  // Verarbeite counts

  facetOffset += 10000;
}
```

---

### 2. Species Lookup

**Verwendung:** Phase 2 – Species-Informationen abrufen

#### Endpoint
```
GET /v1/species/{key}
```

#### Parameter

| Parameter | Typ | Beschreibung | Pflicht | Beispiel |
|-----------|-----|--------------|---------|----------|
| `key` | Integer | GBIF taxonKey | Ja | `2650105` |
| `language` | String (ISO 639-1) | Sprache für vernacularName | Nein | `de` |

#### Beispiel-Request
```bash
curl -X GET "https://api.gbif.org/v1/species/2650105?language=de"
```

#### Response-Struktur
```json
{
  "key": 2650105,
  "datasetKey": "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c",
  "nubKey": 2650105,
  "parentKey": 7323136,
  "parent": "Azolla",
  "kingdom": "Plantae",
  "phylum": "Tracheophyta",
  "class": "Polypodiopsida",
  "order": "Salviniales",
  "family": "Salviniaceae",
  "genus": "Azolla",
  "species": "Azolla caroliniana",
  "kingdomKey": 6,
  "phylumKey": 7707728,
  "classKey": 7707729,
  "orderKey": 7228682,
  "familyKey": 7346,
  "genusKey": 7323136,
  "speciesKey": 2650105,
  "scientificName": "Azolla caroliniana Willd.",
  "canonicalName": "Azolla caroliniana",
  "authorship": "Willd.",
  "nameType": "SCIENTIFIC",
  "rank": "SPECIES",
  "origin": "SOURCE",
  "taxonomicStatus": "ACCEPTED",
  "nomenclaturalStatus": [],
  "threatStatuses": [],
  "vernacularName": "Großer Algenfarn",
  "acceptedKey": null,
  "accepted": "Azolla caroliniana Willd.",
  "publishedIn": "Sp. Pl., ed. 4 [Willdenow] 5(1): 541 (1810)"
}
```

#### Wichtige Response-Felder

| Feld | Beschreibung | Verwendung |
|------|--------------|------------|
| `key` | GBIF taxonKey | Eindeutige ID |
| `scientificName` | Vollständiger Name mit Autor | Display |
| `canonicalName` | Name ohne Autor | Suche |
| `rank` | Taxonomischer Rang | Filter |
| `taxonomicStatus` | Status (ACCEPTED/SYNONYM/...) | Filter |
| `acceptedKey` | Bei Synonym: Key des akzeptierten Namens | Normalisierung |
| `vernacularName` | Trivialnamen (wenn `language=de`) | Display |
| `familyKey`, `genusKey`, etc. | Keys höherer Ränge | Taxonomie-Baum |

---

### 3. Vernacular Names

**Verwendung:** Phase 2 – Deutsche Namen abrufen

#### Endpoint
```
GET /v1/species/{key}/vernacularNames
```

#### Parameter

| Parameter | Typ | Beschreibung | Pflicht | Beispiel |
|-----------|-----|--------------|---------|----------|
| `key` | Integer | GBIF taxonKey | Ja | `2650105` |

#### Beispiel-Request
```bash
curl -X GET "https://api.gbif.org/v1/species/2650105/vernacularNames"
```

#### Response-Struktur
```json
{
  "offset": 0,
  "limit": 100,
  "endOfRecords": true,
  "results": [
    {
      "taxonKey": 2650105,
      "vernacularName": "Großer Algenfarn",
      "language": "de",
      "preferred": true,
      "source": "Deutschsprachige Namen der Pflanzen der Welt",
      "sourceTaxonKey": 2650105
    },
    {
      "taxonKey": 2650105,
      "vernacularName": "Carolina mosquito fern",
      "language": "en",
      "preferred": false,
      "source": "The Plant List"
    },
    {
      "taxonKey": 2650105,
      "vernacularName": "Großer Schwimmfarn",
      "language": "deu",
      "preferred": false,
      "source": "Wikipedia"
    }
  ]
}
```

#### Filter-Logik für deutsche Namen

```javascript
const germanNames = results
  .filter(v => {
    const lang = v.language?.toLowerCase();
    return lang === 'de' || lang === 'deu' || lang === 'ger';
  });
```

**Sprach-Codes für Deutsch:**
- `de` (ISO 639-1, häufigster Code)
- `deu` (ISO 639-2/T)
- `ger` (ISO 639-2/B, veraltet)

---

## ⚠️ Rate Limits & Fehlerbehandlung

### HTTP Status Codes

| Code | Bedeutung | Aktion |
|------|-----------|--------|
| `200 OK` | Erfolg | Normal weiter |
| `404 Not Found` | Ressource nicht gefunden | Fehlschlag loggen, nicht retry |
| `429 Too Many Requests` | Rate Limit überschritten | **Retry mit Backoff** |
| `500 Internal Server Error` | Server-Fehler | **Retry mit Backoff** |
| `502 Bad Gateway` | Gateway-Fehler | **Retry mit Backoff** |
| `503 Service Unavailable` | Service temporär down | **Retry mit Backoff** |
| `504 Gateway Timeout` | Timeout | **Retry mit Backoff** |

### Exponential Backoff Strategie

```javascript
async function fetchWithRetry(url, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 20000 });
      return response.data;
    } catch (err) {
      const status = err.response?.status;

      // Retry-Bedingungen
      const shouldRetry = (
        status === 429 ||
        (status >= 500 && status <= 599) ||
        !status  // Netzwerk-Fehler
      );

      if (shouldRetry && attempt < maxRetries - 1) {
        // Exponential Backoff: 500ms, 1s, 2s, 4s, 8s
        const backoff = 500 * Math.pow(2, attempt);
        console.warn(`Retry ${attempt + 1}/${maxRetries} nach ${backoff}ms (Status: ${status || 'Network Error'})`);
        await sleep(backoff);
        continue;
      }

      // Kein Retry mehr oder nicht retry-fähiger Fehler
      throw err;
    }
  }
}
```

### Timeout-Konfiguration

**Empfohlene Timeouts:**
- **Species Lookup:** 20 Sekunden
- **Vernacular Names:** 20 Sekunden
- **Occurrence Search (kleine Results):** 30 Sekunden
- **Occurrence Search (mit Faceting):** 30 Sekunden

```javascript
axios.get(url, {
  timeout: 20000,  // 20 Sekunden
  headers: {
    'User-Agent': 'MyPlantsApp/1.0 (contact@myplants.de)'
  }
});
```

### Best Practices für hohen Durchsatz

**1. Moderate Concurrency:**
```javascript
const pLimit = require('p-limit');
const limit = pLimit(10);  // Max. 10 parallele Requests

const tasks = taxonKeys.map(key =>
  limit(() => processKey(key))
);

await Promise.all(tasks);
```

**2. Request-Delay:**
```javascript
// Zwischen Requests kurz warten (200ms)
await sleep(200);
```

**3. User-Agent setzen:**
```javascript
axios.defaults.headers.common['User-Agent'] = 'MyPlantsApp/1.0 (contact@myplants.de)';
```

**4. Connection-Pooling:**
```javascript
const axios = require('axios');
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
```

---

## 📊 API-Limits & Empfehlungen

### Documented Limits

| Feature | Limit | Hinweis |
|---------|-------|---------|
| Occurrence Search Results | ~100.000 | Via Paging; darüber hinaus: Download API nutzen |
| Facet Results | 10.000 pro Request | Via `facetLimit` & `facetOffset` Paging |
| Page Size (`limit`) | 300 max | Empfohlen: 300 für Occurrence, 0 für Faceting |
| Request Rate | Keine festen Limits | Bei Missbrauch: HTTP 429 |

### Undocumented Best Practices

**Basierend auf Community-Erfahrung:**
- Max. 10-20 parallele Requests
- Durchschnittlich <500 Requests/Minute
- Bei HTTP 429: mindestens 5-10 Sekunden Pause

---

## 🔍 Query-Optimierungen

### Faceting vs. Full Search

**✅ Faceting verwenden für:**
- Eindeutige Werte eines Feldes (z.B. alle taxonKeys)
- Statistiken/Aggregationen
- Deutlich schneller als Full Search

**❌ Nicht verwenden für:**
- Zugriff auf Occurrence-Details (nutze normale Search)

### Filter-Reihenfolge

**Effiziente Filter-Kombination:**
```
1. datasetKey (sehr selektiv)
2. taxonKey (sehr selektiv)
3. mediaType (selektiv)
4. andere Filter
```

**Beispiel:**
```
?datasetKey=...&taxonKey=...&mediaType=StillImage
```

→ Nutzt Indexes optimal, schnelle Response

---

## 🧪 Testing & Debugging

### Test-TaxonKeys

**Häufige Arten für Tests:**
| TaxonKey | Art | Vorkommen | Bilder |
|----------|-----|-----------|--------|
| 2650105 | Azolla caroliniana | ~40k | ~15k |
| 5352450 | Quercus robur | ~200k | ~80k |
| 5284517 | Hedera helix | ~150k | ~60k |

### Debugging mit Browser

**Occurrence Search (Faceting):**
```
https://api.gbif.org/v1/occurrence/search?datasetKey=7a3679ef-5582-4aaa-81f0-8c2545cafc81&limit=0&facet=taxonKey&facetLimit=100&facetOffset=0
```

**Species Lookup:**
```
https://api.gbif.org/v1/species/2650105?language=de
```

**Vernacular Names:**
```
https://api.gbif.org/v1/species/2650105/vernacularNames
```

### cURL-Beispiele

**Mit Pretty-Print (via jq):**
```bash
curl -s "https://api.gbif.org/v1/species/2650105?language=de" | jq .
```

**Response-Zeit messen:**
```bash
time curl -s "https://api.gbif.org/v1/species/2650105" > /dev/null
```

**Mit Retry-Logik (via Bash):**
```bash
for i in {1..5}; do
  curl -s "https://api.gbif.org/v1/species/2650105" && break
  echo "Retry $i..."
  sleep $((2**i))
done
```

---

## 📚 Weitere Ressourcen

### Offizielle Dokumentation

- **OpenAPI Spec:** [techdocs.gbif.org/en/openapi](https://techdocs.gbif.org/en/openapi/)
- **Developer Guide:** [techdocs.gbif.org/en/data-use](https://techdocs.gbif.org/en/data-use)
- **Occurrence API:** [techdocs.gbif.org/en/openapi/v1/occurrence](https://techdocs.gbif.org/en/openapi/v1/occurrence)
- **Species API:** [techdocs.gbif.org/en/openapi/v1/species](https://techdocs.gbif.org/en/openapi/v1/species)

### Community-Ressourcen

- **GBIF Community Forum:** [discourse.gbif.org](https://discourse.gbif.org/)
- **GitHub Issues:** [github.com/gbif/gbif-api](https://github.com/gbif/gbif-api/issues)
- **Data Blog:** [data-blog.gbif.org](https://data-blog.gbif.org/)

### Standards & Spezifikationen

- **Darwin Core:** [dwc.tdwg.org](https://dwc.tdwg.org/)
- **Audubon Core (Multimedia):** [ac.tdwg.org](https://ac.tdwg.org/)
- **GBIF Backbone Taxonomy:** [gbif.org/dataset/d7dddbf4](https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c)

### Datasets

- **PlantNet observations:** [gbif.org/dataset/7a3679ef](https://www.gbif.org/dataset/7a3679ef-5582-4aaa-81f0-8c2545cafc81)

---

## ⚖️ Lizenzen & Attribution

### Datennutzung

**GBIF-Daten unterliegen verschiedenen Lizenzen:**
- **CC0 (Public Domain)** – Frei nutzbar
- **CC BY 4.0** – Attribution erforderlich
- **CC BY-SA 4.0** – Attribution + ShareAlike
- **CC BY-NC 4.0** – Attribution + Non-Commercial

**PlantNet-Bilder:** Meist CC BY oder CC BY-SA

### Citation Guidelines

**Mindestanforderung (GBIF empfohlen):**
```
GBIF.org (DD MMMM YYYY) GBIF Occurrence Download https://doi.org/10.15468/dl.xxxxx
```

**Für My-Plants App (Vorschlag):**
```
Pflanzendaten bereitgestellt von GBIF (gbif.org) und PlantNet (plantnet.org).
```

**Lizenz-Handling in App:**
- Lizenz pro Bild anzeigen (siehe `multimedia.license`)
- Link zum GBIF Occurrence (via `occurrenceId`)

---

**Dokumentversion:** 1.0 (September 2025)
