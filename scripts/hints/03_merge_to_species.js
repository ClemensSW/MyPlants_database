#!/usr/bin/env node
/**
 * Phase 6.3: Approved Hints in species.ndjson mergen
 *
 * Liest data/hints/approved/*.json, extrahiert pro taxonKey die finalen
 * Hint-Texte (ohne source/kind) und setzt sie im hints-Feld der
 * species.ndjson. Schreibt atomisch über Temp-File.
 *
 * Format im Ziel (kompatibel zum Agentur-Vorschlag):
 *   hints: { german: string[], botanical: string[], general: string[] }
 *
 * Audit-Trail (source, kind, approvedAt, approvedBy) bleibt in
 * data/hints/approved/ erhalten und wird NICHT in species.ndjson kopiert.
 *
 * Usage: node scripts/hints/03_merge_to_species.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { stripHintsToStrings } = require('./lib/hint-schema');

// Pfade
const ROOT = path.join(__dirname, '..', '..');
const SPECIES_CANDIDATES = [
  path.join(ROOT, 'data/output/species.ndjson'),
  path.join(ROOT, 'data/output/species_test.ndjson'),
];
const APPROVED_DIR = path.join(ROOT, 'data/hints/approved');

function pickSpeciesFile() {
  for (const candidate of SPECIES_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadApprovedMap() {
  const map = new Map();
  let mnemonicCount = 0;
  let factualCount = 0;

  if (!fs.existsSync(APPROVED_DIR)) return { map, mnemonicCount, factualCount };

  const files = fs.readdirSync(APPROVED_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const full = path.join(APPROVED_DIR, f);
      const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (typeof doc?.taxonKey !== 'number') continue;

      // Audit: zähle kind-Verteilung
      for (const pool of ['german', 'botanical', 'general']) {
        const arr = Array.isArray(doc?.hints?.[pool]) ? doc.hints[pool] : [];
        for (const h of arr) {
          if (h?.kind === 'mnemonic') mnemonicCount++;
          else if (h?.kind === 'factual') factualCount++;
        }
      }

      map.set(doc.taxonKey, stripHintsToStrings(doc.hints || {}));
    } catch (err) {
      console.warn(`Warnung: approved-Datei ${f} nicht lesbar: ${err.message}`);
    }
  }
  return { map, mnemonicCount, factualCount };
}

async function mergeStream(inputFile, outputFile, approvedMap) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(inputFile, 'utf8'),
      crlfDelay: Infinity,
    });
    const out = fs.createWriteStream(outputFile, { flags: 'w' });

    let seen = 0;
    let merged = 0;
    let unchanged = 0;

    rl.on('line', (line) => {
      if (!line.trim()) return;
      seen++;
      try {
        const obj = JSON.parse(line);
        if (typeof obj?.taxonKey === 'number' && approvedMap.has(obj.taxonKey)) {
          obj.hints = approvedMap.get(obj.taxonKey);
          merged++;
        } else {
          unchanged++;
        }
        out.write(JSON.stringify(obj) + '\n');
      } catch {
        // defekte Zeile unverändert durchreichen (nicht stillschweigend verlieren)
        out.write(line + '\n');
      }
    });

    rl.on('close', () => {
      out.end();
    });
    rl.on('error', reject);
    out.on('error', reject);
    out.on('close', () => resolve({ seen, merged, unchanged }));
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 6.3: Approved Hints in species-Datei mergen');
  console.log('='.repeat(60));

  const speciesFile = pickSpeciesFile();
  if (!speciesFile) {
    console.error('FEHLER: species.ndjson / species_test.ndjson fehlt.');
    process.exit(1);
  }
  console.log(`Ziel-Datei: ${path.relative(ROOT, speciesFile)}`);

  const { map: approvedMap, mnemonicCount, factualCount } = loadApprovedMap();
  console.log(`Approved-Dateien geladen: ${approvedMap.size}`);
  console.log(`  davon factual-Hints:  ${factualCount}`);
  console.log(`  davon mnemonic-Hints: ${mnemonicCount}`);

  if (approvedMap.size === 0) {
    console.log('Keine approved-Dateien vorhanden — nichts zu mergen.');
    return;
  }

  const tmpFile = speciesFile + '.merge.tmp';
  const stats = await mergeStream(speciesFile, tmpFile, approvedMap);

  // Atomischer Ersatz
  fs.renameSync(tmpFile, speciesFile);

  console.log('-'.repeat(60));
  console.log(`Zeilen gelesen:  ${stats.seen}`);
  console.log(`Zeilen gemergt:  ${stats.merged}`);
  console.log(`Zeilen unverändert: ${stats.unchanged}`);
  console.log(`Datei geschrieben: ${path.relative(ROOT, speciesFile)}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fehler beim Merge:', err);
  process.exit(1);
});
