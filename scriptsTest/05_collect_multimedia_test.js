#!/usr/bin/env node
/**
 * TEST-VERSION: Phase 5 - Multimedia-Daten sammeln (limitiert)
 *
 * Sammelt nur die ersten 10 Bilder pro Species für schnelles Testen.
 *
 * Input:  data/output/species_test.ndjson
 * Output: data/output/multimedia_test.ndjson
 *
 * Usage: node scriptsTest/05_collect_multimedia_test.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { searchOccurrences, sleep } = require('../scripts/utils/gbif-helpers');

const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/output/species_test.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../data/output/multimedia_test.ndjson'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 3, // Niedriger für Test
  PAGE_SIZE: 50,
  MAX_IMAGES_PER_SPECIES: 10, // Limit für Test
  PROXY_BASE: 'https://images.weserv.nl/?url=',
};

function proxify(url) {
  return CONFIG.PROXY_BASE + encodeURIComponent(url);
}

function readSubjectPartFromMedia(m) {
  const candidates = ['ac:subjectPart', 'subjectPart', 'subject', 'subjectCategory'];
  for (const k of candidates) {
    const v = m?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

function readOrganFromUrl(identifier) {
  try {
    const u = new URL(identifier);
    const organ = u.searchParams.get('organ') || u.searchParams.get('organs');
    if (organ && organ.trim()) return organ.toLowerCase();
    const p = u.pathname.toLowerCase();
    const hit = ['leaf', 'flower', 'fruit', 'bark', 'habit', 'other'].find((k) =>
      p.includes(`/${k}/`)
    );
    return hit || null;
  } catch {
    return null;
  }
}

function extractImagesFromOccurrence(occ) {
  const out = [];
  const mediaItems = Array.isArray(occ?.media) ? occ.media : [];

  for (const m of mediaItems) {
    const id = m?.identifier;
    if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;

    const tag = readSubjectPartFromMedia(m) || readOrganFromUrl(id);
    out.push({
      url: proxify(id),
      tag: tag || null,
      occurrenceKey: occ.key ?? occ.gbifID ?? null,
      license: m?.license || occ?.license || null,
      rightsHolder: m?.rightsHolder || occ?.rightsHolder || null,
    });
  }

  const seen = new Set();
  return out.filter((rec) => {
    try {
      const u = new URL(rec.url);
      const original = u.searchParams.get('url') || rec.url;
      if (seen.has(original)) return false;
      seen.add(original);
      return true;
    } catch {
      return true;
    }
  });
}

async function collectImagesForTaxon(taxonKey, canonicalName) {
  const images = [];
  let offset = 0;

  while (images.length < CONFIG.MAX_IMAGES_PER_SPECIES) {
    const data = await searchOccurrences({
      datasetKey: CONFIG.DATASET_KEY,
      taxonKey,
      mediaType: 'StillImage',
      limit: CONFIG.PAGE_SIZE,
      offset,
    });

    for (const occ of data.results || []) {
      images.push(...extractImagesFromOccurrence(occ));
      if (images.length >= CONFIG.MAX_IMAGES_PER_SPECIES) break;
    }

    if (data.endOfRecords || images.length >= CONFIG.MAX_IMAGES_PER_SPECIES) break;
    offset += CONFIG.PAGE_SIZE;
  }

  return images.slice(0, CONFIG.MAX_IMAGES_PER_SPECIES);
}

async function main() {
  console.log('='.repeat(60));
  console.log('TEST-VERSION: Phase 5 - Multimedia sammeln (max 10 Bilder/Art)');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log(`Limit:  ${CONFIG.MAX_IMAGES_PER_SPECIES} Bilder pro Art`);
  console.log();

  // p-limit dynamisch importieren (ESM)
  const { default: pLimit } = await import('p-limit');

  const rl = readline.createInterface({
    input: fs.createReadStream(CONFIG.INPUT_FILE, 'utf8'),
    crlfDelay: Infinity,
  });

  const out = fs.createWriteStream(CONFIG.OUTPUT_FILE, { flags: 'w' });
  const queue = [];
  let active = 0;
  let seen = 0;
  let done = 0;
  let totalImages = 0;

  const limit = pLimit(CONFIG.CONCURRENCY);

  function kick() {
    if (active >= CONFIG.CONCURRENCY || queue.length === 0) return;
    const job = queue.shift();
    active++;

    limit(async () => {
      try {
        const images = await collectImagesForTaxon(job.taxonKey, job.canonicalName);

        for (const img of images) {
          const record = {
            taxonKey: job.taxonKey,
            species: job.scientificName,
            organ: img.tag,
            occurrenceId: img.occurrenceKey,
            url: img.url,
            license: img.license,
            wilsonScore: null,
          };
          out.write(JSON.stringify(record) + '\n');
          totalImages++;
        }
      } catch (e) {
        console.error(`\n❌ Fehler bei taxonKey ${job.taxonKey}: ${e.message}`);
      } finally {
        active--;
        done++;

        if (process.stdout.isTTY) {
          const percent = ((done / seen) * 100).toFixed(1);
          process.stdout.write(
            `\rVerarbeitet: ${done}/${seen} (${percent}%) | Bilder: ${totalImages}`
          );
        }

        kick();
      }
    })();
  }

  rl.on('line', (line) => {
    if (!line.trim()) return;

    try {
      const obj = JSON.parse(line);
      const taxonKey = obj?.taxonKey;
      const canonicalName = obj?.canonicalName;
      const scientificName = obj?.scientificName;

      if (taxonKey) {
        queue.push({ taxonKey, canonicalName, scientificName });
        seen++;
        kick();
      }
    } catch (e) {
      // Ignoriere ungültige Zeilen
    }
  });

  rl.on('close', async () => {
    while (active > 0 || queue.length > 0) {
      kick();
      await sleep(200);
    }

    out.end();

    console.log();
    console.log();
    console.log(`✓ Species verarbeitet: ${done}/${seen}`);
    console.log(`✓ Bilder gesammelt:    ${totalImages}`);
    console.log();
    console.log(`✓ Gespeichert: ${CONFIG.OUTPUT_FILE}`);
    console.log();
    console.log('TEST Phase 5 abgeschlossen!');
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Fehler:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main };
