#!/usr/bin/env node
/**
 * TEST-VERSION: Phase 3 - Species-Daten filtern
 *
 * Filtert die Test-Daten nach den gleichen Kriterien wie das Original.
 *
 * Input:  data/intermediate/plantnet_species_raw_test.ndjson
 * Output: data/output/species_test.ndjson
 *
 * Usage: node scriptsTest/03_filter_species_test.js
 */

const fs = require('fs');
const path = require('path');
const {
  transformNDJSON,
  filterSpeciesRank,
  filterAcceptedStatus,
  filterHasGermanNames,
  combineFilters,
  removeFields,
  countLines,
} = require('../scripts/utils/filter-helpers');

const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_species_raw_test.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../data/output/species_test.ndjson'),
};

async function main() {
  console.log('='.repeat(60));
  console.log('TEST-VERSION: Phase 3 - Species-Daten filtern');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  const inputCount = await countLines(CONFIG.INPUT_FILE);
  console.log(`✓ Input: ${inputCount} Einträge`);
  console.log();

  const filter = combineFilters(
    filterSpeciesRank,
    filterAcceptedStatus,
    filterHasGermanNames
  );

  const transform = (obj) =>
    removeFields(obj, ['acceptedKey', 'originalKey', 'germanName', 'source']);

  console.log('Filter anwenden:');
  console.log('  - rank === "SPECIES"');
  console.log('  - status === "ACCEPTED"');
  console.log('  - germanNames nicht leer');
  console.log();

  const { seen, kept } = await transformNDJSON(CONFIG.INPUT_FILE, CONFIG.OUTPUT_FILE, {
    filter,
    transform,
  });

  const removed = seen - kept;
  const percent = ((kept / seen) * 100).toFixed(1);

  console.log(`✓ Behalten: ${kept}/${seen} (${percent}%)`);
  console.log(`✗ Entfernt: ${removed}`);
  console.log();
  console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
  console.log();
  console.log('TEST Phase 3 abgeschlossen!');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
