# Zukünftige Erweiterung: Manuelle Kuratierung & Prüfungsoptimierung

**Status**: Konzept für zukünftige Implementierung
**Datum**: 2026-01-30
**Zweck**: Dokumentation für spätere Implementierung einer Zwei-Quellen-Architektur

---

## 🎯 Ziel

Ermöglichen von **manuellen Ergänzungen und Anpassungen** zusätzlich zu den automatischen GBIF/Wikidata-Daten, um die Datenbank optimal für Prüfungsvorgaben vorzubereiten.

### Use Cases:
1. **Ergänzungen**: Pflanzen hinzufügen, die GBIF nicht hat, aber prüfungsrelevant sind
2. **Anpassungen**: Deutsche Namen ändern, um Prüfungsvorgaben zu entsprechen
   - Beispiel: GBIF "Gewöhnliche Vogelmiere" → Prüfung "Vogelmiere"
3. **Flexibilität**: Wahl zwischen "rein automatisch" und "prüfungsoptimiert" bei Multimedia-Sammlung

---

## 📊 Zwei-Quellen-Architektur

### Quelle 1: Automatische Baseline (GBIF + Wikidata)
- Regelmäßig aktualisierbar durch Pipeline-Re-Run
- Unveränderte "ground truth" Daten
- Reproduzierbar und versionierbar

### Quelle 2: Manuell kuratierte Daten
- Kontrollierte Anpassungen in separater Datei
- Git-versioniert für Nachvollziehbarkeit
- Hat Vorrang bei Konflikten (Override-Logik)

---

## 🗂️ Vorgeschlagene Dateistruktur

```
data/intermediate/
├── species_raw.ndjson              # Alle ~18.673 von GBIF (wie bisher)
├── species_enriched.ndjson         # Mit Wikidata angereichert (wie bisher)
├── species_auto.ndjson             # Gefiltert: NUR mit deutschen Namen (NEU)
├── species_missing_german.ndjson   # Gefiltert: OHNE deutsche Namen (NEU)
└── species_manual.ndjson           # Manuelle Ergänzungen/Overrides (NEU)

data/final/
└── species.ndjson                  # Merged: auto + manual (NEU)
```

---

## 🔄 Erweiterter Workflow

### Aktuelle Pipeline (Phasen 1-5):
```
Phase 1: fetch_taxonkeys       → taxonKeys.json
Phase 2: enrich_species         → species_raw.ndjson + species_enriched.ndjson
Phase 3: enrich_wikidata        → species_enriched.ndjson (updated)
Phase 4: filter_species         → species.ndjson
Phase 5: collect_multimedia     → multimedia.ndjson
```

### Erweiterte Pipeline (mit manueller Kuratierung):

```
Phase 1-3: Unverändert
    ↓
Phase 4a: filter_species.js (erweitert)
    → Erzeugt: species_auto.ndjson (MIT deutschen Namen)
    → Erzeugt: species_missing_german.ndjson (OHNE deutsche Namen)
    ↓
Phase 4b: Manueller Schritt (DU)
    → Erstellen/Bearbeiten: species_manual.ndjson
    → Format: Identisch zu species_auto.ndjson
    → Beispiele:
      - Override: taxonKey existiert schon → manuelle Version überschreibt
      - Addition: taxonKey ist neu → wird hinzugefügt
    ↓
Phase 4c: merge_species.js (NEU)
    → Merged species_auto.ndjson + species_manual.ndjson
    → Regel: Manuelle Daten haben Vorrang (Override)
    → Output: data/final/species.ndjson
    ↓
Phase 5: collect_multimedia.js (erweitert)
    → Nutzt: data/final/species.ndjson (Standard)
    → ODER: --auto-only Flag (nutzt nur species_auto.ndjson)
```

---

## 📝 Format: species_manual.ndjson

### Beispiel-Einträge:

```json
// Override: Deutschen Namen anpassen
{
  "taxonKey": 2984141,
  "scientificName": "Aesculus hippocastanum L.",
  "canonicalName": "Aesculus hippocastanum",
  "germanName": "Rosskastanie",
  "family": "Sapindaceae",
  "familyKey": 5481,
  "germanFamilyName": "Seifenbaumgewächse",
  "_source": "manual",
  "_reason": "Prüfungsvorgabe 2026"
}

// Addition: Neue Pflanze hinzufügen
{
  "taxonKey": 9999999,
  "scientificName": "Plantus exampleus L.",
  "canonicalName": "Plantus exampleus",
  "germanName": "Beispielpflanze",
  "family": "Exampleaceae",
  "familyKey": 8888888,
  "germanFamilyName": "Beispielgewächse",
  "_source": "manual",
  "_reason": "Prüfungsrelevant, aber nicht in GBIF"
}
```

