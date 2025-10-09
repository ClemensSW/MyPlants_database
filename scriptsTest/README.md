# Test-Scripts für schnelles Testen

Diese Scripts sind identisch mit den Haupt-Scripts, aber verarbeiten nur **50 Pflanzen** und **max. 10 Bilder pro Art** für schnelles Testen.

## 🎯 Verwendung

```bash
# Phase 1: Erste 50 taxonKeys sammeln (~10 Sekunden)
node scriptsTest/01_fetch_taxonkeys_test.js

# Phase 2: 50 Species anreichern (~2-3 Minuten)
node scriptsTest/02_enrich_species_test.js

# Phase 3: Filtern (~1 Sekunde)
node scriptsTest/03_filter_species_test.js

# Phase 4: Bilder sammeln, max 10/Art (~3-5 Minuten)
node scriptsTest/04_collect_multimedia_test.js
```

## ⏱️ Geschätzte Dauer

- **Phase 1:** ~10 Sekunden
- **Phase 2:** ~2-3 Minuten
- **Phase 3:** ~1 Sekunde
- **Phase 4:** ~3-5 Minuten

**Gesamt: ~5-10 Minuten** (statt 12-18 Stunden!)

## 📁 Output-Dateien

Test-Dateien werden mit `_test` Suffix gespeichert:

```
data/
├── intermediate/
│   ├── plantnet_taxonKeys_test.json          # 50 taxonKeys
│   ├── plantnet_species_raw_test.ndjson      # 50 Species (roh)
│   └── failed_keys_test.txt                  # Fehlgeschlagene Keys
└── output/
    ├── species_test.ndjson                    # Gefilterte Species
    └── multimedia_test.ndjson                 # Bilder (max 10/Art)
```

## 🔧 Anpassungen

Die Test-Scripts haben folgende Limits:

| Parameter | Produktion | Test |
|-----------|------------|------|
| TaxonKeys | ~18.000 | **50** |
| Concurrency Phase 2 | 10 | **5** |
| Concurrency Phase 4 | 6 | **3** |
| Bilder pro Art | Unbegrenzt | **10** |
| Page Size Phase 4 | 300 | **50** |

## ✅ Nach dem Test

Wenn die Test-Scripts erfolgreich durchlaufen:

```bash
# Normale Scripts mit allen Daten ausführen
cd ..
npm run build-all
```

## 🧹 Test-Daten löschen

```bash
# Windows
del data\intermediate\*_test.* data\output\*_test.*

# Linux/Mac
rm data/intermediate/*_test.* data/output/*_test.*
```

---

**Hinweis:** Test-Dateien werden automatisch von `.gitignore` ausgeschlossen.
