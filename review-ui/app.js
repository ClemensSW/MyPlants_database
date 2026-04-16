/**
 * Hints Review UI — Logik
 *
 * Kein Backend. Nutzt die Browser File System Access API (wie das Milestones-
 * Admin-Panel): User wählt das Verzeichnis data/hints/, die UI liest
 * pending/{taxonKey}.json, lässt Review zu und schreibt approved/{taxonKey}.json.
 *
 * Daten-Flow:
 *   - In-Memory: state.plants = [{ taxonKey, canonicalName, germanName, pendingDoc }]
 *   - Aktuell bearbeitet: state.activePlantId + state.currentEdit (hints + Cursor je Pool)
 *   - Approve: schreibt approved-File, löscht pending-File, entfernt aus Liste
 *
 * Browser-Support: Chrome / Edge. Firefox / Safari haben die FSA API nicht.
 */

const POOLS = ['german', 'botanical', 'general'];

const state = {
  dirHandle: null,
  pendingDirHandle: null,
  approvedDirHandle: null,
  plants: [],               // [{ taxonKey, canonicalName, germanName, pendingDoc }]
  activeTaxonKey: null,
  currentEdit: null,        // { hints: {german:[slot,...]}, cursors: {german:N} }
  filter: '',
};

// ─── DOM ───────────────────────────────────────────────────────────────────

const els = {
  pickDir:        document.getElementById('btn-pick-dir'),
  reload:         document.getElementById('btn-reload'),
  dirStatus:      document.getElementById('dir-status'),
  filter:         document.getElementById('plant-filter'),
  plantList:      document.getElementById('plant-list'),
  plantCount:     document.getElementById('plant-count'),
  emptyState:     document.getElementById('empty-state'),
  plantDetail:    document.getElementById('plant-detail'),
  dTaxonkey:      document.getElementById('d-taxonkey'),
  dCanonical:     document.getElementById('d-canonical'),
  dGerman:        document.getElementById('d-german'),
  approveBtn:     document.getElementById('btn-approve'),
  validationMsg:  document.getElementById('validation-msg'),
  slotTemplate:   document.getElementById('slot-template'),
  toast:          document.getElementById('toast'),
};

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!CONFIG.showAdminTools) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center;">Admin-Modus deaktiviert (siehe config.js)</p>';
    return;
  }

  els.pickDir.addEventListener('click', handlePickDirectory);
  els.reload.addEventListener('click', () => loadPending(true));
  els.filter.addEventListener('input', (e) => {
    state.filter = e.target.value.trim().toLowerCase();
    renderPlantList();
  });
  els.approveBtn.addEventListener('click', handleApprove);

  for (const pool of POOLS) {
    const addBtn = document.querySelector(`[data-add-for="${pool}"]`);
    addBtn.addEventListener('click', () => {
      if (!state.currentEdit) return;
      state.currentEdit.hints[pool].push(makeEmptySlot());
      renderDetail();
    });
  }
});

// ─── File System Access ────────────────────────────────────────────────────

async function handlePickDirectory() {
  if (!window.showDirectoryPicker) {
    alert('Dein Browser unterstützt die File System Access API nicht. Bitte Chrome oder Edge verwenden.');
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.dirHandle = handle;
    els.dirStatus.textContent = `📁 ${handle.name}`;
    els.reload.hidden = false;
    await loadPending();
  } catch (err) {
    if (err.name !== 'AbortError') {
      alert('Verzeichnis-Auswahl fehlgeschlagen: ' + err.message);
    }
  }
}

