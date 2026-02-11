const fs = require('fs');
const path = require('path');
const { fetchWithRetry, sleep, GBIF_API_BASE } = require('../utils/gbif-helpers');

const ROOT = path.join(__dirname, '..', '..');

const CONFIG = {
  INPUT_FILE: path.join(ROOT, 'data/output/checks/missing_from_output.json'),
  OUTPUT_FILE: path.join(ROOT, 'data/output/checks/missing_plantnet_check.json'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 5,
};

async function countPlantNetOccurrences(taxonKey) {
  const url = `${GBIF_API_BASE}/occurrence/search?datasetKey=${CONFIG.DATASET_KEY}&taxonKey=${taxonKey}&limit=0`;
  const data = await fetchWithRetry(url);
  return data?.count || 0;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Check: Fehlende Arten im PlantNet-Dataset?');
  console.log('='.repeat(60));

  const missing = JSON.parse(fs.readFileSync(CONFIG.INPUT_FILE, 'utf-8'));
  console.log(`${missing.length} Arten zu prüfen\n`);

  const results = [];
  let done = 0;

  for (let i = 0; i < missing.length; i += CONFIG.CONCURRENCY) {
    const batch = missing.slice(i, i + CONFIG.CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const count = await countPlantNetOccurrences(entry.taxonKey);
        return { ...entry, plantnetCount: count };
      })
    );
    results.push(...batchResults);
    done += batch.length;
    process.stdout.write(`\r  ${done}/${missing.length} geprüft`);
    if (i + CONFIG.CONCURRENCY < missing.length) await sleep(500);
  }
  process.stdout.write('\n\n');

  const inPlantNet = results.filter(r => r.plantnetCount > 0);
  const notInPlantNet = results.filter(r => r.plantnetCount === 0);

  console.log(`Ergebnis:`);
  console.log(`  Nicht in PlantNet: ${notInPlantNet.length} (Hypothese bestätigt)`);
  console.log(`  Doch in PlantNet:  ${inPlantNet.length}`);

  if (inPlantNet.length > 0) {
    console.log(`\nIn PlantNet vorhanden aber fehlen in Output:`);
    for (const r of inPlantNet) {
      console.log(`  ${r.canonicalName} (${r.germanName}) - ${r.plantnetCount} Beobachtungen`);
    }
  }

  fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify({ inPlantNet, notInPlantNet }, null, 2), 'utf-8');
  console.log(`\nErgebnis gespeichert: ${CONFIG.OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
