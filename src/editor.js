// Left "Locations" panel and right "Inspector": every control that edits the tour.
import { $, h, formatTime } from './dom.js';
import { icon } from './icons.js';
import { createMarker, STYLE_NAMES } from './markers.js';
import {
  app, scene, selectedHotspot, on, emit, commit, setActive, setSelected, setMode, undo, redo, canUndo, canRedo, saveNow
} from './state.js';
import {
  addScene, updateSceneFields, removeScene, moveScene, addHotspot, updateHotspot, removeHotspot,
  videoOptionsOf, hotspotAppearanceOf, hoverOf, effectOf, directionOf, usesDirection
} from './project.js';
import * as viewer from './viewer.js';
import { notify, friendlyError } from './toast.js';
import { mediaUrl } from './media.js';

let uid = 0;
const nextId = prefix => `${prefix}-${++uid}`;

// ---------------------------------------------------------------- small form controls
export function labelled(label, control, hint) {
  const id = control.id || (control.id = nextId('f'));
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id }, label), control,
    hint && h('p', { class: 'hint' }, hint));
}
export function group(label, control, hint) {
  const id = nextId('g');
  control.setAttribute('aria-labelledby', id);
  return h('div', { class: 'field' }, h('span', { class: 'field-label', id }, label), control, hint && h('p', { class: 'hint' }, hint));
}
export const textInput = (value, onInput, { max = 120, placeholder = '', id } = {}) =>
  h('input', { type: 'text', id, value: value ?? '', maxLength: max, placeholder, autocomplete: 'off', onInput: e => onInput(e.target.value) });
export const areaInput = (value, onInput) =>
  h('textarea', { rows: 4, maxLength: 4000, value: value ?? '', onInput: e => onInput(e.target.value) });
