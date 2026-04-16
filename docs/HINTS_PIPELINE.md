# Hints-Pipeline

Erweiterung der MyPlants-Datenpipeline um **Lern-Hints** pro Pflanze.
Implementiert als eigene Phase 6 — läuft **nach** dem Hauptpipeline-Flow
(Phasen 1–5) und ist von diesem entkoppelt.

## Überblick

Pro Pflanze sollen drei Hint-Pools befüllt werden:

| Pool | Zielanzahl | Zweck |
|---|---|---|
| `german` | 2 | Führen zum deutschen Namen, ohne ihn zu verraten |
| `botanical` | 2 | Führen zum botanischen Namen, ohne ihn zu verraten |
| `general` | 4 | Passen für beide Abfragen (keinen Namen verratend) |

Jeder Hint ist ein Objekt `{ text, source, kind }`:
- `kind: "factual"` → braucht Quelle (URL oder Literatur)
- `kind: "mnemonic"` → Eselsbrücke, `source: null` erlaubt

Beim Merge in `species.ndjson` werden die Objekte auf reine Strings reduziert
(Agentur-kompatibles Format). Die Audit-Daten (Quelle, Typ, Zeitstempel)
bleiben dauerhaft in `data/hints/approved/` erhalten.

## Verzeichnisstruktur

```
MyPlants_database/
├── data/hints/
│   ├── queue.json              # Priorität-Queue (taxonKeys, die Hints brauchen)
│   ├── pending/                # generiert, wartet auf Review (gitignored)
│   │   └── {taxonKey}.json
│   └── approved/               # reviewt & freigegeben (committed)
│       └── {taxonKey}.json
├── scripts/hints/
│   ├── 01_build_queue.js
│   ├── 02_generate_placeholder.js
│   ├── 03_merge_to_species.js
│   └── lib/
│       ├── hint-schema.js
│       └── read-examlists.js
└── review-ui/                  # Browser-App für Review (kein Backend)
    ├── index.html
    ├── app.js
    ├── style.css
    └── config.js
```

## End-to-End-Workflow

### 1. Queue bauen

```bash
npm run hints:queue
```

Liest:
- **Alle `data/exam-lists/**/*.ndjson`** — extrahiert `taxonKey`-Felder (andere
  Felder werden ignoriert, damit Änderungen am Exam-List-Schema die Pipeline
  nicht brechen).
- **`data/output/species.ndjson`** (oder `species_test.ndjson` als Fallback) —
  als Bestand der bekannten Pflanzen und als Indikator, welche Pflanzen
  bereits Hints haben.
- **`data/hints/approved/`** — um bereits freigegebene Pflanzen zu
  überspringen.

Schreibt `data/hints/queue.json` mit priorisierter Liste von taxonKeys.

### 2. Hints generieren

#### Placeholder-Modus (für Tests ohne KI)

```bash
npm run hints:generate-placeholder
```

Für jeden taxonKey in der Queue, der noch kein `pending/*.json` oder
`approved/*.json` hat, wird eine `pending/{taxonKey}.json` mit Dummy-
Kandidaten geschrieben:
- 5 `german`, 5 `botanical`, 8 `general` Kandidaten
- Je Pool ist der erste Kandidat eine Eselsbrücke (`kind: mnemonic`),
  der Rest sind Sachaussagen mit Dummy-Quellen (`https://example.com/...`) —
  so kann der Quellen-Validierungs-Flow in der UI getestet werden.

**Output-Schema:** identisch zum späteren KI-Generator. Das Placeholder-
Skript ist 1:1 durch einen KI-Generator ersetzbar (Folgeplan).

#### KI-Modus (folgt in separatem Plan)

Platzhalter:

```bash
npm run hints:generate-ai   # noch nicht implementiert
```

Wird im Folgeplan ergänzt. Anforderungen an den KI-Generator:
- Lesen der Queue und des Species-Lookups analog zum Placeholder-Skript
- Pro Pflanze 5 german / 5 botanical / 8 general Kandidaten produzieren
- Für `factual`-Hints **echte, verifizierbare Quellen** (Wikipedia-URL,
  botanische Literatur). Die UI blockiert Approve, wenn die Quelle leer ist.
- Nicht den gesuchten Namen verraten (German-Pool darf nicht `Hängebirke`
  enthalten wenn die Pflanze so heißt)
- Schreiben nach `data/hints/pending/{taxonKey}.json` im selben Schema wie
  das Placeholder-Skript

**KI-Prompt-Template (Platzhalter):**