### Metadaten-Felder (optional):
- `_source`: Immer "manual" für Tracking
- `_reason`: Warum wurde angepasst/hinzugefügt
- `_date`: Zeitstempel der Anpassung
- `_semester`: Z.B. "WS2026" für prüfungsspezifische Versionen

---

## 💻 Implementierung: merge_species.js

### Pseudo-Code:

```javascript
const fs = require('fs');
const readline = require('readline');

async function mergeSpecies() {
  // 1. Lese automatische Daten
  const autoSpecies = new Map();
  const autoStream = readline.createInterface({
    input: fs.createReadStream('data/intermediate/species_auto.ndjson')
  });

  for await (const line of autoStream) {
    const species = JSON.parse(line);
    autoSpecies.set(species.taxonKey, species);
  }

  console.log(`✅ Geladen: ${autoSpecies.size} automatische Species`);

  // 2. Lese manuelle Daten (mit Override)
  let manualCount = 0;
  let overrideCount = 0;
  let additionCount = 0;

  if (fs.existsSync('data/intermediate/species_manual.ndjson')) {
    const manualStream = readline.createInterface({
      input: fs.createReadStream('data/intermediate/species_manual.ndjson')
    });

    for await (const line of manualStream) {
      const species = JSON.parse(line);
      manualCount++;

      if (autoSpecies.has(species.taxonKey)) {
        overrideCount++;
        console.log(`🔄 Override: ${species.taxonKey} → ${species.germanName}`);
      } else {
        additionCount++;
        console.log(`➕ Addition: ${species.taxonKey} → ${species.germanName}`);
      }

      autoSpecies.set(species.taxonKey, species); // Überschreibt oder fügt hinzu
    }
  } else {
    console.log(`ℹ️  Keine manuellen Daten gefunden (species_manual.ndjson fehlt)`);
  }

  // 3. Schreibe gemergtes Ergebnis
  const output = fs.createWriteStream('data/final/species.ndjson');
  for (const species of autoSpecies.values()) {
    output.write(JSON.stringify(species) + '\n');
  }
  output.end();

  console.log(`\n✅ Merge abgeschlossen:`);
  console.log(`   - Gesamt: ${autoSpecies.size} Species`);
  console.log(`   - Manuell: ${manualCount} (${overrideCount} Overrides, ${additionCount} Additions)`);
}

mergeSpecies().catch(console.error);
```

---

## 🚀 Erweiterte Phase 5: collect_multimedia.js

### Flag-Unterstützung:

```javascript
const args = process.argv.slice(2);
const autoOnly = args.includes('--auto-only');

const speciesFile = autoOnly
  ? 'data/intermediate/species_auto.ndjson'
  : 'data/final/species.ndjson';

console.log(`📂 Nutze: ${speciesFile}`);
```

### Verwendung:

```bash
# Standard: Mit manuellen Daten
node scripts/05_collect_multimedia.js

# Nur automatische Daten
node scripts/05_collect_multimedia.js --auto-only
```

---

## ✅ Vorteile dieses Ansatzes

1. **Single Source of Truth**: `species_manual.ndjson` ist einzige Stelle für Anpassungen
2. **Audit Trail**: Git-Versioning zeigt genau, welche Namen wann geändert wurden
3. **Rollback-fähig**: Jederzeit zurück zu "nur automatisch" möglich
4. **Reproduzierbar**: Automatische Pipeline bleibt unverändert und re-runnable
5. **Skalierbar**: Funktioniert auch mit 100+ manuellen Anpassungen
6. **Testbar**: Beide Modi (mit/ohne manual) parallel testbar
7. **Separation of Concerns**: Klare Trennung von automatischen und manuellen Daten

---

## 🛠️ Benötigte Änderungen an existierenden Scripts

### 1. `scripts/04_filter_species.js`

**Aktuell**: Schreibt `data/final/species.ndjson` (gefiltert)

**Neu**: Schreibt zusätzlich:
- `data/intermediate/species_auto.ndjson` (nur MIT deutschen Namen)
- `data/intermediate/species_missing_german.ndjson` (nur OHNE deutsche Namen)

