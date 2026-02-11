const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..', '..');

async function main() {
  console.log('='.repeat(60));
  console.log('Diagnose: Warum fehlen 777 Arten im Output?');
  console.log('='.repeat(60));

  // 1. Load missing taxonKeys
  const missing = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/output/checks/missing_from_output.json'), 'utf-8')
  );
  const missingKeys = new Set(missing.map(m => m.taxonKey));
  console.log(`${missing.length} fehlende taxonKeys geladen\n`);

  // 2. Stream enriched data and find matching entries
  const found = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(ROOT, 'data/intermediate/plantnet_species_enriched.ndjson')),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (missingKeys.has(obj.taxonKey)) {
      found.set(obj.taxonKey, obj);
    }
  }

  // 3. Diagnose each missing species
  const categories = {
    notInIntermediate: [],
    rankOnly: [],
    statusOnly: [],
    germanOnly: [],
    rankAndStatus: [],
    rankAndGerman: [],
    statusAndGerman: [],
    allThree: [],
  };

  for (const entry of missing) {
    const enriched = found.get(entry.taxonKey);

    if (!enriched) {
      categories.notInIntermediate.push({
        ...entry,
        reason: 'Nicht in Intermediate (Pipeline-Verlust Phase 1/2)',
      });
      continue;
    }

    const isSpecies = enriched.rank === 'SPECIES';
    const isAccepted = enriched.status === 'ACCEPTED';
    const hasGerman = Array.isArray(enriched.germanNames) && enriched.germanNames.length > 0;

    const reasons = [];
    if (!isSpecies) reasons.push(`rank=${enriched.rank}`);
    if (!isAccepted) reasons.push(`status=${enriched.status}`);
    if (!hasGerman) reasons.push('keine dt. Namen');

    const result = {
      canonicalName: entry.canonicalName,
      germanName: entry.germanName,
      taxonKey: entry.taxonKey,
      rank: enriched.rank,
      status: enriched.status,
      germanNamesCount: enriched.germanNames?.length || 0,
      reasons,
    };

    if (!isSpecies && isAccepted && hasGerman) categories.rankOnly.push(result);
    else if (isSpecies && !isAccepted && hasGerman) categories.statusOnly.push(result);
    else if (isSpecies && isAccepted && !hasGerman) categories.germanOnly.push(result);
    else if (!isSpecies && !isAccepted && hasGerman) categories.rankAndStatus.push(result);
    else if (!isSpecies && isAccepted && !hasGerman) categories.rankAndGerman.push(result);
    else if (isSpecies && !isAccepted && !hasGerman) categories.statusAndGerman.push(result);
    else if (!isSpecies && !isAccepted && !hasGerman) categories.allThree.push(result);
    else {
      // All filters pass — shouldn't happen
      result.reasons.push('UNERWARTET: alle Filter bestanden');
      categories.notInIntermediate.push(result);
    }
  }

  // 4. Print summary
  console.log('Diagnose-Ergebnis:');
  console.log('-'.repeat(60));
  console.log(`  Nicht in Intermediate:          ${categories.notInIntermediate.length}`);
  console.log(`  Nur Rang falsch:                ${categories.rankOnly.length}`);
  console.log(`  Nur Status falsch:              ${categories.statusOnly.length}`);
  console.log(`  Nur keine dt. Namen:            ${categories.germanOnly.length}`);
  console.log(`  Rang + Status falsch:           ${categories.rankAndStatus.length}`);
  console.log(`  Rang + keine dt. Namen:         ${categories.rankAndGerman.length}`);
  console.log(`  Status + keine dt. Namen:       ${categories.statusAndGerman.length}`);
  console.log(`  Alle drei Filter:               ${categories.allThree.length}`);
  console.log('-'.repeat(60));

  const total = Object.values(categories).reduce((s, arr) => s + arr.length, 0);
  console.log(`  Summe:                          ${total}`);

  // 5. Show rank distribution
  const rankCounts = {};
  for (const cat of Object.values(categories)) {
    for (const r of cat) {
      const rank = r.rank || 'N/A';
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
    }
  }
  console.log('\nRang-Verteilung aller 777:');
  for (const [rank, count] of Object.entries(rankCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rank.padEnd(20)} ${count}`);
  }

  // 6. Save
  const outPath = path.join(ROOT, 'data/output/checks/missing_diagnosis.json');
  fs.writeFileSync(outPath, JSON.stringify(categories, null, 2), 'utf-8');
  console.log(`\nErgebnis gespeichert: ${outPath}`);
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
