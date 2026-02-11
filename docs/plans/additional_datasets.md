# Zukünftige Erweiterung: Zusätzliche GBIF-Datensätze

**Status**: Konzept für zukünftige Implementierung
**Datum**: 2026-01-31
**Zweck**: Integration weiterer GBIF-Datensätze zur Verbesserung der Bildabdeckung

---

## Ziel

Die aktuelle Pipeline nutzt ausschließlich den **Pl@ntNet-Datensatz** als Bildquelle. Von 210 GaLaBau-Prüfungspflanzen haben 40 Arten **0 Bilder** und 8 weitere weniger als 100 Bilder. Durch zusätzliche Datensätze kann die Abdeckung deutlich verbessert werden.

### Aktuelle Abdeckung (nur Pl@ntNet)
- 143 von 201 unique GaLaBau-Arten in species.ndjson (71,4%)
- 40 davon mit 0 Bildern in multimedia.ndjson
- Gesamt: ~265.000 Bilder für GaLaBau-Arten

---

## Evaluierte Datensätze

### Geeignet (CC BY 4.0 / CC0 1.0)

| Prio | Datensatz | Dataset-Key | Lizenz | Pflanzen-Bilder | Organ-Tags |
|------|-----------|-------------|--------|-----------------|------------|
| 1 | **Pl@ntNet** (aktuell) | `7a3679ef-5582-4aaa-81f0-8c2545cafc81` | CC BY | ~2,6M | flower, leaf, fruit, bark, habit, other |
| 2 | **iNaturalist Research-grade** | `50c9509d-22c7-4a22-a47d-8c48425ef4a7` | CC BY | ~6,6M (CC BY) | Nein |
| 3 | **iNaturalist Research-grade** (CC0-Anteil) | `50c9509d-22c7-4a22-a47d-8c48425ef4a7` | CC0 | ~3,0M (CC0) | Nein |
| 4 | **NABU\|naturgucker** | `6ac3f774-d9fb-4796-b3e9-92bf6c81c084` | CC BY | ~388K | Nein |

### Nicht geeignet

| Datensatz | Grund |
|-----------|-------|
| **Observation.org** (`8a863029-f435-446a-821e-275f4f641165`) | CC BY-NC Lizenz |
| **Kew Herbarium** (`cd6e21c8-9e8a-493a-8a76-fbf7862069e5`) | Herbarbelege, keine lebenden Pflanzen |
| **MNHN Paris Herbarium** (`b5cdf794-8fa4-4a85-8b26-755d087bf531`) | Herbarbelege |
| **Arter.dk** (Miljøstyrelsen) | Mischlizenzen, Filterung nötig, klein |
| **Flora of Bavaria** (SNSB) | ~5.635 CC BY-SA Bilder, CC BY-SA nicht in Ziel-Lizenzen |

---

## Lizenz-Strategie

### Erlaubte Lizenzen
- **CC0 1.0** (Public Domain)
- **CC BY 4.0** (Namensnennung)

### Wichtig: Lizenz pro Bild, nicht pro Datensatz
Bei iNaturalist ist die **Datensatz-Lizenz** CC BY, aber einzelne Bilder können CC BY-NC sein. Die Lizenz muss **pro Occurrence/Media-Eintrag** gefiltert werden:

```javascript
// GBIF Occurrence API liefert das license-Feld pro Eintrag
const allowedLicenses = ['CC0_1_0', 'CC_BY_4_0'];

// Filtern bei der Verarbeitung:
if (!allowedLicenses.includes(occurrence.license)) {
  skip; // Nicht kommerziell nutzbar
}
```

---

## Architektur: Multi-Dataset-Pipeline

### Aktuelle Pipeline (nur Pl@ntNet)

```
Phase 1: fetch_taxonkeys       → plantnet_taxonKeys.json (1 Dataset)
Phase 2: enrich_species         → species_raw.ndjson
Phase 3: enrich_wikidata        → species_enriched.ndjson
Phase 4: filter_species         → species.ndjson
Phase 5: collect_multimedia     → multimedia.ndjson (nur Pl@ntNet)
```

### Erweiterte Pipeline (Multi-Dataset)

```
Phase 1:  fetch_taxonkeys       → plantnet_taxonKeys.json
Phase 1b: fetch_taxonkeys_extra → additional_taxonKeys.json (NEU)
          → Merged: all_taxonKeys.json
Phase 2:  enrich_species         → species_raw.ndjson (alle Keys)
Phase 3:  enrich_wikidata        → species_enriched.ndjson
Phase 4:  filter_species         → species.ndjson
Phase 5:  collect_multimedia     → multimedia.ndjson (Multi-Dataset)
```

### Hauptänderungen

#### 1. Phase 1b: `01b_fetch_additional_taxonkeys.js` (NEU)

Sammelt taxonKeys aus zusätzlichen Datensätzen und merged sie mit Pl@ntNet-Keys:

```javascript
const ADDITIONAL_DATASETS = [
  {
    key: '50c9509d-22c7-4a22-a47d-8c48425ef4a7',
    name: 'iNaturalist Research-grade',
    licenses: ['CC0_1_0', 'CC_BY_4_0'], // Nur diese Lizenzen
  },
  {
    key: '6ac3f774-d9fb-4796-b3e9-92bf6c81c084',
    name: 'NABU|naturgucker',
    licenses: ['CC_BY_4_0'],
  },
];
```

Achtung: iNaturalist hat ~180M Occurrences, Faceting dauert lange. Alternative: Nur die fehlenden taxonKeys gezielt abfragen (aus galabau_missing-Liste).

