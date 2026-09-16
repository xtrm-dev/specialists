// XTRM-96 — pure state/layout model for the native Specialists fleet overlay.
//
// This file intentionally does NOT call ctx.ui.custom(). The currently shipped
// extension records a real hard-lock against that mount path on the installed Pi
// version. Keeping state/layout pure lets CI prove navigation, hierarchy, filtering,
// follow semantics and responsive rendering now; local closeout only has to bind
// this model to the current Pi/TUI component lifecycle.
//
// Input data is already-projected operator data. Do not pass raw forensic bodies.
// LOG rows should come from readForensicWindow()/forensicEventToRow().

export const FLEET_OVERLAY_MODES = Object.freeze(['log', 'feed', 'result', 'detail']);
export const FLEET_OVERLAY_MIN_WIDTH = 44;
export const FLEET_OVERLAY_DEFAULT_HEIGHT = 28;

const STATE_GLYPH = Object.freeze({
  blocked: '!',
  failed: '✕',
  active: '◐',
  settled: '✓',
  idle: '·',
});

export function createFleetOverlayState(initial = {}) {
  return {
    mode: FLEET_OVERLAY_MODES.includes(initial.mode) ? initial.mode : 'log',
    selectedJobId: initial.selectedJobId ?? null,
    filter: String(initial.filter ?? ''),
    follow: initial.follow ?? true,
    scroll: Math.max(0, Math.floor(initial.scroll ?? 0)),
  };
}

/**
 * Apply UI intent without touching Pi, SQLite, timers, or the host registry.
 * The mount layer translates keys/mouse gestures into these actions.
 */
export function reduceFleetOverlayState(state, action, snapshot) {
  const current = createFleetOverlayState(state);
  const rows = flattenFleet(snapshot, { filter: current.filter });
  const selectedIndex = rows.findIndex((row) => row.node.jobId === current.selectedJobId);

  switch (action?.type) {
    case 'select':
      return { ...current, selectedJobId: action.jobId ?? null, scroll: 0, follow: true };
    case 'next': {
      if (rows.length === 0) return { ...current, selectedJobId: null };
      const index = selectedIndex < 0 ? 0 : Math.min(rows.length - 1, selectedIndex + 1);
      return { ...current, selectedJobId: rows[index].node.jobId, scroll: 0, follow: true };
    }
    case 'previous': {
      if (rows.length === 0) return { ...current, selectedJobId: null };
      const index = selectedIndex < 0 ? 0 : Math.max(0, selectedIndex - 1);
      return { ...current, selectedJobId: rows[index].node.jobId, scroll: 0, follow: true };
    }
    case 'mode':
      return FLEET_OVERLAY_MODES.includes(action.mode)
        ? { ...current, mode: action.mode, scroll: 0, follow: action.mode === 'log' || action.mode === 'feed' ? current.follow : false }
        : current;
    case 'next-mode': {
      const index = FLEET_OVERLAY_MODES.indexOf(current.mode);
      const mode = FLEET_OVERLAY_MODES[(index + 1) % FLEET_OVERLAY_MODES.length];
      return { ...current, mode, scroll: 0, follow: mode === 'log' || mode === 'feed' ? current.follow : false };
    }
    case 'filter': {
      const filter = String(action.value ?? '');
      const filtered = flattenFleet(snapshot, { filter });
      const stillVisible = filtered.some((row) => row.node.jobId === current.selectedJobId);
      return {
        ...current,
        filter,
        selectedJobId: stillVisible ? current.selectedJobId : filtered[0]?.node.jobId ?? null,
        scroll: 0,
      };
    }
    case 'scroll': {
      const delta = Math.trunc(action.delta ?? 0);
      if (delta === 0) return current;
      return { ...current, scroll: Math.max(0, current.scroll + delta), follow: false };
    }
    case 'follow':
      return { ...current, follow: true, scroll: 0 };
    case 'pause':
      return { ...current, follow: false };
    default:
      return ensureSelection(current, rows);
  }
}

/**
 * Flatten the persisted lineage tree in preorder. A matching descendant keeps its
 * ancestors visible so filtering never destroys the answer to “who spawned this?”.
 */
