#!/usr/bin/env node
/**
 * Phase 2.5: Deutsche Namen aus Wikidata ergänzen
 *
 * Ergänzt fehlende deutsche Namen aus der Wikidata SPARQL API.
 * Verarbeitet nur Species OHNE deutsche Namen aus Phase 2.
 *
 * Input:  data/intermediate/plantnet_species_raw.ndjson
 * Output: data/intermediate/plantnet_species_enriched.ndjson
 *
 * Usage: node scripts/03_enrich_wikidata.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { queryWikidataGermanNames } = require('./utils/wikidata-helpers');
const { pickPreferredGerman } = require('./utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_species_raw.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../data/intermediate/plantnet_species_enriched.ndjson'),
  FAILED_LOG: path.join(__dirname, '../data/intermediate/wikidata_failed.txt'),
  DELAY_MS: 500, // Delay zwischen Wikidata Requests (Rate Limit)
};

/**
 * Verzögerung zwischen Requests
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Liest alle Species aus NDJSON Input
 */
async function readAllSpecies(filePath) {
  const species = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        species.push(JSON.parse(line));
      } catch (err) {
        // Fehlerhafte Zeilen überspringen
      }
    }
  }

  return species;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 2.5: Deutsche Namen aus Wikidata ergänzen');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

  // 1) Input lesen
  console.log('Lade Species-Daten...');
  const allSpecies = await readAllSpecies(CONFIG.INPUT_FILE);
  console.log(`✓ ${allSpecies.length} Species geladen`);
  console.log();

  // 2) Filtere Species OHNE deutsche Namen
  const speciesWithoutGerman = allSpecies.filter(
    s => !s.germanNames || s.germanNames.length === 0
  );
  const speciesWithGerman = allSpecies.filter(
    s => s.germanNames && s.germanNames.length > 0
  );

  console.log(`✓ Mit deutschen Namen: ${speciesWithGerman.length}`);
  console.log(`✗ Ohne deutsche Namen: ${speciesWithoutGerman.length}`);
  console.log();

  if (speciesWithoutGerman.length === 0) {
    console.log('Keine Species ohne deutsche Namen gefunden.');
    console.log('Kopiere Input → Output ohne Änderungen...');
    fs.copyFileSync(CONFIG.INPUT_FILE, CONFIG.OUTPUT_FILE);
    console.log('✓ Fertig!');
    return;
  }

  // 3) Wikidata Queries für Species ohne Namen
  console.log(`Wikidata-Abfragen für ${speciesWithoutGerman.length} Species...`);
  console.log(`(Delay: ${CONFIG.DELAY_MS}ms zwischen Requests)`);
  console.log();

  const output = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'w' });
  const failedLog = fs.createWriteStream(CONFIG.FAILED_LOG, { flags: 'w' });

  let enriched = 0;
  let failed = 0;
  let processed = 0;

  // Verarbeite Species OHNE deutsche Namen
  for (const species of speciesWithoutGerman) {
    processed++;

    // Fortschritt
    if (process.stdout.isTTY) {
      const percent = ((processed / speciesWithoutGerman.length) * 100).toFixed(1);
      process.stdout.write(
        `\rVerarbeitet: ${processed}/${speciesWithoutGerman.length} (${percent}%) | ` +
        `Ergänzt: ${enriched} | Keine Treffer: ${failed}`
      );
    }

    try {
      // Wikidata Query
      const wikidataNames = await queryWikidataGermanNames(species.scientificName);

      if (wikidataNames.length > 0) {
        // Deutsche Namen gefunden!
        species.germanNames = wikidataNames;

        // Aktualisiere auch germanName (bevorzugter Name)
        species.germanName = pickPreferredGerman({}, wikidataNames);

        enriched++;
      } else {
        // Keine Namen gefunden
        failed++;
        failedLog.write(`${species.taxonKey}\t${species.scientificName}\n`);
      }

      // Delay zwischen Requests (Wikidata Rate Limit)
      await sleep(CONFIG.DELAY_MS);
    } catch (err) {
      // Bei Fehler: Species ohne Änderung übernehmen
      failed++;
      failedLog.write(`${species.taxonKey}\t${species.scientificName}\t${err.message}\n`);
    }

    // Schreibe Species (mit oder ohne Ergänzung)
    output.write(JSON.stringify(species) + '\n');
  }

  // 4) Schreibe Species MIT deutschen Namen (unverändert)
  for (const species of speciesWithGerman) {
    output.write(JSON.stringify(species) + '\n');
  }

  output.end();
  failedLog.end();

  if (process.stdout.isTTY) {
    process.stdout.write('\n');
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Zusammenfassung:');
  console.log('='.repeat(60));
  console.log(`Gesamt Species:           ${allSpecies.length}`);
  console.log(`Bereits mit dt. Namen:    ${speciesWithGerman.length}`);
  console.log(`Ohne dt. Namen (vorher):  ${speciesWithoutGerman.length}`);
  console.log(`✓ Ergänzt aus Wikidata:   ${enriched}`);
  console.log(`✗ Keine Treffer:          ${failed}`);
  console.log();

  const totalWithGerman = speciesWithGerman.length + enriched;
  const totalWithoutGerman = allSpecies.length - totalWithGerman;
  const percent = ((totalWithGerman / allSpecies.length) * 100).toFixed(1);

  console.log(`Ergebnis:`);
  console.log(`  Mit deutschen Namen:    ${totalWithGerman} (${percent}%)`);
  console.log(`  Ohne deutschen Namen:   ${totalWithoutGerman}`);
  console.log();
  console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);

  if (failed > 0) {
    console.log(`ℹ Failed Log: ${CONFIG.FAILED_LOG}`);
  }

  console.log();
  console.log('Phase 2.5 abgeschlossen!');
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