```
[TBD — wird im separaten KI-Plan detailliert]

Eingabe: taxonKey, canonicalName, germanName
Ausgabe: JSON mit candidates.{german,botanical,general}
         jeweils N Hint-Objekte { text, source, kind }
Regeln:
  - Keine direkten Namensnennungen im passenden Pool
  - factual → echte URL/Literatur als source
  - mnemonic → source = null erlaubt
```

### 3. Review im Browser

**Öffnen:**
- Direkt `review-ui/index.html` im Browser öffnen (Chrome oder Edge), oder
- Einen statischen Server starten: `npx serve review-ui/` und die URL öffnen.

**Workflow in der UI:**
1. Klick auf „Arbeitsverzeichnis wählen" → Directory-Picker → `data/hints/` auswählen (mit Schreibrechten bestätigen).
2. Linke Spalte: Liste aller Plants in `pending/` mit `taxonKey`, `canonicalName`, `germanName`. Filterfeld oben zum schnellen Finden.
3. Detail-Ansicht rechts zeigt die drei Pools (Deutsch / Botanisch / Allgemein) mit jeweils den Ziel-Slot-Anzahlen (2 / 2 / 4), vorbefüllt aus dem Kandidaten-Pool.
4. Pro Slot ist alles editierbar:
   - **Text** (Textarea)
   - **Quelle** (URL oder Literaturangabe) — ist die Quelle eine URL, erscheint ein „↗ öffnen"-Link zur Verifikation
   - **Typ** Sachaussage / Eselsbrücke (Radio) — bei Eselsbrücke wird das Quellen-Feld deaktiviert
   - **Nächster Kandidat** — zieht den nächsten Eintrag aus dem Pool (mit Wrap-Around)
   - **Löschen** — entfernt den Slot
5. „+ Hint hinzufügen" legt einen leeren Slot an.
6. Rot markierte Slots zeigen fehlende Quelle bei Sachaussage — **Approve wird blockiert**, bis entweder eine Quelle da ist oder der Typ auf Eselsbrücke geändert wird.
7. Klick auf **„Approve & Nächste"**:
   - Validiert Quoten und Quellen
   - Schreibt `approved/{taxonKey}.json` (inkl. source + kind + Zeitstempel)
   - Löscht `pending/{taxonKey}.json`
   - Springt automatisch zur nächsten Pflanze

**Browser-Kompatibilität:** Die Review-UI benötigt die **File System Access API** (Chrome und Edge). Firefox und Safari sind nicht unterstützt.

### 4. In species.ndjson mergen

```bash
npm run hints:merge
```

- Liest alle `data/hints/approved/*.json`
- Strippt die Audit-Felder (`source`, `kind`, `approvedAt`, …) → reduziert
  Hints auf reine String-Arrays, wie im Agentur-Proposal
- Schreibt `species.ndjson` atomisch via Temp-File

Nach dem Merge enthält `species.ndjson` pro betroffener Pflanze:

```json
"hints": {
  "german": ["text 1", "text 2"],
  "botanical": ["text 1", "text 2"],
  "general": ["text 1", "text 2", "text 3", "text 4"]
}
```

Die Audit-Daten bleiben in `data/hints/approved/*.json` dauerhaft verfügbar.

## Exam-Lists erweitern

Die Queue ist flexibel für Änderungen an den Exam-Listen:

1. Neue NDJSON-Datei unter `data/exam-lists/**` ablegen (beliebige
   Unterordner-Tiefe). Muss pro Zeile mindestens `taxonKey` enthalten —
   alle anderen Felder werden ignoriert.
2. `npm run hints:queue` erneut ausführen.
3. Neue Pflanzen erscheinen in `queue.json`; für bestehende approved-Files
   wird nichts erneut generiert.

## Idempotenz

- **Queue-Lauf:** überspringt Pflanzen mit existierender approved-Datei
  oder gefüllten Hints in `species.ndjson`.
- **Placeholder-Lauf:** überspringt taxonKeys mit existierendem
  `pending/` oder `approved/` File.
- **Merge-Lauf:** überschreibt `species.ndjson` komplett, aber jede Zeile
  wird deterministisch aus approved-Dateien abgeleitet — mehrfache Läufe
  produzieren identische Ergebnisse.

## Zukünftige Erweiterungen

Nicht Teil der aktuellen Implementierung:
- **KI-basierte Hint-Generierung** (`hints:generate-ai`) — separater Plan.
- **Batch-Approve** für Kandidaten, die unverändert übernommen werden sollen.
- **Export der Audit-Daten** (source, kind) in ein separates Statistik-File.
- **Mehrsprachigkeit** — aktuell nur deutsche Hint-Texte (Zielgruppe
  GaLaBau DE).
