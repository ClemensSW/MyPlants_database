#!/usr/bin/env node
/**
 * Phase 4: Multimedia-Daten sammeln
 *
 * Sammelt Bild-URLs mit Organ-Tags für alle Species aus der GBIF Occurrence API.
 * Extrahiert Tags aus Audubon Core (ac:subjectPart) oder URL-Parametern.
 * Alle URLs werden durch den Weserv-Proxy geleitet.
 *
 * Input:  data/output/species.ndjson
 * Output: data/output/multimedia.ndjson
 *
 * Usage: node scripts/04_collect_multimedia.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pLimit = require('p-limit');
const { searchOccurrences, sleep } = require('./utils/gbif-helpers');

// Konfiguration
const CONFIG = {
  INPUT_FILE: path.join(__dirname, '../data/output/species.ndjson'),
  OUTPUT_FILE: path.join(__dirname, '../data/output/multimedia.ndjson'),
  DATASET_KEY: '7a3679ef-5582-4aaa-81f0-8c2545cafc81',
  CONCURRENCY: 6,
  PAGE_SIZE: 300,
  PROXY_BASE: 'https://images.weserv.nl/?url=',
};

/**
 * Proxifiziert eine URL durch Weserv
 */
function proxify(url) {
  return CONFIG.PROXY_BASE + encodeURIComponent(url);
}

/**
 * Liest ac:subjectPart aus Extension-Row
 */
function readSubjectPartFromExtRow(row) {
  const candidates = [
    'ac:subjectPart',
    'subjectPart',
    'http://rs.tdwg.org/ac/terms/subjectPart',
    'http://rs.tdwg.org/ac/terms/subject',
    'http://purl.org/dc/terms/subject',
  ];
  for (const k of candidates) {
    const v = row?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

/**
 * Liest subjectPart aus Media-Objekt
 */
function readSubjectPartFromMedia(m) {
  const candidates = ['ac:subjectPart', 'subjectPart', 'subject', 'subjectCategory'];
  for (const k of candidates) {
    const v = m?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
  }
  return null;
}

/**
 * Extrahiert Organ-Tag aus URL-Parametern
 */
function readOrganFromUrl(identifier) {
  try {
    const u = new URL(identifier);
    const organ = u.searchParams.get('organ') || u.searchParams.get('organs');
    if (organ && organ.trim()) return organ.toLowerCase();

    // Alternativ aus Pfad
    const p = u.pathname.toLowerCase();
    const hit = ['leaf', 'flower', 'fruit', 'bark', 'habit', 'other'].find((k) =>
      p.includes(`/${k}/`)
    );
    return hit || null;
  } catch {
    return null;
  }
}

/**
 * Iterator für Multimedia-Extension
 */
function* iterMultimediaExt(occ) {
  const ex =
    occ?.extensions?.['http://rs.tdwg.org/ac/terms/Multimedia'] ||
    occ?.extensions?.['http://rs.gbif.org/terms/1.0/Multimedia'] ||
    occ?.extensions?.Multimedia;
  if (Array.isArray(ex)) {
    for (const row of ex) yield row;
  }
}

/**
 * Extrahiert alle Bilder aus einem Occurrence
 */
function extractImagesFromOccurrence(occ) {
  const out = [];
  const mediaItems = Array.isArray(occ?.media) ? occ.media : [];

  // 1) aus media[]
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

  // 2) aus Audubon Core Extension
  for (const row of iterMultimediaExt(occ)) {
    const id = row?.identifier || row?.['http://purl.org/dc/terms/identifier'];
    if (!id || typeof id !== 'string' || !/^https?:\/\//i.test(id)) continue;

    const tag = readSubjectPartFromExtRow(row) || readOrganFromUrl(id);
    out.push({
      url: proxify(id),
      tag: tag || null,
      occurrenceKey: occ.key ?? occ.gbifID ?? null,
      license:
        row?.license ||
        row?.['http://purl.org/dc/terms/license'] ||
        occ?.license ||
        null,
      rightsHolder:
        row?.rightsHolder ||
        row?.['http://purl.org/dc/terms/rightsHolder'] ||
        occ?.rightsHolder ||
        null,
    });
  }

  // Deduplizierung nach Original-URL
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

/**
 * Sammelt alle Bilder für einen taxonKey
 */
async function collectImagesForTaxon(taxonKey, canonicalName) {
  const images = [];
  let offset = 0;

  while (true) {
    const data = await searchOccurrences({
      datasetKey: CONFIG.DATASET_KEY,
      taxonKey,
      mediaType: 'StillImage',
      limit: CONFIG.PAGE_SIZE,
      offset,
    });

    for (const occ of data.results || []) {
      images.push(...extractImagesFromOccurrence(occ));
    }

    if (data.endOfRecords) break;
    offset += CONFIG.PAGE_SIZE;

    // Warnung bei sehr vielen Occurrences
    if (offset >= 100000) {
      console.warn(
        `\n⚠ taxonKey ${taxonKey}: >=100k Occurrences (API-Limit erreicht möglich)`
      );
    }
  }

  return images;
}

/**
 * Schreibt Multimedia-Einträge für alle Species
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Phase 4: Multimedia-Daten sammeln');
  console.log('='.repeat(60));
  console.log(`Input:  ${CONFIG.INPUT_FILE}`);
  console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
  console.log();

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

        // Schreibe jedes Bild als separate NDJSON-Zeile
        for (const img of images) {
          const record = {
            taxonKey: job.taxonKey,
            species: job.scientificName,
            organ: img.tag,
            occurrenceId: img.occurrenceKey,
            url: img.url,
            license: img.license,
            wilsonScore: null, // Placeholder für zukünftige Bewertung
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

  // Species einlesen
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
    // Warte bis alle Worker fertig sind
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
    console.log('Phase 4 abgeschlossen!');
  });
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
