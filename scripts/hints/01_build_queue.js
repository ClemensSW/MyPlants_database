#!/usr/bin/env node
/**
 * Phase 6.1: Hints-Queue bauen
 *
 * Bestimmt welche Pflanzen Hints brauchen:
 *   - Union aller taxonKeys aus data/exam-lists/**\/*.ndjson (nur taxonKey-Feld)
 *   - Minus: Pflanzen, die bereits ein approved/{taxonKey}.json haben
 *   - Minus: Pflanzen, die in species.ndjson bereits ein nicht-leeres hints-Feld haben
 *   - Intersect mit species.ndjson (Pflanzen, die wir wirklich kennen)
 *
 * Schreibt data/hints/queue.json.
 *
 * Usage: node scripts/hints/01_build_queue.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { listTaxonKeysFromExamLists } = require('./lib/read-examlists');

// Pfade
const ROOT = path.join(__dirname, '..', '..');
const EXAM_LISTS_DIR = path.join(ROOT, 'data/exam-lists');
const SPECIES_CANDIDATES = [
  path.join(ROOT, 'data/output/species.ndjson'),
  path.join(ROOT, 'data/output/species_test.ndjson'),
];
const HINTS_DIR = path.join(ROOT, 'data/hints');
const APPROVED_DIR = path.join(HINTS_DIR, 'approved');
const QUEUE_FILE = path.join(HINTS_DIR, 'queue.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pickSpeciesFile() {
  for (const candidate of SPECIES_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function loadKnownTaxonKeys(speciesFile) {
  const known = new Set();
  const alreadyHasHints = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(speciesFile, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.taxonKey === 'number') {
        known.add(obj.taxonKey);
        if (hasNonEmptyHints(obj.hints)) alreadyHasHints.add(obj.taxonKey);
      }
    } catch {
      // ignore
    }
  }

  return { known, alreadyHasHints };
}

function hasNonEmptyHints(hints) {
  if (!hints || typeof hints !== 'object') return false;
  for (const pool of ['german', 'botanical', 'general']) {
    const arr = hints[pool];
    if (Array.isArray(arr) && arr.length > 0) return true;
  }
  return false;
}

function loadApprovedTaxonKeys() {
  if (!fs.existsSync(APPROVED_DIR)) return new Set();
  const files = fs.readdirSync(APPROVED_DIR).filter(f => f.endsWith('.json'));
  const keys = new Set();
  for (const f of files) {
    const num = parseInt(f.replace(/\.json$/, ''), 10);
    if (Number.isFinite(num)) keys.add(num);
  }
  return keys;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 6.1: Hints-Queue bauen');
  console.log('='.repeat(60));

  ensureDir(HINTS_DIR);
  ensureDir(APPROVED_DIR);

  const speciesFile = pickSpeciesFile();
  if (!speciesFile) {
    console.error('FEHLER: Weder species.ndjson noch species_test.ndjson gefunden.');
    console.error('Erwartet unter:');
    SPECIES_CANDIDATES.forEach(p => console.error('  ' + p));
    process.exit(1);
  }
  console.log(`Species-Datei: ${path.relative(ROOT, speciesFile)}`);

  const { taxonKeys: examKeys, sources } = await listTaxonKeysFromExamLists(EXAM_LISTS_DIR);
  console.log(`Exam-Listen gefunden: ${sources.length} Datei(en)`);
  console.log(`Eindeutige taxonKeys in Exam-Listen: ${examKeys.size}`);

  const { known, alreadyHasHints } = await loadKnownTaxonKeys(speciesFile);
  console.log(`Bekannte Pflanzen in species-Datei: ${known.size}`);
  console.log(`Davon mit existierenden Hints: ${alreadyHasHints.size}`);

  const approved = loadApprovedTaxonKeys();
  console.log(`Bereits approvte Pflanzen (approved/): ${approved.size}`);

  const queued = [];
  let skippedUnknown = 0;
  let skippedApproved = 0;
  let skippedHasHints = 0;

  for (const key of examKeys) {
    if (!known.has(key)) {
      skippedUnknown++;
      continue;
    }
    if (approved.has(key)) {
      skippedApproved++;
      continue;
    }
    if (alreadyHasHints.has(key)) {
      skippedHasHints++;
      continue;
    }
    queued.push(key);
  }

  queued.sort((a, b) => a - b);

  const relativeSources = sources.map(s => path.relative(ROOT, s).replace(/\\/g, '/'));

  const queueDoc = {
    generatedAt: new Date().toISOString(),
    speciesFile: path.relative(ROOT, speciesFile).replace(/\\/g, '/'),
    sourceExamLists: relativeSources,
    stats: {
      examKeysTotal: examKeys.size,
      speciesKnown: known.size,
      alreadyApproved: skippedApproved,
      alreadyHasHints: skippedHasHints,
      unknownInSpecies: skippedUnknown,
      queued: queued.length,
    },
    totalQueued: queued.length,
    taxonKeys: queued,
  };

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueDoc, null, 2) + '\n', 'utf8');

  console.log('-'.repeat(60));
  console.log(`Queue geschrieben: ${path.relative(ROOT, QUEUE_FILE)}`);
  console.log(`  queued:             ${queued.length}`);
  console.log(`  skipped (approved): ${skippedApproved}`);
  console.log(`  skipped (has hints):${skippedHasHints}`);
  console.log(`  skipped (unknown):  ${skippedUnknown}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fehler beim Queue-Bau:', err);
  process.exit(1);
});
