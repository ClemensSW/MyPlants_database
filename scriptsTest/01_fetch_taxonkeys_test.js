#!/usr/bin/env node
/**
 * TEST-VERSION: Phase 1 - TaxonKeys sammeln (nur erste 50)
 *
 * Sammelt nur die ersten 50 eindeutigen taxonKeys für schnelles Testen.
 *
 * Output: data/intermediate/plantnet_taxonKeys_test.json
 *
 * Usage: node scriptsTest/01_fetch_taxonkeys_test.js
 */

const fs = require('fs');
const path = require('path');
const { getAllTaxonKeysFromDataset } = require('../scripts/utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  OUTPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_taxonKeys_test.json'),
  LIMIT: 50, // Nur 50 Keys für Test
};

async function main() {
  console.log('='.repeat(60));
  console.log('TEST-VERSION: Phase 1 - TaxonKeys sammeln (nur 50)');
  console.log('='.repeat(60));
  console.log(`Dataset: ${CONFIG.DATASET_KEY}`);
  console.log(`Limit:   ${CONFIG.LIMIT}`);
  console.log(`Output:  ${CONFIG.OUTPUT_FILE}`);
  console.log();

  console.log('Sammle erste 50 taxonKeys via GBIF Faceting...');
  const allKeys = await getAllTaxonKeysFromDataset(CONFIG.DATASET_KEY);

  // Nur erste 50 Keys
  const keys = allKeys.slice(0, CONFIG.LIMIT);

  console.log();
  console.log(`✓ ${keys.length} taxonKeys ausgewählt (von ${allKeys.length} verfügbar)`);

  // Ausgabe schreiben
  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(keys, null, 2), 'utf8');
  console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
  console.log();
  console.log('TEST Phase 1 abgeschlossen!');
}

// Script ausführen
if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
