/**
 * Hint-Schema-Helper
 *
 * Schemas und Validatoren für Hints in der Review-Pipeline.
 *
 * Datei-Typen:
 *   - pending/{taxonKey}.json  → Kandidaten-Pool (5 german, 5 botanical, 8 general)
 *   - approved/{taxonKey}.json → Final selektierte Hints (2 german, 2 botanical, 4 general)
 *
 * Hint-Objekt-Schema (verwendet in pending UND approved):
 *   { text: string, source: string|null, kind: "factual"|"mnemonic" }
 *
 * Regel: kind === "factual" → source muss non-empty sein.
 *        kind === "mnemonic" → source darf null sein.
 */

const POOLS = ['german', 'botanical', 'general'];

const FINAL_QUOTAS = {
  german: 2,
  botanical: 2,
  general: 4,
};

const CANDIDATE_QUOTAS = {
  german: 5,
  botanical: 5,
  general: 8,
};

/**
 * Erzeugt ein pending-Dokument mit Kandidaten-Pool.
 */
function makePendingDoc({ taxonKey, canonicalName, germanName, candidates, generator }) {
  return {
    taxonKey,
    canonicalName,
    germanName,
    generatedAt: new Date().toISOString(),
    generator,
    candidates,
  };
}

/**
 * Erzeugt ein approved-Dokument.
 */
function makeApprovedDoc({ taxonKey, canonicalName, germanName, hints, approvedBy }) {
  return {
    taxonKey,
    canonicalName,
    germanName,
    approvedAt: new Date().toISOString(),
    approvedBy: approvedBy || null,
    hints,
  };
}

/**
 * Prüft ein einzelnes Hint-Objekt.
 * @returns {string|null} Fehlermeldung oder null wenn ok.
 */
function validateHint(hint) {
  if (!hint || typeof hint !== 'object') return 'hint ist kein Objekt';
  if (typeof hint.text !== 'string' || !hint.text.trim()) return 'text fehlt oder leer';
  if (hint.kind !== 'factual' && hint.kind !== 'mnemonic') {
    return `kind muss "factual" oder "mnemonic" sein (war: ${JSON.stringify(hint.kind)})`;
  }
  if (hint.kind === 'factual') {
    if (typeof hint.source !== 'string' || !hint.source.trim()) {
      return 'factual-Hint ohne source';
    }
  }
  if (hint.kind === 'mnemonic') {
    if (hint.source !== null && (typeof hint.source !== 'string' || !hint.source.trim())) {
      return 'mnemonic-Hint hat unzulässiges source-Feld (erlaubt: null oder non-empty string)';
    }
  }
  return null;
}

/**
 * Prüft ein approved-Dokument inkl. Quoten.
 * @returns {string[]} Liste von Fehlermeldungen (leer = ok).
 */
function validateApprovedDoc(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['doc ist kein Objekt'];
  if (typeof doc.taxonKey !== 'number') errors.push('taxonKey fehlt oder nicht number');
  if (!doc.hints || typeof doc.hints !== 'object') {
    errors.push('hints-Objekt fehlt');
    return errors;
  }
  for (const pool of POOLS) {
    const arr = doc.hints[pool];
    if (!Array.isArray(arr)) {
      errors.push(`hints.${pool} ist kein Array`);
      continue;
    }
    const expected = FINAL_QUOTAS[pool];
    if (arr.length !== expected) {
      errors.push(`hints.${pool} hat ${arr.length} Einträge, erwartet ${expected}`);
    }
    arr.forEach((h, idx) => {
      const err = validateHint(h);
      if (err) errors.push(`hints.${pool}[${idx}]: ${err}`);
    });
  }
  return errors;
}

/**
 * Reduziert einen Pool von Hint-Objekten auf reine Text-Strings.
 * Verwendet beim Merge in species.ndjson (Agentur-Format = string[]).
 */
function stripHintsToStrings(hintsObj) {
  const out = {};
  for (const pool of POOLS) {
    const arr = Array.isArray(hintsObj?.[pool]) ? hintsObj[pool] : [];
    out[pool] = arr.map(h => (typeof h === 'string' ? h : h?.text || '')).filter(Boolean);
  }
  return out;
}

module.exports = {
  POOLS,
  FINAL_QUOTAS,
  CANDIDATE_QUOTAS,
  makePendingDoc,
  makeApprovedDoc,
  validateHint,
  validateApprovedDoc,
  stripHintsToStrings,
};