```javascript
// Am Ende von filter_species.js:
const withGerman = [];
const withoutGerman = [];

for await (const line of rl) {
  const species = JSON.parse(line);

  if (species.germanName) {
    withGerman.push(species);
  } else {
    withoutGerman.push(species);
  }
}

// Schreibe separate Dateien
writeNDJSON('data/intermediate/species_auto.ndjson', withGerman);
writeNDJSON('data/intermediate/species_missing_german.ndjson', withoutGerman);
```

### 2. Neues Script: `scripts/04b_merge_species.js`

Siehe Pseudo-Code oben.

### 3. `scripts/05_collect_multimedia.js`

Flag-Unterstützung hinzufügen (siehe oben).

---

## 📋 Workflow-Beispiel (Praktische Anwendung)

### Szenario: Prüfungsvorbereitung Semester WS2026

1. **Baseline erstellen** (automatisch):
   ```bash
   npm run fetch-taxonkeys
   npm run enrich-species
   npm run enrich-wikidata
   npm run filter-species
   ```
   → Erzeugt: `species_auto.ndjson` (5.500 Species mit deutschen Namen)

2. **Manuelle Anpassungen** (du editierst):
   ```bash
   # Öffne species_missing_german.ndjson
   # Ergänze deutsche Namen für prüfungsrelevante Pflanzen
   # Speichere als species_manual.ndjson

   # Beispiel: Anpassung für Prüfung
   echo '{"taxonKey": 2984141, "germanName": "Rosskastanie", ...}' >> species_manual.ndjson
   ```

3. **Merge ausführen** (automatisch):
   ```bash
   npm run merge-species
   ```
   → Erzeugt: `data/final/species.ndjson` (auto + manual)

4. **Multimedia sammeln** (mit Wahl):
   ```bash
   # Option A: Mit manuellen Anpassungen
   npm run collect-multimedia

   # Option B: Nur automatische Daten
   npm run collect-multimedia -- --auto-only
   ```

5. **Versionierung**:
   ```bash
   git add data/intermediate/species_manual.ndjson
   git commit -m "Manuelle Anpassungen für WS2026 Prüfung"
   git tag "pruefung-ws2026"
   ```

---

## 🔮 Mögliche zukünftige Erweiterungen

### 1. UI für manuelle Kuratierung
- Web-Interface zum Bearbeiten von `species_manual.ndjson`
- CSV-Import/Export für einfache Bearbeitung in Excel

### 2. Validierung
- Script, das `species_manual.ndjson` auf Fehler prüft:
  - Doppelte taxonKeys
  - Fehlende Pflichtfelder
  - Ungültige taxonKeys (nicht in GBIF)

### 3. Diff-Report
- Zeige Unterschiede zwischen automatisch und manuell:
  ```
  Übersicht:
  - 23 Species manuell angepasst
  - 12 Species hinzugefügt
  - 0 Konflikte
  ```

### 4. Semester-Versionen
- Automatisches Tagging nach Semester
- Rollback zu früheren Prüfungsversionen

### 5. Collaborative Editing
- Mehrere Prüfer können `species_manual.ndjson` bearbeiten
- Merge-Konflikte über Git lösen

---

## ❓ Offene Designfragen (für spätere Implementierung)

1. **Wie oft ändern sich manuelle Daten?**
   - Nur vor Prüfungen? → Versionierung nach Semester sinnvoll
   - Kontinuierlich? → Timestamp in `_date` Feld

2. **Braucht es eine UI?**
   - Oder reicht direktes Editieren der NDJSON-Datei?
   - CSV-Export für Excel-Bearbeitung?

3. **Was bei Konflikten nach GBIF-Update?**
   - GBIF ändert deutschen Namen → manuelle Version bleibt?
   - → Empfehlung: `species_manual.ndjson` hat IMMER Vorrang

4. **Logging der Anpassungen?**
   - Terminal-Output: "23 Species manuell angepasst, 12 hinzugefügt"
   - Separate Log-Datei mit Details?

5. **Validation-Rules?**
   - Pflichtfelder für manuelle Einträge?
   - Format-Checks (z.B. germanName nicht leer)?

---

## 📚 Referenzen

- Aktuelle Pipeline-Dokumentation: [C:\Users\c-wal\.claude\plans\rustling-squishing-meteor.md](C:\Users\c-wal\.claude\plans\rustling-squishing-meteor.md)
- GBIF API-Wrapper: [scripts/utils/gbif-helpers.js](scripts/utils/gbif-helpers.js)
- Wikidata-Fallback: [scripts/utils/wikidata-helpers.js](scripts/utils/wikidata-helpers.js)

---

**Ende der Dokumentation**
*Dieses Dokument dient als Referenz für eine zukünftige Implementierung. Keine sofortige Umsetzung geplant.*
