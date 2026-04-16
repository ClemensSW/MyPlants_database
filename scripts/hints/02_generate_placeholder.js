#!/usr/bin/env node
/**
 * Phase 6.2: Placeholder-Hints generieren
 *
 * Für jeden taxonKey in queue.json, der noch kein pending/approved File hat,
 * werden Kandidaten-Hints in pending/{taxonKey}.json geschrieben.
 *
 * Pool-Größen (Überhang für Review-Komfort):
 *   german:    5 Kandidaten
 *   botanical: 5 Kandidaten
 *   general:   8 Kandidaten
 *
 * Mischung: je Pool 1 mnemonic (source: null), Rest factual (Dummy-URL).
 * So kann die Review-UI beide Szenarien (mit/ohne Quelle) abdecken.
 *
 * Dieses Skript ist ein Test-Generator. Der spätere KI-Generator hat dasselbe
 * Output-Schema und kann dieses Skript 1:1 ersetzen.
 *
 * Usage: node scripts/hints/02_generate_placeholder.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { CANDIDATE_QUOTAS, makePendingDoc } = require('./lib/hint-schema');

// Pfade
const ROOT = path.join(__dirname, '..', '..');
const SPECIES_CANDIDATES = [
  path.join(ROOT, 'data/output/species.ndjson'),
  path.join(ROOT, 'data/output/species_test.ndjson'),
];
const HINTS_DIR = path.join(ROOT, 'data/hints');
const PENDING_DIR = path.join(HINTS_DIR, 'pending');
const APPROVED_DIR = path.join(HINTS_DIR, 'approved');
const QUEUE_FILE = path.join(HINTS_DIR, 'queue.json');

const GENERATOR_ID = 'placeholder-v1';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pickSpeciesFile() {
  for (const candidate of SPECIES_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function loadSpeciesLookup(speciesFile) {
  const lookup = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(speciesFile, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.taxonKey === 'number') {
        lookup.set(obj.taxonKey, {
          canonicalName: obj.canonicalName || null,
          germanName: obj.germanName || null,
        });
      }
    } catch {
      // ignore
    }
  }

  return lookup;
}

/**
 * Erzeugt Placeholder-Kandidaten für einen Pool.
 * Mischung aus mnemonic (kind=mnemonic, source=null) und factual (mit Dummy-URL).
 */
function makeCandidatesForPool({ poolName, count, taxonKey, canonicalName, germanName }) {
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const isMnemonic = i === 0; // erster Kandidat je Pool = Eselsbrücke (zu Testzwecken)
    const poolLabel = poolName === 'german'
      ? 'Deutsch'
      : poolName === 'botanical' ? 'Botanisch' : 'Allgemein';

    if (isMnemonic) {
      candidates.push({
        text: `[PLACEHOLDER Eselsbrücke #${i + 1} · ${poolLabel}] Merksatz für ${canonicalName} (${germanName || '—'}).`,
        source: null,
        kind: 'mnemonic',
      });
    } else {
      candidates.push({
        text: `[PLACEHOLDER Hinweis #${i + 1} · ${poolLabel}] Fakt über ${canonicalName}${germanName ? ' (' + germanName + ')' : ''} — bitte durch echten Inhalt ersetzen.`,
        source: `https://example.com/placeholder/${taxonKey}/${poolName}/${i + 1}`,
        kind: 'factual',
      });
    }
  }
  return candidates;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 6.2: Placeholder-Hints generieren');
  console.log('='.repeat(60));

  if (!fs.existsSync(QUEUE_FILE)) {
    console.error(`FEHLER: Queue-Datei nicht gefunden: ${path.relative(ROOT, QUEUE_FILE)}`);
    console.error('Bitte zuerst `npm run hints:queue` ausführen.');
    process.exit(1);
  }

  const speciesFile = pickSpeciesFile();
  if (!speciesFile) {
    console.error('FEHLER: species.ndjson / species_test.ndjson fehlt.');
    process.exit(1);
  }

  ensureDir(PENDING_DIR);
  ensureDir(APPROVED_DIR);

  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const queuedKeys = Array.isArray(queue.taxonKeys) ? queue.taxonKeys : [];
  console.log(`Queue enthält ${queuedKeys.length} taxonKey(s)`);

  const lookup = await loadSpeciesLookup(speciesFile);
  console.log(`Species-Lookup: ${lookup.size} Einträge`);

  let written = 0;
  let skippedExists = 0;
  let skippedUnknown = 0;

  for (const taxonKey of queuedKeys) {
    const pendingPath = path.join(PENDING_DIR, `${taxonKey}.json`);
    const approvedPath = path.join(APPROVED_DIR, `${taxonKey}.json`);

    if (fs.existsSync(approvedPath) || fs.existsSync(pendingPath)) {
      skippedExists++;
      continue;
    }

    const meta = lookup.get(taxonKey);
    if (!meta) {
      skippedUnknown++;
      continue;
    }

    const candidates = {
      german: makeCandidatesForPool({
        poolName: 'german',
        count: CANDIDATE_QUOTAS.german,
        taxonKey,
        canonicalName: meta.canonicalName || '',
        germanName: meta.germanName || '',
      }),
      botanical: makeCandidatesForPool({
        poolName: 'botanical',
        count: CANDIDATE_QUOTAS.botanical,
        taxonKey,
        canonicalName: meta.canonicalName || '',
        germanName: meta.germanName || '',
      }),
      general: makeCandidatesForPool({
        poolName: 'general',
        count: CANDIDATE_QUOTAS.general,
        taxonKey,
        canonicalName: meta.canonicalName || '',
        germanName: meta.germanName || '',
      }),
    };

    const doc = makePendingDoc({
      taxonKey,
      canonicalName: meta.canonicalName,
      germanName: meta.germanName,
      candidates,
      generator: GENERATOR_ID,
    });

    fs.writeFileSync(pendingPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    written++;

    if (process.stdout.isTTY && written % 25 === 0) {
      process.stdout.write(`\r  geschrieben: ${written} / ${queuedKeys.length}`);
    }
  }

  if (process.stdout.isTTY) process.stdout.write('\n');

  console.log('-'.repeat(60));
  console.log(`geschrieben:         ${written}`);
  console.log(`übersprungen (da):   ${skippedExists}  (pending/approved existiert)`);
  console.log(`übersprungen (unknown): ${skippedUnknown}  (nicht in species-Datei)`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fehler beim Placeholder-Generieren:', err);
  process.exit(1);
});
