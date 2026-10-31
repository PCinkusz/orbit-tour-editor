// Single source of truth for the editor/viewer: current project, selection, mode, saving, undo.
import { freshProject, validateProject } from './project.js';

export const app = {
  project: freshProject(),
  activeId: null,       // current location
  selectedId: null,     // selected hotspot in the current location
  mode: 'edit',         // 'edit' | 'preview' | 'view' (visitor)
  viewOnly: false,
  isStatic: false,      // exported package: no API, project comes from tour.json
  saveState: 'saved'    // 'saved' | 'saving' | 'unsaved' | 'failed'
};

const bus = new EventTarget();
export const on = (type, fn) => {
  const wrapped = event => fn(event.detail);
  bus.addEventListener(type, wrapped);
  return () => bus.removeEventListener(type, wrapped);
};
export const emit = (type, detail = {}) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const scene = () => app.project.scenes.find(s => s.id === app.activeId) ?? null;
export const hotspotById = id => scene()?.hotspots.find(x => x.id === id) ?? null;
export const selectedHotspot = () => hotspotById(app.selectedId);

// ---------- history ----------
let past = [];
let future = [];
let lastKey = null;
let lastAt = 0;

/**
 * Apply a new project. ui: 'full' rebuilds panels, 'markers' refreshes markers/lists only,
 * 'none' changes data silently (typing in a field). Edits sharing a key within ~1s merge into one undo step.
 */
export function commit(next, { ui = 'markers', key = null } = {}) {
  const validated = validateProject(next);
  const now = Date.now();
  if (!(key && key === lastKey && now - lastAt < 1200)) {
    past.push(app.project);
    if (past.length > 100) past.shift();
  }
  future = [];
  lastKey = key; lastAt = now;
  app.project = validated;
  // Deleting the open location (or a selected hotspot) must not leave dangling selection.
  const sceneGone = !validated.scenes.some(s => s.id === app.activeId);
  if (sceneGone) app.activeId = validated.scenes[0]?.id ?? null;
  if (sceneGone || !selectedHotspot()) app.selectedId = null;
  scheduleSave();
  emit('project', { ui });
  if (sceneGone) { emit('scene', { autoplay: false, changed: true }); emit('selection'); }
  return validated;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

function restore(project) {
  const before = scene();
  app.project = project;
  lastKey = null;
  if (!app.project.scenes.some(s => s.id === app.activeId)) app.activeId = app.project.scenes[0]?.id ?? null;
  if (!selectedHotspot()) app.selectedId = null;
  scheduleSave();
  emit('project', { ui: 'full' });
  const after = scene();
  if (before?.id !== after?.id || before?.video !== after?.video) emit('scene', { autoplay: false, changed: true });
  emit('selection');
}
export function undo() { if (!past.length) return false; future.push(app.project); restore(past.pop()); return true; }
export function redo() { if (!future.length) return false; past.push(app.project); restore(future.pop()); return true; }

// ---------- navigation ----------
export function setActive(id, { autoplay = false } = {}) {
  if (!app.project.scenes.some(s => s.id === id)) return;
  const changed = app.activeId !== id;
  app.activeId = id;
  app.selectedId = null;
  if (changed) emit('scene', { autoplay, changed });
  emit('selection');
}
export function setSelected(id) { app.selectedId = id; emit('selection'); }
export function setMode(mode) {
  app.mode = mode;
  if (mode !== 'edit') app.selectedId = null;
  emit('mode');
  emit('selection');
}

/** Replace everything (boot, import). */
export function loadProject(project) {
  app.project = validateProject(project);
  past = []; future = []; lastKey = null;
  app.activeId = app.project.scenes[0]?.id ?? null;
  app.selectedId = null;
  emit('project', { ui: 'full' });
  emit('scene', { autoplay: false, changed: true });
  emit('selection');
}

// ---------- saving ----------
let saveTimer;
let saveQueue = Promise.resolve();
function setSaveState(state) { app.saveState = state; emit('save', { state }); }

export function scheduleSave() {
  if (app.viewOnly) return;
  setSaveState('unsaved');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}
export function saveNow() {
  if (app.viewOnly) return Promise.resolve();
  clearTimeout(saveTimer);
  const snapshot = app.project;
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    setSaveState('saving');
    const response = await fetch('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Save failed');
    if (snapshot === app.project) setSaveState('saved');
  }).catch(error => { setSaveState('failed'); emit('save-error', { message: error.message }); });
  return saveQueue;
}
