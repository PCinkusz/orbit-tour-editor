// Modal dialogs: tour settings and the export wizard.
import { $, h } from './dom.js';
import { icon } from './icons.js';
import { app, commit, on, setActive, undo } from './state.js';
import { presentationOf, validateProject } from './project.js';
import { labelled, group, rangeInput, selectInput, segmented, tryCommit } from './editor.js';
import { notify, friendlyError } from './toast.js';

const closeButton = dialog => h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onClick: () => dialog.close() }, icon('x'));
const head = (title, id, dialog) => h('div', { class: 'dialog-head' }, h('h2', { id }, title), closeButton(dialog));
const section = (title, ...kids) => h('section', { class: 'dialog-section' }, h('h3', {}, title), ...kids);

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} kB`;
}
async function getJSON(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// ---------------------------------------------------------------- settings
export function openSettings() {
  const dialog = $('#settings-dialog');
  const p = () => presentationOf(app.project);
  const set = patch => tryCommit(() => ({ ...structuredClone(app.project), presentation: { ...p(), ...patch } }), { ui: 'none', key: `presentation-${Object.keys(patch)}` });

  dialog.replaceChildren(
    head('Tour settings', 'settings-title', dialog),
    h('div', { class: 'dialog-body' },
      section('Navigation',
        group('Mouse drag', segmented(p().dragMode, [['grab', 'Grab the view'], ['look', 'Move the camera']], v => set({ dragMode: v }))),
        group('Moving between locations', segmented(p().transition, [['fade', 'Fade'], ['zoom', 'Zoom'], ['cut', 'Instant']], v => set({ transition: v }))),
        labelled('Transition length', rangeInput(p().transitionMs, { min: 0, max: 1500, step: 50 }, v => set({ transitionMs: v }), v => `${v} ms`))),
      section('Picture',
        labelled('Field of view', rangeInput(p().fieldOfView, { min: 45, max: 100, step: 1 }, v => set({ fieldOfView: v }), v => `${v}°`), 'Smaller values zoom in. Visitors can also scroll to zoom.'),
        labelled('Sharpness on screen', rangeInput(p().renderScale, { min: 1, max: 2, step: 0.25 }, v => set({ renderScale: v }), v => `${v.toFixed(2)}×`),
          'Draws the view at a higher resolution on a computer. It costs graphics performance and cannot add detail that the video does not contain.'),
        labelled('Headset edge quality', selectInput(p().vrFoveation, [[0, 'Sharpest (slower)'], [0.5, 'Balanced'], [1, 'Fastest']], v => set({ vrFoveation: Number(v) })))),
      section('Backup',
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'button', onClick: downloadSettings }, icon('download'), 'Download settings'),
          h('button', { type: 'button', class: 'button', onClick: () => $('#import-file').click() }, icon('upload'), 'Import settings…')),
        h('p', { class: 'hint' }, 'Settings files contain locations, hotspots and options, but not the videos. To move a whole tour to another computer, use Export instead.'))),
    h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'button primary', onClick: () => dialog.close() }, 'Done'))
  );
  dialog.showModal();
}

function downloadSettings() {
  const blob = new Blob([JSON.stringify(app.project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: 'tour-settings.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initImport() {
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = validateProject(JSON.parse(await file.text()));
      commit(imported, { ui: 'full' });
      if (imported.scenes[0]) setActive(imported.scenes[0].id);
      notify('Settings imported.', { action: { label: 'Undo', run: () => undo() } });
      $('#settings-dialog').close();
    } catch (error) { notify(`That file could not be imported: ${friendlyError(error)}`, { kind: 'error' }); }
  });
}

// ---------------------------------------------------------------- export
export async function openExport() {
  const dialog = $('#export-dialog');
  const body = h('div', { class: 'dialog-body' }, h('p', { class: 'hint' }, 'Checking your videos…'));
  const foot = h('div', { class: 'dialog-foot' });
  dialog.replaceChildren(head('Export tour', 'export-title', dialog), body, foot);
  let timer = null;
  dialog.addEventListener('close', () => clearInterval(timer), { once: true });
  dialog.showModal();

  const setView = (content, buttons) => { body.replaceChildren(...content); foot.replaceChildren(...buttons); };
  const closeBtn = (label = 'Close') => h('button', { type: 'button', class: 'button', onClick: () => dialog.close() }, label);

  const showError = message => setView(
    [h('p', { class: 'callout warn' }, icon('alert'), h('span', {}, message || 'Something went wrong.'))],
    [closeBtn(), h('button', { type: 'button', class: 'button primary', onClick: start }, 'Try again')]);

  function showRunning(status) {
    const bar = h('progress', { max: 100, value: status?.percent ?? 0, 'aria-label': 'Export progress' });
    const step = h('span', {}, status?.step || 'Preparing');
    const pct = h('span', {}, `${Math.round(status?.percent ?? 0)}%`);
    setView([h('p', {}, 'Building the tour package. Keep this window open; you can keep editing in the background, but changes made now will not be part of this export.'),
      bar, h('div', { class: 'progress-line' }, step, pct)],
    [h('button', { type: 'button', class: 'button', onClick: async () => { await fetch('/api/export/cancel', { method: 'POST' }); } }, 'Cancel export')]);
    clearInterval(timer);
    timer = setInterval(async () => {
      try {
        const s = await getJSON('/api/export/status');
        bar.value = s.percent ?? 0; pct.textContent = `${Math.round(s.percent ?? 0)}%`; step.textContent = s.step || '';
        if (s.state === 'done') { clearInterval(timer); showDone(s); }
        else if (s.state === 'error') { clearInterval(timer); showError(s.error); }
        else if (s.state === 'cancelled') { clearInterval(timer); notify('Export cancelled.'); start(true); }
      } catch (error) { clearInterval(timer); showError(error.message); }
    }, 700);
  }

  function showDone(s) {
    const copy = h('button', { type: 'button', class: 'button small', onClick: async () => {
      try { await navigator.clipboard.writeText(s.outDir); notify('Folder path copied.'); } catch { notify('Select the path and copy it manually.', { kind: 'error' }); }
    } }, icon('copy', 14), 'Copy');
    setView([
      h('p', { class: 'callout' }, icon('check'), h('span', {}, `Done. The tour package is ${fmtBytes(s.bytes)} and contains everything it needs.`)),
      h('div', { class: 'dialog-section' }, h('h3', {}, 'Folder'), h('div', { class: 'path-box' }, h('code', {}, s.outDir), copy)),
      h('div', { class: 'dialog-section' }, h('h3', {}, 'Next steps'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Copy the whole folder to the other computer (USB drive, cloud storage, or upload it to a web host).'),
          h('li', {}, 'On Windows double-click start-windows.bat; on Mac or Linux run start-mac-linux.sh. It needs Node.js or Python.'),
          h('li', {}, 'For a VR headset, follow HOW-TO-PLAY.txt in the folder.'))),
      ...(s.warnings?.length ? [h('div', { class: 'dialog-section' }, h('h3', {}, 'Notes'), ...s.warnings.map(w => h('p', { class: 'callout warn' }, icon('alert'), h('span', {}, w))))] : [])
    ], [closeBtn(), h('button', { type: 'button', class: 'button', onClick: () => start(true) }, 'Export again')]);
  }

  async function start(forceChoose = false) {
    try {
      const status = await getJSON('/api/export/status');
      if (status.state === 'running') { showRunning(status); return; }
      const info = await getJSON('/api/export/info');
      showChoose(info);
    } catch (error) { showError(error.message); }
  }

  function showChoose(info) {
    const videos = info.videos ?? [];
    const unfriendly = videos.filter(v => !v.headsetFriendly);
    const presets = (info.presets ?? []).map(p => ({ ...p, disabled: p.id !== 'original' && !info.ffmpeg }));
    const recommended = unfriendly.length && info.ffmpeg ? 'vr' : 'original';
    let choice = recommended;
    const nameFor = v => app.project.scenes.find(s => s.video === v.path)?.name ?? v.name ?? v.path;

    const videoList = videos.length
      ? h('ul', { class: 'video-list' }, videos.map(v => h('li', { class: 'video-row' },
        h('span', { class: 'video-name' }, nameFor(v)),
        h('span', { class: 'video-meta' }, [v.width && `${v.width} × ${v.height}`, v.fps && `${Math.round(v.fps)} fps`, v.sizeBytes && fmtBytes(v.sizeBytes)].filter(Boolean).join(' · ')),
        h('span', { class: `badge ${v.headsetFriendly ? 'ok' : 'warn'}` }, v.headsetFriendly ? 'Headset-ready' : 'Too large for most headsets'))))
      : h('p', { class: 'hint' }, 'No videos in this tour yet.');

    const radio = p => h('label', { class: 'preset' },
      h('input', { type: 'radio', name: 'quality', value: p.id, checked: p.id === recommended, disabled: p.disabled, onChange: () => { choice = p.id; } }),
      h('span', {}, h('strong', {}, p.label), h('span', { class: 'hint' }, p.disabled ? 'Needs ffmpeg on this computer, which was not found.' : p.description)),
      h('span', { class: 'size' }, p.estimateBytes ? `≈ ${fmtBytes(p.estimateBytes)}` : ''));

    setView([
      h('p', { class: 'hint' }, 'Creates a folder with the viewer, your videos and a one-click launcher. The other computer does not need this editor.'),
      section('Videos in this tour', videoList,
        unfriendly.length ? h('p', { class: 'callout warn' }, icon('alert'), h('span', {}, `${unfriendly.length} of ${videos.length} video${videos.length === 1 ? ' is' : 's are'} larger than a headset can usually play (over 4096 px wide or over 30 fps). Choose “Headset-friendly” to convert ${unfriendly.length === 1 ? 'it' : 'them'} automatically.`)) : null),
      section('Quality', ...presets.map(radio))
    ], [closeBtn('Cancel'), h('button', { type: 'button', class: 'button primary', disabled: !videos.length && false, onClick: async () => {
      try { await getJSON('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quality: choice }) }); showRunning({ percent: 0, step: 'Preparing' }); }
      catch (error) { showError(error.message); }
    } }, icon('package'), 'Create package')]);
  }

  start();
}