async function loadPending(verbose = false) {
  if (!state.dirHandle) return;

  state.plants = [];
  state.activeTaxonKey = null;
  state.currentEdit = null;

  try {
    state.pendingDirHandle = await state.dirHandle.getDirectoryHandle('pending', { create: false });
  } catch (err) {
    els.plantList.innerHTML = '';
    els.plantCount.textContent = '0';
    showEmpty('Kein <code>pending/</code>-Unterverzeichnis gefunden. Generiere zuerst Placeholder-Hints: <code>npm run hints:generate-placeholder</code>.');
    return;
  }

  // approved/-Handle (create: true, damit wir hineinschreiben können)
  state.approvedDirHandle = await state.dirHandle.getDirectoryHandle('approved', { create: true });

  const loaded = [];
  for await (const entry of state.pendingDirHandle.values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    try {
      const file = await entry.getFile();
      const text = await file.text();
      const doc = JSON.parse(text);
      if (typeof doc?.taxonKey !== 'number') continue;
      loaded.push({
        taxonKey: doc.taxonKey,
        canonicalName: doc.canonicalName || '',
        germanName: doc.germanName || '',
        pendingDoc: doc,
      });
    } catch (err) {
      console.warn(`Datei ${entry.name} nicht lesbar:`, err);
    }
  }

  loaded.sort((a, b) => a.taxonKey - b.taxonKey);
  state.plants = loaded;
  renderPlantList();

  if (loaded.length > 0) {
    selectPlant(loaded[0].taxonKey);
  } else {
    showEmpty('Kein pending Plant gefunden. Alles reviewt? 🌱');
  }

  if (verbose) showToast(`${loaded.length} pending Plants geladen`);
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function showEmpty(msg) {
  els.emptyState.innerHTML = `<p>${msg}</p><p class="hint-browser">Nur Chrome oder Edge unterstützt.</p>`;
  els.emptyState.hidden = false;
  els.plantDetail.hidden = true;
}

function renderPlantList() {
  const q = state.filter;
  const filtered = !q
    ? state.plants
    : state.plants.filter(p =>
        String(p.taxonKey).includes(q) ||
        (p.canonicalName || '').toLowerCase().includes(q) ||
        (p.germanName || '').toLowerCase().includes(q)
      );

  els.plantCount.textContent = `${filtered.length}/${state.plants.length}`;
  els.plantList.innerHTML = '';

  for (const p of filtered) {
    const li = document.createElement('li');
    if (p.taxonKey === state.activeTaxonKey) li.classList.add('active');
    li.innerHTML = `
      <div class="pl-taxon">${p.taxonKey}</div>
      <div class="pl-name">${escapeHtml(p.canonicalName || '—')}</div>
      <div class="pl-german">${escapeHtml(p.germanName || '—')}</div>
    `;
    li.addEventListener('click', () => selectPlant(p.taxonKey));
    els.plantList.appendChild(li);
  }
}

function selectPlant(taxonKey) {
  const plant = state.plants.find(p => p.taxonKey === taxonKey);
  if (!plant) return;

  state.activeTaxonKey = taxonKey;

  // currentEdit aus pendingDoc vorbereiten:
  //   - je Pool: initial so viele Slots wie FINAL_QUOTAS vorgeben, gefüllt aus candidates[0..N-1]
  //   - cursors[pool][slotIdx] = Index in candidates (für "nächster Kandidat")
  const hints = {};
  const cursors = {};
  for (const pool of POOLS) {
    const quota = CONFIG.finalQuotas[pool];
    const candidates = Array.isArray(plant.pendingDoc?.candidates?.[pool])
      ? plant.pendingDoc.candidates[pool]
      : [];
    hints[pool] = [];
    cursors[pool] = [];
    for (let i = 0; i < quota; i++) {
      if (i < candidates.length) {
        hints[pool].push(cloneHint(candidates[i]));
        cursors[pool].push(i);
      } else {
        hints[pool].push(makeEmptySlot());
        cursors[pool].push(-1);
      }
    }
  }

  state.currentEdit = {
    hints,
    cursors,
    candidates: plant.pendingDoc?.candidates || {},
  };

  els.emptyState.hidden = true;
  els.plantDetail.hidden = false;
  els.dTaxonkey.textContent = `taxonKey ${taxonKey}`;
  els.dCanonical.textContent = plant.canonicalName || '—';
  els.dGerman.textContent = plant.germanName || '—';

  renderDetail();
  renderPlantList(); // Active-State im Sidebar aktualisieren
}

function renderDetail() {
  els.validationMsg.textContent = '';
  els.validationMsg.className = 'validation-msg';

  for (const pool of POOLS) {
    const slotsContainer = document.querySelector(`[data-slots-for="${pool}"]`);
    slotsContainer.innerHTML = '';

    const slots = state.currentEdit.hints[pool];
    slots.forEach((hint, idx) => {
      slotsContainer.appendChild(renderSlot(pool, idx, hint));
    });

    const quotaEl = document.querySelector(`[data-quota-for="${pool}"]`);
    const target = CONFIG.finalQuotas[pool];
    quotaEl.textContent = `(${slots.length}/${target})`;
  }
}

function renderSlot(pool, idx, hint) {
  const frag = els.slotTemplate.content.cloneNode(true);
  const slot = frag.querySelector('.slot');
  const text = slot.querySelector('.slot-text');
  const source = slot.querySelector('.slot-source');
  const sourceOpen = slot.querySelector('.slot-source-open');
  const radios = slot.querySelectorAll('input[name="kind"]');
  const nextBtn = slot.querySelector('.slot-next');
  const deleteBtn = slot.querySelector('.slot-delete');
  const warnBox = slot.querySelector('.slot-warning');

  // Radios brauchen unique name pro Slot (sonst Gruppen-Konflikt)
  const radioName = `kind-${pool}-${idx}`;
  radios.forEach(r => {
    r.name = radioName;
    r.checked = (r.value === (hint.kind || 'factual'));
    r.addEventListener('change', (e) => {
      hint.kind = e.target.value;
      if (hint.kind === 'mnemonic') hint.source = null;
      renderDetail();
    });
  });

  text.value = hint.text || '';
  text.addEventListener('input', (e) => { hint.text = e.target.value; });

  const sourceVal = (hint.source === null || hint.source === undefined) ? '' : String(hint.source);
  source.value = sourceVal;
  source.placeholder = hint.kind === 'mnemonic'
    ? 'Eselsbrücke — keine Quelle nötig'
    : 'Quelle (URL oder Literaturangabe)';
  source.disabled = hint.kind === 'mnemonic';
  source.addEventListener('input', (e) => {
    const v = e.target.value;
    hint.source = v === '' && hint.kind === 'mnemonic' ? null : v;
    updateSourceLink(slot, hint);
    updateWarningState(slot, hint, warnBox);
  });

  updateSourceLink(slot, hint);
  updateWarningState(slot, hint, warnBox);

  // "Nächster Kandidat": aus Pool nehmen, Cursor erhöhen, wrap-around
  nextBtn.addEventListener('click', () => {
    const candidates = state.currentEdit.candidates?.[pool];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      showToast(`Kein Kandidaten-Pool für ${pool} vorhanden`);
      return;
    }
    const currentCursor = state.currentEdit.cursors[pool][idx] ?? -1;
    const nextCursor = (currentCursor + 1) % candidates.length;
    state.currentEdit.cursors[pool][idx] = nextCursor;
    state.currentEdit.hints[pool][idx] = cloneHint(candidates[nextCursor]);
    renderDetail();
  });

  deleteBtn.addEventListener('click', () => {
    state.currentEdit.hints[pool].splice(idx, 1);
    state.currentEdit.cursors[pool].splice(idx, 1);
    renderDetail();
  });

  return slot;
}