#### 2. Phase 5: `05_collect_multimedia.js` (ERWEITERT)

Multimedia aus mehreren Datensätzen sammeln:

```javascript
const DATASET_CONFIGS = [
  {
    key: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
    name: 'PlantNet',
    hasOrganTags: true,
    licenseFilter: null, // Alle CC BY
  },
  {
    key: '50c9509d-22c7-4a22-a47d-8c48425ef4a7',
    name: 'iNaturalist',
    hasOrganTags: false,
    licenseFilter: ['CC0_1_0', 'CC_BY_4_0'], // Pro Eintrag filtern!
  },
  {
    key: '6ac3f774-d9fb-4796-b3e9-92bf6c81c084',
    name: 'naturgucker',
    hasOrganTags: false,
    licenseFilter: null, // Alles CC BY
  },
];
```

#### 3. Multimedia-Schema-Erweiterung

Neues Feld `dataset` zur Herkunftsverfolgung:

```json
{
  "taxonKey": 3189846,
  "species": "Acer platanoides L.",
  "organ": "flower",
  "occurrenceId": 12345678,
  "url": "https://...",
  "creator": "username",
  "license": "cc-by",
  "dataset": "plantnet",
  "wilsonScore": null
}
```

---

## Fehlende Organ-Tags bei iNaturalist/naturgucker

Pl@ntNet ist der einzige große Datensatz mit Organ-Tags (flower, leaf, fruit, bark, habit). iNaturalist und naturgucker haben **keine** standardisierten Organ-Tags.

### Optionen

1. **Organ = null** speichern und in der App als "unklassifiziert" anzeigen
2. **ML-Klassifikation** nachträglich (z.B. mit einem PlantNet-trainierten Modell)
3. **iNaturalist Observation Fields** — manche Beobachtungen haben Community-Tags, aber nicht standardisiert

### Empfehlung
Option 1 (organ=null) als Startpunkt, spätere ML-Klassifikation als separates Projekt.

---

## Schrittweise Einführung

### Phase A: Gezielte Lücken füllen (Empfohlen als erster Schritt)

Nur für die 40 GaLaBau-Arten mit 0 Bildern + 8 mit <100 Bildern gezielt in iNaturalist/naturgucker suchen:

```javascript
// Pseudo-Code
for (const taxonKey of missingTaxonKeys) {
  // iNaturalist durchsuchen
  const occurrences = await searchOccurrences({
    datasetKey: INATURALIST_KEY,
    taxonKey: taxonKey,
    mediaType: 'StillImage',
    license: 'CC_BY_4_0', // oder CC0_1_0
    limit: 300,
  });
  // Bilder extrahieren und zu multimedia.ndjson hinzufügen
}
```

Vorteil: Schnell, gezielt, kein Komplett-Refactor der Pipeline nötig.

### Phase B: Volle Integration

Komplette Pipeline-Erweiterung wie oben beschrieben. Sinnvoll wenn Phase A erfolgreich ist.

---

## Geschätzte Verbesserung

### Für die 40 GaLaBau-Arten mit 0 Bildern (taxonKey >= 5M)

Viele davon sind häufige europäische Arten (Betula pendula, Hedera helix, Urtica dioica etc.) die bei iNaturalist tausende Beobachtungen haben. Erwartete Verbesserung:
- **~35 von 40** Arten mit 0 Bildern sollten über iNaturalist abgedeckt werden
- Geschätzt **50.000-200.000 zusätzliche Bilder** allein für diese Arten

### Für alle 4.868 Arten in species.ndjson

- iNaturalist bietet ~9,6M Pflanzenbilder unter CC BY/CC0
- Potenzielle Verdoppelung bis Verdreifachung der Bildmenge

---

## Offene Fragen

1. **Wie viele iNaturalist-Bilder sind wirklich CC BY/CC0?**
   Muss pro Occurrence geprüft werden — ein Testlauf für 10 Arten würde das klären.

2. **Bildqualität?**
   iNaturalist-Bilder sind oft Smartphone-Fotos in freier Natur — qualitativ vergleichbar mit Pl@ntNet.

3. **Duplikate?**
   Manche Nutzer posten auf Pl@ntNet UND iNaturalist — Deduplizierung über URL oder occurrenceId.

4. **Rate Limits?**
   iNaturalist auf GBIF hat keine speziellen Rate Limits, aber die GBIF API selbst erlaubt ~3 Requests/Sekunde.

5. **Speicherplatz?**
   multimedia.ndjson würde von ~1,8M auf ~5-8M Zeilen wachsen. Bei ~200 Bytes/Zeile: ~1-1,6 GB.

---

## Referenzen

- GBIF Occurrence API: https://techdocs.gbif.org/en/openapi/v1/occurrence
- GBIF Licensing: https://www.gbif.org/terms
- iNaturalist auf GBIF: https://www.gbif.org/dataset/50c9509d-22c7-4a22-a47d-8c48425ef4a7
- NABU|naturgucker auf GBIF: https://www.gbif.org/dataset/6ac3f774-d9fb-4796-b3e9-92bf6c81c084
- Aktuelle Pipeline: scripts/01_fetch_taxonkeys.js bis scripts/05_collect_multimedia.js
- Verwandtes Dokument: FUTURE_PLAN_manual_curation.md

---

**Ende der Dokumentation**
*Dieses Dokument dient als Referenz für eine zukünftige Implementierung. Empfohlener erster Schritt: Phase A (gezielte Lückenfüllung für GaLaBau-Arten).*
