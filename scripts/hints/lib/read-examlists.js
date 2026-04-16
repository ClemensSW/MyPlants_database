/**
 * Exam-List Reader
 *
 * Liest alle NDJSON-Dateien unter data/exam-lists/**\/*.ndjson rekursiv
 * und extrahiert ausschließlich das taxonKey-Feld. Andere Felder werden
 * ignoriert — so überlebt der Reader zukünftige Schema-Änderungen der
 * Exam-Listen, solange taxonKey weiterhin vorhanden ist.
 *
 * Non-NDJSON Dateien (PDFs, MDs, JSONs, Referenzmaterial) werden ignoriert.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Liefert alle .ndjson-Dateien unter rootDir rekursiv.
 */
function collectNdjsonFilesSync(rootDir) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectNdjsonFilesSync(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ndjson')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Liest eine NDJSON-Datei Zeile-für-Zeile und liefert alle taxonKey-Werte.
 * Überspringt Zeilen ohne validen taxonKey.
 */
async function readTaxonKeysFromFile(filePath) {
  const keys = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj?.taxonKey === 'number' && Number.isFinite(obj.taxonKey)) {
        keys.push(obj.taxonKey);
      }
    } catch {
      // Defekte Zeile ignorieren — der Reader soll tolerant sein
    }
  }

  return keys;
}

/**
 * Sammelt eindeutige taxonKeys aus allen Exam-Listen.
 *
 * @param {string} rootDir - z. B. `data/exam-lists`
 * @returns {Promise<{ taxonKeys: Set<number>, sources: string[] }>}
 */
async function listTaxonKeysFromExamLists(rootDir) {
  const files = collectNdjsonFilesSync(rootDir);
  const taxonKeys = new Set();
  const sources = [];

  for (const file of files) {
    const keys = await readTaxonKeysFromFile(file);
    if (keys.length > 0) {
      sources.push(file);
      keys.forEach(k => taxonKeys.add(k));
    }
  }

  return { taxonKeys, sources };
}

module.exports = {
  collectNdjsonFilesSync,
  readTaxonKeysFromFile,
  listTaxonKeysFromExamLists,
};