export function selectInput(value, options, onChange) {
  const el = h('select', { onChange: e => onChange(e.target.value) },
    options.map(([v, label, disabled]) => h('option', { value: v, disabled }, label)));
  el.value = String(value);
  return el;
}
export function rangeInput(value, { min, max, step }, onInput, format) {
  const out = h('output', {}, format(value));
  const input = h('input', { type: 'range', min, max, step, value, onInput: e => { out.textContent = format(Number(e.target.value)); onInput(Number(e.target.value)); } });
  return h('div', { class: 'range-row' }, input, out);
}
export function switchInput(label, checked, onChange) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', role: 'switch', checked, onChange: e => onChange(e.target.checked) }),
    h('span', { class: 'switch-ui', 'aria-hidden': 'true' }), h('span', {}, label));
}
export function segmented(value, options, onChange) {
  const root = h('div', { class: 'segmented small', role: 'radiogroup' });
  for (const [v, label] of options) {
    root.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value),
      onClick: event => { for (const b of root.children) b.setAttribute('aria-checked', String(b === event.currentTarget)); onChange(v); }
    }, label));
  }
  return root;
}
export function colorInput(value, onChange) {
  const hex = h('input', { type: 'text', class: 'hex', value, maxLength: 7, 'aria-label': 'Colour hex value', spellcheck: false, autocomplete: 'off' });
  const swatch = h('input', { type: 'color', value, 'aria-label': 'Pick colour', onInput: e => { hex.value = e.target.value; onChange(e.target.value); } });
  hex.addEventListener('change', () => {
    const v = hex.value.startsWith('#') ? hex.value : `#${hex.value}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) { notify('Enter a six-digit hex colour, like #25aae1.', { kind: 'error' }); hex.value = swatch.value; return; }
    swatch.value = v; hex.value = v; onChange(v);
  });
  return h('div', { class: 'color-row' }, swatch, hex);
}

// ---------------------------------------------------------------- uploads
function upload(file, kind, onProgress) {
  const allowed = kind === 'video' ? ['video/mp4', 'video/webm'] : ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) return Promise.reject(new Error(kind === 'video' ? 'Choose an MP4 or WebM video.' : 'Choose a JPG, PNG or WebP image.'));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    request.onerror = () => reject(new Error('Upload failed. Is the editor server still running?'));
    request.onload = () => {
      try {
        const data = JSON.parse(request.responseText);
        if (request.status !== 201) throw new Error(data.error || 'Upload failed');
        resolve(data.path);
      } catch (error) { reject(error); }
    };
    const body = new FormData(); body.append('file', file); request.send(body);
  });
}
function uploadControl({ kind, current, label, replaceLabel, onDone, extra }) {
  const bar = h('progress', { max: 1, value: 0, hidden: true, 'aria-label': 'Upload progress' });
  const status = h('p', { class: 'upload-status' }, current ? (kind === 'video' ? 'Video attached' : 'Image attached') : 'Nothing uploaded yet');
  const chooser = h('input', {
    type: 'file', hidden: true, accept: kind === 'video' ? '.mp4,.webm,video/mp4,video/webm' : '.jpg,.jpeg,.png,.webp,image/*',
    onChange: async () => {
      const file = chooser.files?.[0]; if (!file) return;
      bar.hidden = false; bar.value = 0; status.textContent = `Uploading ${file.name}…`;
      try { onDone(await upload(file, kind, p => { bar.value = p; })); notify(`${kind === 'video' ? 'Video' : 'Image'} uploaded.`); }
      catch (error) { status.textContent = error.message; notify(error.message, { kind: 'error' }); }
      finally { bar.hidden = true; chooser.value = ''; }
    }
  });
  return h('div', { class: 'upload' },
    h('div', { class: 'upload-row' },
      h('button', { type: 'button', class: 'button', onClick: () => chooser.click() }, icon(kind === 'video' ? 'video' : 'image'), current ? replaceLabel : label),
      extra), kind === 'image' && current && h('img', { class: 'upload-thumb', src: mediaUrl(current), alt: 'Attached image preview' }), chooser, bar, status);
}

// ---------------------------------------------------------------- shared edit helpers
export function tryCommit(build, options) {
  try { return commit(build(), options); } catch (error) { notify(friendlyError(error), { kind: 'error' }); return null; }
}
const editScene = (patch, options = {}) => tryCommit(() => updateSceneFields(app.project, app.activeId, patch), { ui: 'markers', key: `scene-${app.activeId}-${Object.keys(patch)}`, ...options });
const editHotspot = (id, patch, options = {}) => tryCommit(() => updateHotspot(app.project, app.activeId, id, patch), { ui: 'markers', key: `hs-${id}-${Object.keys(patch)}`, ...options });

function undoToast(message) {
  notify(message, { action: { label: 'Undo', run: () => undo() } });
}

// ---------------------------------------------------------------- locations panel
function renderLocations() {
  const panel = $('#locations-panel');
  const scenes = app.project.scenes;
  const index = scenes.findIndex(s => s.id === app.activeId);
  const arrow = (name, label, delta) => h('button', {
    type: 'button', class: 'icon-button small', 'aria-label': label, title: label, disabled: index < 0 || index + delta < 0 || index + delta >= scenes.length,
    onClick: () => tryCommit(() => moveScene(app.project, app.activeId, delta), { ui: 'markers' })
  }, icon(name));
  panel.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Locations'), h('span', { class: 'count' }, String(scenes.length)),
      h('div', { class: 'panel-head-actions' }, arrow('chevron-up', 'Move location up', -1), arrow('chevron-down', 'Move location down', 1))),
    scenes.length
      ? h('ol', { class: 'location-list' }, scenes.map((s, i) => {
        const active = s.id === app.activeId;
        const count = s.hotspots.length;
        return h('li', {}, h('button', {
          type: 'button', class: `location-item${active ? ' current' : ''}`, 'aria-current': active ? 'true' : null,
          onClick: () => setActive(s.id)
        },
        h('span', { class: 'loc-index' }, String(i + 1)),
        h('span', { class: 'loc-main' },
          h('span', { class: 'loc-name' }, s.name),
          h('span', { class: 'loc-meta' }, s.video ? null : h('span', { class: 'warn-text' }, 'No video · '), `${count} hotspot${count === 1 ? '' : 's'}`))));
      }))
      : h('p', { class: 'panel-empty' }, 'No locations yet.'),
    h('div', { class: 'panel-foot' }, h('button', { type: 'button', class: 'button wide', onClick: addLocation }, icon('plus'), 'Add location'))
  );
}

export function addLocation() {
  const next = tryCommit(() => addScene(app.project, `Location ${app.project.scenes.length + 1}`), { ui: 'full' });
  if (!next) return;
  setActive(next.scenes.at(-1).id);
  queueMicrotask(() => { const name = $('#loc-name'); if (name) { name.focus(); name.select(); } });
}

// ---------------------------------------------------------------- inspector
let lastView = null;
function renderInspector() {
  const root = $('#inspector');
  const s = scene();
  const hs = selectedHotspot();
  const view = hs ? `h:${hs.id}` : s ? `s:${s.id}` : 'none';
  const top = view === lastView ? root.scrollTop : 0;
  const focusables = () => [...root.querySelectorAll('input, select, textarea, button, summary')];
  const index = root.contains(document.activeElement) ? focusables().indexOf(document.activeElement) : -1;
  const tag = index >= 0 ? document.activeElement.tagName : '';
  const typeAttr = index >= 0 ? document.activeElement.type : '';
  root.replaceChildren(...(hs ? hotspotView(s, hs) : s ? locationView(s) : emptyView()));
  root.scrollTop = top;
  lastView = view;
  const again = index >= 0 ? focusables()[index] : null;
  if (again && again.tagName === tag && again.type === typeAttr) again.focus({ preventScroll: true });
}

function emptyView() {
  return [h('div', { class: 'inspector-section' },
    h('h2', { class: 'section-title' }, 'Start your tour'),
    h('p', { class: 'hint' }, 'A tour is a set of locations. Each location has one 360° video; hotspots connect locations or explain what is in them.'),
    h('button', { type: 'button', class: 'button primary', onClick: addLocation }, icon('plus'), 'Add first location'))];
}

// ---- location view
function locationView(s) {
  const options = videoOptionsOf(s);
  const position = app.project.scenes.indexOf(s) + 1;
  const meta = h('p', { class: 'meta', id: 'video-meta' }, s.video ? 'Video details appear once it has loaded.' : 'No video attached.');
  const warn = h('div', { id: 'video-warning' });

  queueMicrotask(() => { const info = viewer.videoInfo(); if (info) describeVideo(info); });
  const removeLocation = () => {
    const keep = s.name;
    commit(removeScene(app.project, s.id), { ui: 'full' });
    undoToast(`Deleted “${keep}”`);
  };

  const hotspotRows = s.hotspots.map(hs => h('li', {}, h('button', {
    type: 'button', class: 'hotspot-row', onClick: () => setSelected(hs.id)
  }, icon(hs.type === 'link' ? 'arrow' : 'info'),
  h('span', { class: 'row-label' }, hs.label || 'Untitled'),
  (hs.startTime !== undefined || hs.endTime !== undefined) && h('span', { class: 'row-badge', title: 'Timed hotspot' }, icon('clock', 13)),
  icon('chevron-right', 14))));

  return [
    h('header', { class: 'inspector-head' },
      h('div', {}, h('span', { class: 'eyebrow' }, `Location ${position} of ${app.project.scenes.length}`)),
      h('button', { type: 'button', class: 'icon-button danger', 'aria-label': 'Delete this location', title: 'Delete this location', onClick: removeLocation }, icon('trash'))),
    h('section', { class: 'inspector-section' },
      labelled('Name', textInput(s.name, v => editScene({ name: v }, { ui: 'markers' }), { id: 'loc-name' }))),
    h('section', { class: 'inspector-section' },
      h('h3', { class: 'section-title' }, '360° video'),
      uploadControl({
        kind: 'video', current: s.video, label: 'Upload video', replaceLabel: 'Replace video',
        onDone: path => {
          tryCommit(() => updateSceneFields(app.project, s.id, { video: path }), { ui: 'full' });
          emit('scene', { autoplay: false, changed: true });
        }
      }), meta, warn),
    h('section', { class: 'inspector-section' },
      h('h3', { class: 'section-title' }, 'Playback'),
      switchInput('Repeat video', options.loop, v => editScene({ videoOptions: { ...videoOptionsOf(scene()), loop: v } }, { ui: 'none' })),
      labelled('Speed', selectInput(options.playbackRate, [[0.5, '0.5×'], [0.75, '0.75×'], [1, '1× (normal)'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']],
        v => editScene({ videoOptions: { ...videoOptionsOf(scene()), playbackRate: Number(v) } }, { ui: 'none' }))),
      labelled('Volume', rangeInput(options.volume, { min: 0, max: 1, step: 0.05 },
        v => editScene({ videoOptions: { ...videoOptionsOf(scene()), volume: v } }, { ui: 'none' }), v => `${Math.round(v * 100)}%`))),
    h('section', { class: 'inspector-section' },
      h('h3', { class: 'section-title' }, 'Starting view'),
      h('p', { class: 'hint' }, 'Turn the view to where visitors should look when they arrive, then set it.'),
      h('button', { type: 'button', class: 'button', onClick: () => {
        const { yaw } = viewer.currentAngles();
        if (editScene({ startYaw: yaw }, { ui: 'full' })) notify('Starting direction saved.');
      } }, icon('crosshair'), 'Use current view')),
    h('section', { class: 'inspector-section' },
      h('div', { class: 'section-row' }, h('h3', { class: 'section-title' }, 'Hotspots'), h('span', { class: 'count' }, String(s.hotspots.length))),
      h('div', { class: 'button-pair' },
        h('button', { type: 'button', class: 'button', onClick: () => beginAdd('link') }, icon('arrow'), 'Add link'),
        h('button', { type: 'button', class: 'button', onClick: () => beginAdd('info') }, icon('info'), 'Add info point')),
      s.hotspots.length
        ? h('ul', { class: 'hotspot-list' }, hotspotRows)
        : h('p', { class: 'hint' }, 'None yet. A link takes visitors to another location; an info point opens a text panel. Click a button, then click in the video to place it.'))
  ];
}

function describeVideo({ width, height, duration }) {
  const meta = $('#video-meta'); const warn = $('#video-warning');
  if (!meta || !scene()?.video) return;
  meta.textContent = `${width} × ${height} px · ${formatTime(duration)}`;
  warn.replaceChildren();
  if (width > 4096) warn.append(h('p', { class: 'callout warn' }, icon('alert'),
    h('span', {}, 'Wider than 4096 px. Computers usually cope, but most headsets cannot play this. Use Export → “Headset-friendly” to create a compatible copy.')));
}

function beginAdd(type) {
  const s = scene();
  if (!s?.video) return notify('Upload a 360° video to this location first, then place hotspots on it.', { kind: 'error' });
  if (type === 'link' && app.project.scenes.length < 2) return notify('Add a second location first, so the link has somewhere to lead.', { kind: 'error' });
  viewer.startPlacement(type === 'link' ? 'Click in the video where the link should appear' : 'Click in the video where the info point should appear', angles => {
    const destination = app.project.scenes.find(x => x.id !== s.id);
    const data = type === 'link'
      ? { type, label: destination?.name ?? 'Next location', target: destination?.id ?? '', style: 'hint', color: '#ffffff', hover: 'label', direction: 0, ...angles }
      : { type, label: 'Info point', title: '', body: '', image: '', style: 'tooltip', color: '#25aae1', hover: 'details', ...angles };
    const next = tryCommit(() => addHotspot(app.project, s.id, data), { ui: 'full' });
    if (next) setSelected(next.scenes.find(x => x.id === s.id).hotspots.at(-1).id);
  });
}

// ---- hotspot view
const COMPASS = [315, 0, 45, 270, null, 90, 225, 180, 135];
function directionInput(value, onChange) {
  let current = Math.round(value) % 360;
  const center = h('span', { class: 'dir-center' }, `${current}°`);
  const buttons = new Map();
  const slider = h('input', { type: 'range', min: 0, max: 359, step: 1, value: current, 'aria-label': 'Direction in degrees', onInput: e => apply(Number(e.target.value)) });
  function apply(v) {
    current = v; center.textContent = `${v}°`; slider.value = v;
    for (const [d, b] of buttons) b.setAttribute('aria-checked', String(d === v));
    onChange(v);
  }
  const pad = h('div', { class: 'dir-pad', role: 'radiogroup', 'aria-label': 'Direction' }, COMPASS.map(d => {
    if (d === null) return center;
    const arrow = icon('arrow-up', 18);
    arrow.style.transform = `rotate(${d}deg)`;
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(d === current), 'aria-label': `${d}°`, title: `${d}°`, onClick: () => apply(d) }, arrow);
    buttons.set(d, b);
    return b;
  }));
  return h('div', { class: 'dir-control' }, pad, h('div', { class: 'field' }, h('span', { class: 'hint' }, 'Fine-tune'), slider));
}


function hotspotView(s, hs) {
  const a = hotspotAppearanceOf(hs);
  const id = hs.id;
  const set = (patch, options) => editHotspot(id, patch, options);
  const isLink = hs.type === 'link';

  const removeHotspotNow = () => {
    commit(removeHotspot(app.project, s.id, id), { ui: 'full' });
    setSelected(null);
    undoToast('Hotspot deleted');
  };

  const sample = (current, style) => createMarker({ ...current, style, label: 'Label', title: '', body: '', id: undefined }, { preview: true });
  const refreshPreviews = () => {
    const current = selectedHotspot();
    if (!current) return;
    [...styleGrid.querySelectorAll('.style-preview')].forEach((el, i) => el.replaceChildren(sample(current, STYLE_NAMES[i][0])));
  };
  const styleGrid = h('div', { class: 'style-grid', role: 'radiogroup' }, STYLE_NAMES.map(([value, name]) => h('button', {
    type: 'button', role: 'radio', class: 'style-option', 'aria-checked': String(a.style === value), title: name,
    onClick: () => set({ style: value }, { ui: 'full' })
  }, h('span', { class: 'style-preview' }, sample(hs, value)), h('span', {}, name))));

  const content = isLink
    ? [
      labelled('Label', textInput(hs.label, v => set({ label: v }), { placeholder: 'Shown on hover' })),
      labelled('Leads to', selectInput(hs.target || '', [['', 'Choose a location…', true], ...app.project.scenes.filter(x => x.id !== s.id).map(x => [x.id, x.name])],
        v => set({ target: v }, { ui: 'full' })),
      hs.target ? null : 'Choose where this link leads.')
    ]
    : [
      labelled('Label', textInput(hs.label, v => set({ label: v }), { placeholder: 'Short name for the marker' })),
      labelled('Panel title', textInput(hs.title ?? '', v => set({ title: v }, { ui: 'none' }), { max: 160, placeholder: hs.label || 'Same as the label' }),
        'Optional. Shown at the top of the panel that opens on click.'),
      labelled('Description', areaInput(hs.body ?? '', v => set({ body: v }, { ui: 'none' }))),
      group('Image', uploadControl({
        kind: 'image', current: hs.image, label: 'Add image', replaceLabel: 'Replace image',
        onDone: path => set({ image: path }, { ui: 'full' }),
        extra: hs.image ? h('button', { type: 'button', class: 'button quiet', onClick: () => set({ image: '' }, { ui: 'full' }) }, 'Remove') : null
      }))
    ];

  const hasTiming = hs.startTime !== undefined || hs.endTime !== undefined;
  const timingSummary = hasTiming ? `${hs.startTime !== undefined ? `${hs.startTime.toFixed(1)} s` : 'start'} → ${hs.endTime !== undefined ? `${hs.endTime.toFixed(1)} s` : 'end'}` : 'Always visible';

  const timeField = (label, key) => {
    const input = h('input', {
      type: 'number', min: 0, step: 0.1, value: hs[key] === undefined ? '' : String(Math.round(hs[key] * 10) / 10),
      placeholder: key === 'startTime' ? 'Start' : 'End',
      onChange: () => { if (!set({ [key]: input.value === '' ? undefined : Number(input.value) }, { ui: 'full' })) input.value = hs[key] ?? ''; }
    });
    return h('div', { class: 'time-cell' }, labelled(label, input),
      h('button', { type: 'button', class: 'button small', onClick: () => set({ [key]: Math.round(viewer.currentTime() * 10) / 10 }, { ui: 'full' }) }, icon('clock', 14), 'Use current time'));
  };

  const angleField = (label, key, bound) => {
    const input = h('input', {
      type: 'number', step: 0.1, value: String(Math.round(hs[key] * 1800 / Math.PI) / 10),
      onChange: () => { const v = Number(input.value); if (!Number.isFinite(v) || Math.abs(v) > bound || !set({ [key]: v * Math.PI / 180 }, { ui: 'full' })) { notify(`${label} must be between −${bound}° and ${bound}°.`, { kind: 'error' }); input.value = Math.round(hs[key] * 1800 / Math.PI) / 10; } }
    });
    return labelled(label, input);
  };

  return [
    h('header', { class: 'inspector-head' },
      h('button', { type: 'button', class: 'back-button', onClick: () => setSelected(null) }, icon('chevron-left'), s.name),
      h('button', { type: 'button', class: 'icon-button danger', 'aria-label': 'Delete hotspot', title: 'Delete hotspot', onClick: removeHotspotNow }, icon('trash'))),
    h('div', { class: 'type-line' }, icon(isLink ? 'arrow' : 'info'), h('strong', {}, isLink ? 'Link to another location' : 'Info point')),
    h('p', { class: 'hint pad' }, 'Tip: drag the marker in the view to move it.'),
    h('section', { class: 'inspector-section' }, h('h3', { class: 'section-title' }, 'Content'), content),
    h('section', { class: 'inspector-section' },
      h('h3', { class: 'section-title' }, 'Look'),
      group('Style', styleGrid),
      usesDirection(hs) && group('Arrow direction', directionInput(directionOf(hs), v => { set({ direction: v }); refreshPreviews(); }), '0° points up, 90° right, 180° down, 270° left.'),
      labelled('Size', rangeInput(a.size, { min: 0.5, max: 2.5, step: 0.1 }, v => set({ size: v }), v => `${v.toFixed(1)}×`)),
      group('Colour', colorInput(a.color, v => { set({ color: v }); refreshPreviews(); }))),
    h('section', { class: 'inspector-section' },
      h('h3', { class: 'section-title' }, 'Behaviour'),
      group('On hover show', segmented(hoverOf(hs), isLink ? [['label', 'Label'], ['none', 'Nothing']] : [['details', 'Title & text'], ['label', 'Label'], ['none', 'Nothing']], v => set({ hover: v }))),
      labelled('Idle animation', selectInput(effectOf(hs), [['none', 'None'], ['pulse', 'Pulse'], ['sonar', 'Ping ring'], ['glow', 'Glow']], v => set({ effect: v, pulse: false }))),
      isLink && labelled('Transition', selectInput(hs.transition || 'inherit', [['inherit', 'Tour default'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['cut', 'Instant']], v => set({ transition: v })))),
    h('details', { class: 'inspector-section collapsible', open: hasTiming },
      h('summary', {}, h('span', {}, 'Timing'), h('span', { class: 'summary-value' }, timingSummary), icon('chevron-down', 14)),
      h('p', { class: 'hint' }, 'Show this hotspot only during part of the video. Scrub the video to a moment, then press “Use current time”. Leave both empty to show it throughout.'),
      h('div', { class: 'two-up' }, timeField('Show at (s)', 'startTime'), timeField('Hide at (s)', 'endTime')),
      hasTiming && h('button', { type: 'button', class: 'button quiet', onClick: () => set({ startTime: undefined, endTime: undefined }, { ui: 'full' }) }, 'Show throughout')),
    h('details', { class: 'inspector-section collapsible' },
      h('summary', {}, h('span', {}, 'Position'), h('span', { class: 'summary-value' }, `${Math.round(hs.yaw * 180 / Math.PI)}°, ${Math.round(hs.pitch * 180 / Math.PI)}°`), icon('chevron-down', 14)),
      h('div', { class: 'two-up' }, angleField('Yaw (°)', 'yaw', 360), angleField('Pitch (°)', 'pitch', 90)),
      h('button', { type: 'button', class: 'button', onClick: () => set({ ...viewer.currentAngles() }, { ui: 'full' }) }, icon('crosshair'), 'Move to centre of view'))
  ];
}

// ---------------------------------------------------------------- top bar
function renderTopbar() {
  const state = app.saveState;
  const label = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Save failed · retry' }[state];
  const save = $('#save-state');
  save.textContent = label;
  save.dataset.state = state;
  $('#undo-button').disabled = !canUndo();
  $('#redo-button').disabled = !canRedo();
  const title = $('#tour-title');
  if (document.activeElement !== title) title.value = app.project.title;
  $('#edit-button').setAttribute('aria-selected', String(app.mode === 'edit'));
  $('#preview-button').setAttribute('aria-selected', String(app.mode === 'preview'));
  $('#app').dataset.mode = app.mode;
}

export function initEditor() {
  for (const el of document.querySelectorAll('[data-icon]')) if (!el.querySelector('.icon')) el.prepend(icon(el.dataset.icon, Number(el.dataset.size) || 16));
  $('#edit-button').addEventListener('click', () => setMode('edit'));
  $('#preview-button').addEventListener('click', () => setMode('preview'));
  $('#undo-button').addEventListener('click', undo);
  $('#redo-button').addEventListener('click', redo);
  $('#save-state').addEventListener('click', () => { if (app.saveState === 'failed') saveNow(); });
  $('#tour-title').addEventListener('input', event => tryCommit(() => ({ ...structuredClone(app.project), title: event.target.value }), { ui: 'none', key: 'title' }));
  $('#empty-add').addEventListener('click', addLocation);

  on('project', ({ ui }) => {
    if (ui === 'full') { renderLocations(); renderInspector(); } else if (ui !== 'none') renderLocations();
    renderTopbar();
  });
  on('scene', () => { renderLocations(); renderInspector(); });
  on('selection', () => renderInspector());
  on('mode', renderTopbar);
  on('save', renderTopbar);
  on('save-error', ({ message }) => notify(`Could not save: ${message}`, { kind: 'error' }));
  on('video-meta', describeVideo);
  renderLocations(); renderInspector(); renderTopbar();
}