function updateSourceLink(slotEl, hint) {
  const link = slotEl.querySelector('.slot-source-open');
  if (typeof hint.source === 'string' && /^https?:\/\//i.test(hint.source)) {
    link.href = hint.source;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }
}

function updateWarningState(slotEl, hint, warnBox) {
  const needsSource = hint.kind === 'factual';
  const hasSource = typeof hint.source === 'string' && hint.source.trim().length > 0;
  if (needsSource && !hasSource) {
    slotEl.classList.add('warn');
    warnBox.hidden = false;
    warnBox.textContent = '⚠ Sachaussage ohne Quelle — Approve wird blockiert.';
  } else {
    slotEl.classList.remove('warn');
    warnBox.hidden = true;
    warnBox.textContent = '';
  }
}

// ─── Approve & Persist ─────────────────────────────────────────────────────

async function handleApprove() {
  if (!state.currentEdit || !state.activeTaxonKey) return;

  const errors = validateCurrentEdit();
  if (errors.length > 0) {
    els.validationMsg.className = 'validation-msg error';
    els.validationMsg.innerHTML = 'Nicht freigebbar:<ul>' + errors.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
    return;
  }

  const plant = state.plants.find(p => p.taxonKey === state.activeTaxonKey);
  if (!plant) return;

  // Approved-Doc zusammenbauen
  const approvedDoc = {
    taxonKey: plant.taxonKey,
    canonicalName: plant.canonicalName,
    germanName: plant.germanName,
    approvedAt: new Date().toISOString(),
    approvedBy: null,
    hints: {
      german:    state.currentEdit.hints.german.map(cleanHint),
      botanical: state.currentEdit.hints.botanical.map(cleanHint),
      general:   state.currentEdit.hints.general.map(cleanHint),
    },
  };

  try {
    // approved/{taxonKey}.json schreiben
    const approvedFileHandle = await state.approvedDirHandle.getFileHandle(`${plant.taxonKey}.json`, { create: true });
    const writable = await approvedFileHandle.createWritable();
    await writable.write(JSON.stringify(approvedDoc, null, 2) + '\n');
    await writable.close();

    // pending/{taxonKey}.json löschen
    await state.pendingDirHandle.removeEntry(`${plant.taxonKey}.json`);

    // Aus State entfernen
    const idx = state.plants.findIndex(p => p.taxonKey === plant.taxonKey);
    state.plants.splice(idx, 1);

    showToast(`✓ ${plant.canonicalName} freigegeben`);

    // Nächstes Plant auswählen
    if (state.plants.length === 0) {
      state.activeTaxonKey = null;
      state.currentEdit = null;
      renderPlantList();
      showEmpty('🌱 Alle pending Plants reviewt!');
    } else {
      const next = state.plants[Math.min(idx, state.plants.length - 1)];
      selectPlant(next.taxonKey);
    }
  } catch (err) {
    els.validationMsg.className = 'validation-msg error';
    els.validationMsg.textContent = 'Speichern fehlgeschlagen: ' + err.message;
  }
}

