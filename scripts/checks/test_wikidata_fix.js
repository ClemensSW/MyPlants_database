/**
 * Test: Wikidata SPARQL Fix für die 777 fehlenden Arten
 *
 * Prüft ob die erweiterte SPARQL-Query (P1843 + rdfs:label)
 * deutsche Namen für die bisher fehlenden Arten findet.
 *
 * Input:  data/output/checks/missing_from_output.json (777 Arten)
 *         data/intermediate/plantnet_species_enriched.ndjson (für canonicalName)
 * Output: Konsolen-Zusammenfassung + data/output/checks/wikidata_fix_test.json
 *
 * Usage: node scripts/checks/test_wikidata_fix.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { queryWikidataGermanNamesBatch } = require('../utils/wikidata-helpers');

const ROOT = path.join(__dirname, '..', '..');

const CONFIG = {
  MISSING_FILE: path.join(ROOT, 'data/output/checks/missing_from_output.json'),
  ENRICHED_FILE: path.join(ROOT, 'data/intermediate/plantnet_species_enriched.ndjson'),
  OUTPUT_FILE: path.join(ROOT, 'data/output/checks/wikidata_fix_test.json'),
  BATCH_SIZE: 50,
  BATCH_DELAY_MS: 1500,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('Test: Wikidata SPARQL Fix (P1843 + rdfs:label)');
  console.log('='.repeat(60));

  // 1. Lade die 777 fehlenden Arten
  const missing = JSON.parse(fs.readFileSync(CONFIG.MISSING_FILE, 'utf-8'));
  const missingKeys = new Set(missing.map(m => m.taxonKey));
  console.log(`${missing.length} fehlende Arten geladen`);

  // 2. Finde canonicalNames aus Intermediate-Datei
  const keyToName = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.ENRICHED_FILE),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (missingKeys.has(obj.taxonKey)) {
        keyToName.set(obj.taxonKey, obj.canonicalName || obj.scientificName);
      }
    } catch {}
  }

  console.log(`${keyToName.size} davon in Intermediate gefunden`);

  // Arten die nicht in Intermediate sind (aus missing_from_output.json direkt)
  for (const entry of missing) {
    if (!keyToName.has(entry.taxonKey)) {
      keyToName.set(entry.taxonKey, entry.canonicalName);
    }
  }

  console.log(`${keyToName.size} Arten insgesamt zu testen\n`);

  // 3. Wikidata Batch-Queries
  const entries = Array.from(keyToName.entries()); // [[taxonKey, canonicalName], ...]
  const totalBatches = Math.ceil(entries.length / CONFIG.BATCH_SIZE);

  let found = 0;
  let notFound = 0;
  const results = { found: [], notFound: [] };

  console.log(`Starte Wikidata-Abfragen (${totalBatches} Batches, je ${CONFIG.BATCH_SIZE} Arten)...\n`);

  for (let i = 0; i < entries.length; i += CONFIG.BATCH_SIZE) {
    const batch = entries.slice(i, i + CONFIG.BATCH_SIZE);
    const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;

    const canonicalNames = batch.map(([, name]) => name);

    try {
      const wikidataResults = await queryWikidataGermanNamesBatch(canonicalNames);

      for (const [taxonKey, canonicalName] of batch) {
        const names = wikidataResults[canonicalName] || [];
        const archiveEntry = missing.find(m => m.taxonKey === taxonKey);

        if (names.length > 0) {
          found++;
          results.found.push({
            taxonKey,
            canonicalName,
            wikidataNames: names.map(n => n.name),
            archiveGermanName: archiveEntry?.germanName || null,
          });
        } else {
          notFound++;
          results.notFound.push({
            taxonKey,
            canonicalName,
            archiveGermanName: archiveEntry?.germanName || null,
          });
        }
      }
    } catch (err) {
      console.error(`  Batch ${batchNum} Fehler: ${err.message}`);
      for (const [taxonKey, canonicalName] of batch) {
        notFound++;
        const archiveEntry = missing.find(m => m.taxonKey === taxonKey);
        results.notFound.push({
          taxonKey,
          canonicalName,
          archiveGermanName: archiveEntry?.germanName || null,
          error: err.message,
        });
      }
    }

    if (process.stdout.isTTY) {
      const percent = ((batchNum / totalBatches) * 100).toFixed(1);
      process.stdout.write(
        `\r  Batch ${batchNum}/${totalBatches} (${percent}%) | Gefunden: ${found} | Nicht gefunden: ${notFound}`
      );
    }

    if (i + CONFIG.BATCH_SIZE < entries.length) {
      await sleep(CONFIG.BATCH_DELAY_MS);
    }
  }

  if (process.stdout.isTTY) process.stdout.write('\n');

  // 4. Ergebnisse
  console.log('\n' + '='.repeat(60));
  console.log('Ergebnis:');
  console.log('='.repeat(60));
  console.log(`  Getestet:                 ${missing.length}`);
  console.log(`  Deutsche Namen gefunden:  ${found} (${((found / missing.length) * 100).toFixed(1)}%)`);
  console.log(`  Nicht gefunden:           ${notFound}`);

  if (results.found.length > 0) {
    console.log(`\nBeispiele gefundener Namen:`);
    for (const r of results.found.slice(0, 10)) {
      console.log(`  ${r.canonicalName}: ${r.wikidataNames.join(', ')} (Archiv: ${r.archiveGermanName})`);
    }
  }

  // 5. Speichern
  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nErgebnis gespeichert: ${CONFIG.OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