export function flattenFleet(snapshot, { filter = '' } = {}) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const byId = snapshot?.byId instanceof Map
    ? snapshot.byId
    : new Map(nodes.map((node) => [node.jobId, node]));
  const roots = Array.isArray(snapshot?.roots) && snapshot.roots.length > 0
    ? snapshot.roots
    : nodes.filter((node) => !node.parentJobId || !byId.has(node.parentJobId)).map((node) => node.jobId);
  const needle = String(filter).trim().toLowerCase();
  const keep = new Map();
  const visiting = new Set();

  const matches = (node) => {
    if (!needle) return true;
    return [node.jobId, node.specialist, node.beadId, node.state, node.attention]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  };

  const subtreeMatches = (jobId) => {
    if (keep.has(jobId)) return keep.get(jobId);
    if (visiting.has(jobId)) return false;
    visiting.add(jobId);
    const node = byId.get(jobId);
    if (!node) {
      visiting.delete(jobId);
      keep.set(jobId, false);
      return false;
    }
    const childMatch = (node.children ?? []).some((childId) => subtreeMatches(childId));
    const result = matches(node) || childMatch;
    visiting.delete(jobId);
    keep.set(jobId, result);
    return result;
  };

  const rows = [];
  const emitted = new Set();
  const emit = (jobId, depth) => {
    if (emitted.has(jobId) || !subtreeMatches(jobId)) return;
    const node = byId.get(jobId);
    if (!node) return;
    emitted.add(jobId);
    rows.push({ node, depth });
    for (const childId of node.children ?? []) emit(childId, depth + 1);
  };
  for (const root of roots) emit(root, 0);
  // Defensive: include orphan/cyclic rows that the persisted snapshot surfaced but
  // could not reach from roots. They stay inspectable instead of disappearing.
  for (const node of nodes) emit(node.jobId, 0);
  return rows;
}

/**
 * Pure responsive renderer. Styling is intentionally restrained and terminal-neutral;
 * the Pi mount may color the semantic tokens with the extension's existing XTRM accent.
 */
export function renderFleetOverlay({
  snapshot,
  state: inputState,
  chronology = [],
  result = null,
  detail = null,
  width = 100,
  height = FLEET_OVERLAY_DEFAULT_HEIGHT,
} = {}) {
  const safeWidth = Math.max(FLEET_OVERLAY_MIN_WIDTH, Math.floor(width || 0));
  const safeHeight = Math.max(12, Math.floor(height || 0));
  const rows = flattenFleet(snapshot, { filter: inputState?.filter });
  const state = ensureSelection(createFleetOverlayState(inputState), rows);
  const selected = rows.find((row) => row.node.jobId === state.selectedJobId)?.node ?? null;
  const counts = snapshot?.counts ?? {};
  const headerParts = [
    'specialists · fleet',
    `${Number(counts.total ?? rows.length)} jobs`,
    `${Number(counts.active ?? 0)} active`,
    `${Number(counts.waiting ?? 0)} blocked`,
  ];
  if (Number(counts.failed ?? 0) > 0) headerParts.push(`${Number(counts.failed)} failed`);
  const lines = [truncate(headerParts.join(' · '), safeWidth)];
  lines.push(truncate(state.filter ? `/ ${state.filter}` : '/ filter', safeWidth));

  const bodyBudget = safeHeight - 5;
  const fleetBudget = Math.max(3, Math.min(10, Math.floor(bodyBudget * 0.38)));
  const selectedIndex = rows.findIndex((row) => row.node.jobId === state.selectedJobId);
  const fleetStart = windowStart(selectedIndex, rows.length, fleetBudget);
  const fleetWindow = rows.slice(fleetStart, fleetStart + fleetBudget);
  if (fleetWindow.length === 0) {
    lines.push(truncate('  no specialists match current filter', safeWidth));
  } else {
    for (const row of fleetWindow) lines.push(renderTreeRow(row, row.node.jobId === state.selectedJobId, safeWidth));
  }
  while (lines.length < 2 + fleetBudget) lines.push('');

  const modeLabel = state.mode.toUpperCase();
  const selectedLabel = selected ? `${selected.specialist}:${shortId(selected.jobId)}` : 'no selection';
  const followLabel = (state.mode === 'log' || state.mode === 'feed') ? (state.follow ? 'FOLLOW' : 'PAUSED') : '';
  lines.push(truncate(`${selectedLabel} · ${modeLabel}${followLabel ? ` · ${followLabel}` : ''}`, safeWidth));

  const detailBudget = Math.max(1, safeHeight - lines.length - 1);
  const detailLines = contentLines({ state, chronology, result, detail, selected, width: safeWidth });
  const maxScroll = Math.max(0, detailLines.length - detailBudget);
  const scroll = state.follow && (state.mode === 'log' || state.mode === 'feed')
    ? maxScroll
    : Math.min(state.scroll, maxScroll);
  for (const line of detailLines.slice(scroll, scroll + detailBudget)) lines.push(truncate(line, safeWidth));
  while (lines.length < safeHeight - 1) lines.push('');

  lines.push(truncate('↑↓ select · Tab view · / filter · f follow · PgUp/PgDn scroll · Esc close', safeWidth));
  return { lines, state, selected, maxScroll };
}

