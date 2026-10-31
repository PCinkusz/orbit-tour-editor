import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import './style.css';
import { $ } from './dom.js';
import { app, loadProject, setMode, on, undo, redo } from './state.js';
import { initViewer, closeInfo, cancelPlacement, isPlacing, togglePlay } from './viewer.js';
import { initEditor } from './editor.js';
import { openSettings, openExport, initImport } from './dialogs.js';

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

function showFatal(message) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.dataset.kind = 'error';
  notice.hidden = false;
}

function wireShortcuts() {
  const typing = target => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName) && target.type !== 'range' && target.type !== 'checkbox';
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return; // native dialogs handle Escape themselves
      if (isPlacing()) cancelPlacement(); else closeInfo();
      return;
    }
    if (typing(event.target) || app.mode === 'view' && event.key !== ' ') return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    else if (event.key === ' ' && (event.target === document.body || event.target.closest?.('#stage')) && event.target.tagName !== 'BUTTON') { event.preventDefault(); togglePlay(); }
  });
}

async function boot() {
  app.isStatic = !!document.querySelector('meta[name="orbit-static"]');
  initViewer();
  initEditor();
  initImport();
  wireShortcuts();
  $('#settings-button').addEventListener('click', openSettings);
  $('#export-button').addEventListener('click', openExport);

  let project;
  let config = { viewOnly: false };
  try {
    if (app.isStatic) { config = { viewOnly: true }; project = await fetchJson('./tour.json'); }
    else [project, config] = await Promise.all([fetchJson('/api/project'), fetchJson('/api/config')]);
  } catch (error) {
    showFatal(app.isStatic ? 'This tour could not be loaded. Open it through the included start script or a web server rather than directly from the file.' : 'Could not reach the editor server. Start it with “npm start” and reload this page.');
    return;
  }
  app.viewOnly = !!config.viewOnly;
  setMode(app.viewOnly ? 'view' : 'edit');
  try { loadProject(project); } catch (error) { showFatal(`This tour file is not valid: ${error.message}`); return; }
  on('project', () => { document.title = app.project.title ? `${app.project.title} — Orbit` : 'Orbit — 360° tour editor'; });
  document.title = app.project.title ? `${app.project.title} — Orbit` : 'Orbit — 360° tour editor';
}

boot();
