/**
 * Review-UI Konfiguration
 *
 * Admin-Toggle analog zu MyPlants_milestones/milestones/js/data/config.js.
 * Auf false setzen, um schreibende Funktionen auszublenden.
 */

const CONFIG = {
  showAdminTools: true,

  // Quoten für final genehmigte Hints (fest, siehe Lernalgorithmus):
  finalQuotas: {
    german: 2,
    botanical: 2,
    general: 4,
  },

  // Pool-Label für die UI
  poolLabels: {
    german: 'Deutsch',
    botanical: 'Botanisch',
    general: 'Allgemein',
  },
};