function contentLines({ state, chronology, result, detail, selected, width }) {
  if (!selected) return ['no activation selected'];
  if (state.mode === 'result') {
    const text = result?.output ?? result ?? 'result unavailable';
    return wrapLines(String(text), width);
  }
  if (state.mode === 'detail') {
    const safeDetail = detail && typeof detail === 'object' ? detail : defaultDetail(selected);
    return Object.entries(safeDetail)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .flatMap(([key, value]) => wrapLines(`${key.padEnd(14)} ${formatValue(value)}`, width));
  }
  const rows = Array.isArray(chronology) ? chronology : [];
  if (rows.length === 0) return [`no ${state.mode} rows`];
  return rows.map((row) => chronologyLine(row, width));
}

function defaultDetail(node) {
  return {
    specialist: node.specialist,
    job: node.jobId,
    work: node.beadId,
    state: node.state,
    parent: node.parentJobId,
    runtime: node.attachment?.kind,
    pane: node.attachment?.paneId,
  };
}

function chronologyLine(row, width) {
  const ts = row.ts ?? row.t;
  const time = typeof ts === 'number' ? new Date(ts).toISOString().slice(11, 19) : String(ts ?? '').slice(0, 8);
  const type = String(row.type ?? row.event_name ?? '').trim();
  const actor = String(row.actor ?? row.specialist ?? '').trim();
  const payload = String(row.payload ?? row.line ?? '').replace(/\s+/g, ' ').trim();
  return truncate([time, type, actor, payload].filter(Boolean).join('  '), width);
}

function renderTreeRow({ node, depth }, selected, width) {
  const pointer = selected ? '›' : ' ';
  const connector = depth === 0 ? '' : `${'  '.repeat(Math.max(0, depth - 1))}╰─ `;
  const glyph = STATE_GLYPH[node.attention] ?? STATE_GLYPH.idle;
  const identity = `${node.specialist}:${shortId(node.jobId)}`;
  const work = node.beadId ? `  ${node.beadId}` : '';
  const state = width >= 72 ? `  ${node.state}` : '';
  const attachment = width >= 96 && node.attachment?.paneId ? `  ${node.attachment.paneId}` : '';
  return truncate(`${pointer} ${connector}${glyph} ${identity}${work}${state}${attachment}`, width);
}

function ensureSelection(state, rows) {
  if (rows.some((row) => row.node.jobId === state.selectedJobId)) return state;
  return { ...state, selectedJobId: rows[0]?.node.jobId ?? null };
}

function windowStart(selectedIndex, total, budget) {
  if (total <= budget) return 0;
  if (selectedIndex < 0) return 0;
  return Math.max(0, Math.min(total - budget, selectedIndex - Math.floor(budget / 2)));
}

function shortId(jobId) {
  const text = String(jobId ?? '');
  const colon = text.indexOf(':');
  return (colon >= 0 ? text.slice(colon + 1) : text).slice(0, 10) || '?';
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function wrapLines(text, width) {
  const lines = [];
  for (const sourceLine of String(text).split('\n')) {
    let remaining = sourceLine;
    if (!remaining) {
      lines.push('');
      continue;
    }
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    lines.push(remaining);
  }
  return lines;
}

function truncate(text, width) {
  const value = String(text ?? '');
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}