function validateCurrentEdit() {
  const errors = [];
  const { finalQuotas, poolLabels } = CONFIG;

  for (const pool of POOLS) {
    const slots = state.currentEdit.hints[pool];
    const target = finalQuotas[pool];
    const label = poolLabels[pool];

    if (slots.length !== target) {
      errors.push(`${label}: ${slots.length} Hints statt erwartet ${target}`);
    }

    slots.forEach((h, idx) => {
      if (!h.text || !h.text.trim()) {
        errors.push(`${label} #${idx + 1}: Text fehlt`);
      }
      if (h.kind === 'factual' && (!h.source || !String(h.source).trim())) {
        errors.push(`${label} #${idx + 1}: Sachaussage ohne Quelle`);
      }
      if (h.kind !== 'factual' && h.kind !== 'mnemonic') {
        errors.push(`${label} #${idx + 1}: ungültiger Typ (${h.kind})`);
      }
    });
  }
  return errors;
}

function cleanHint(h) {
  return {
    text: (h.text || '').trim(),
    source: h.kind === 'mnemonic'
      ? (h.source && String(h.source).trim() ? String(h.source).trim() : null)
      : String(h.source || '').trim(),
    kind: h.kind === 'mnemonic' ? 'mnemonic' : 'factual',
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEmptySlot() {
  return { text: '', source: '', kind: 'factual' };
}

function cloneHint(h) {
  return {
    text: String(h?.text || ''),
    source: h?.source === null ? null : String(h?.source ?? ''),
    kind: h?.kind === 'mnemonic' ? 'mnemonic' : 'factual',
  };
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  return div.innerHTML;
}

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2500);
}
