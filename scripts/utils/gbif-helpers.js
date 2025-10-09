/**
 * GBIF API Helper-Funktionen
 *
 * Wiederverwendbare Funktionen für die Interaktion mit der GBIF API.
 * Enthält Retry-Logik, Backoff-Strategien und häufig verwendete API-Calls.
 */

const axios = require('axios');

// Konstanten
const GBIF_API_BASE = 'https://api.gbif.org/v1';
const DEFAULT_TIMEOUT = 20000;
const DEFAULT_RETRIES = 5;
const BASE_BACKOFF_MS = 500;

/**
 * Wartet eine bestimmte Zeit (async sleep)
 * @param {number} ms - Millisekunden zu warten
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Führt einen HTTP-Request mit automatischen Retries durch
 *
 * @param {string} url - Die URL für den Request
 * @param {number} tries - Anzahl der Retry-Versuche (default: 5)
 * @param {number} timeout - Timeout in ms (default: 20000)
 * @returns {Promise<Object>} Die Response-Daten
 * @throws {Error} Wenn alle Retry-Versuche fehlschlagen
 */
async function fetchWithRetry(url, tries = DEFAULT_RETRIES, timeout = DEFAULT_TIMEOUT) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await axios.get(url, { timeout });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      // Retry bei Netzfehlern, 429 (Rate Limit) & 5xx (Server-Fehler)
      if (
        i < tries - 1 &&
        (status === 429 || (status >= 500 && status <= 599) || !status)
      ) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, i);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Holt Basis-Informationen zu einem Taxon
 *
 * @param {number} taxonKey - GBIF taxonKey
 * @param {string} language - Sprach-Code (default: 'de')
 * @returns {Promise<Object>} Taxon-Daten
 */
async function getSpecies(taxonKey, language = 'de') {
  const url = `${GBIF_API_BASE}/species/${taxonKey}?language=${language}`;
  return fetchWithRetry(url);
}

/**
 * Holt alle Trivialnamen (vernacular names) für ein Taxon
 *
 * @param {number} taxonKey - GBIF taxonKey
 * @returns {Promise<Object>} Vernacular names Response
 */
async function getVernacularNames(taxonKey) {
  const url = `${GBIF_API_BASE}/species/${taxonKey}/vernacularNames`;
  return fetchWithRetry(url);
}

/**
 * Sucht nach Occurrences mit Paging
 *
 * @param {Object} params - Query-Parameter für die Occurrence-Suche
 * @param {number} params.limit - Anzahl Ergebnisse pro Seite
 * @param {number} params.offset - Offset für Paging
 * @returns {Promise<Object>} Occurrence-Suchergebnisse
 */
async function searchOccurrences(params) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${GBIF_API_BASE}/occurrence/search?${queryString}`;
  return fetchWithRetry(url, DEFAULT_RETRIES, 30000); // Längerer Timeout für Occurrence-Suche
}

/**
 * Holt alle eindeutigen taxonKeys aus einem Dataset via Faceting
 *
 * @param {string} datasetKey - GBIF Dataset-Key
 * @param {number} facetLimit - Facet-Limit pro Request (default: 10000)
 * @returns {Promise<number[]>} Array von eindeutigen taxonKeys
 */
async function getAllTaxonKeysFromDataset(datasetKey, facetLimit = 10000) {
  const keys = new Set();
  let offset = 0;
  let page = 0;

  while (true) {
    const url = `${GBIF_API_BASE}/occurrence/search?datasetKey=${datasetKey}&limit=0&facet=taxonKey&facetLimit=${facetLimit}&facetOffset=${offset}`;
    const data = await fetchWithRetry(url, DEFAULT_RETRIES, 30000);
    const counts = data?.facets?.[0]?.counts || [];

    if (!counts.length) break;

    counts.forEach(c => keys.add(Number(c.name)));
    page++;
    offset += facetLimit;

    // Freundlich zur API
    await sleep(200);

    // Optionaler Progress-Log
    if (process.stdout.isTTY) {
      process.stdout.write(`\rSeite ${page}: +${counts.length} → bisher ${keys.size}`);
    }
  }

  if (process.stdout.isTTY) {
    process.stdout.write('\n');
  }

  return Array.from(keys).sort((a, b) => a - b);
}

/**
 * Filtert deutsche Namen aus vernacularNames
 *
 * @param {Array} vernacularNames - Array von vernacular name Objekten
 * @returns {Array} Gefilterte deutsche Namen
 */
function filterGermanNames(vernacularNames) {
  return (vernacularNames || [])
    .filter((v) => v?.vernacularName)
    .filter((v) => {
      const lang = (v.language || '').toLowerCase();
      return lang === 'de' || lang === 'deu' || lang === 'ger';
    })
    .map((v) => ({
      name: v.vernacularName,
      preferred: !!v.preferred,
      source: v.source || null,
    }));
}

/**
 * Wählt den bevorzugten deutschen Namen aus
 *
 * @param {Object} usage - Species-Objekt von GBIF
 * @param {Array} germanNames - Array von deutschen Namen
 * @returns {string|null} Bevorzugter deutscher Name oder null
 */
function pickPreferredGerman(usage, germanNames) {
  // 1) Direkt vom /species?language=de
  if (usage?.vernacularName) return usage.vernacularName;

  // 2) preferred:true falls vorhanden
  const pref = germanNames.find((v) => v.preferred);
  if (pref) return pref.name;

  // 3) erster Eintrag
  return germanNames[0]?.name || null;
}

/**
 * Dedupliziert ein Array nach einem Key
 *
 * @param {Array} arr - Input-Array
 * @param {Function} keyFn - Funktion die den Deduplizierungs-Key liefert
 * @returns {Array} Dedupliziertes Array
 */
function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = {
  // API-Funktionen
  fetchWithRetry,
  getSpecies,
  getVernacularNames,
  searchOccurrences,
  getAllTaxonKeysFromDataset,

  // Hilfsfunktionen
  filterGermanNames,
  pickPreferredGerman,
  uniqBy,
  sleep,

  // Konstanten
  GBIF_API_BASE,
};
