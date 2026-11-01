// The stage: 360° video, hotspot markers (HTML on desktop, 3D in a headset), transitions, info card, transport.
import 'aframe';
import { $, h, formatTime } from './dom.js';
import { icon, setIcon } from './icons.js';
import { app, scene, hotspotById, on, emit, commit, setActive, setSelected } from './state.js';
import {
  presentationOf, videoOptionsOf, hotspotAppearanceOf, hotspotVisibleAt, hoverOf, effectOf, inkFor,
  pointFromAngles, anglesFromPoint, updateHotspot, directionOf
} from './project.js';
import { createMarker, fitExpand } from './markers.js';
import { spritesFor, PX } from './raster.js';
import { mediaUrl } from './media.js';
import { notify } from './toast.js';

const THREE = AFRAME.THREE;
const world = $('#world');
const video = $('#tour-video');
const sphere = $('#video-sphere');
const cameraEl = $('#camera');
const markers3d = $('#hotspots');
const overlay = $('#desktop-hotspots');
const stage = $('#stage');
const worldRoot = $('#world-root');


let infoId = null;
let placing = null;          // { onPick }
let transitioning = false;
let waitTimer;
let userPaused = false;
let drag = null;
let suppressClick = false;
let pointerDown = null;
let orientFrames = 0;        // >0: re-aim the world at the headset's current heading after this many VR frames

// A 360° video has no depth, so the picture and the markers must stay centred on the viewer's head.
// A headset reports eye height above the floor (about 1.6 m); markers 5 m away that stay centred on the
// floor would otherwise appear roughly 18° too low. The root also carries the "starting view" in VR,
// where the headset (not the mouse) decides which way you are looking.
AFRAME.registerComponent('head-follow', {
  init() { this.head = new THREE.Vector3(); this.dir = new THREE.Vector3(); },
  tick() {
    const camera = this.el.sceneEl.camera;
    if (!camera) return;
    camera.getWorldPosition(this.head);
    this.el.object3D.position.copy(this.head);
    if (orientFrames > 0 && world.renderer?.xr.isPresenting && --orientFrames === 0) {
      camera.getWorldDirection(this.dir);
      const headYaw = Math.atan2(this.dir.x, -this.dir.z);
      // a world direction at yaw θ is shown at yaw θ − rotation, so this puts the start direction straight ahead
      this.el.object3D.rotation.y = (scene()?.startYaw ?? 0) - headYaw;
    }
  }
});

// ---------------------------------------------------------------- presentation
export function applyPresentation() {
  const p = presentationOf(app.project);
  cameraEl.setAttribute('look-controls', 'reverseMouseDrag', p.dragMode === 'grab');
  cameraEl.setAttribute('camera', 'fov', p.fieldOfView);
  if (world.renderer) {
    world.renderer.xr.setFoveation(p.vrFoveation);
    world.renderer.setPixelRatio(Math.min(3, window.devicePixelRatio * p.renderScale));
  }
}

function applyVideoOptions() {
  const v = videoOptionsOf(scene() || {});
  video.loop = v.loop;
  video.playbackRate = v.playbackRate;
  video.volume = v.volume;
  refreshTransport();
}

// ---------------------------------------------------------------- camera
function syncCamera() {
  const controls = cameraEl.components['look-controls'];
  if (controls?.yawObject && !world.is('vr-mode')) {
    cameraEl.object3D.rotation.set(controls.pitchObject.rotation.x, controls.yawObject.rotation.y, 0, 'YXZ');
  }
}
export function currentAngles() {
  syncCamera();
  const camera = cameraEl.getObject3D('camera');
  if (!camera) return { yaw: 0, pitch: 0 };
  camera.updateWorldMatrix(true, false);
  const d = camera.getWorldDirection(new THREE.Vector3());
  return anglesFromPoint({ x: d.x, y: d.y, z: d.z });
}
function anglesAtClient(clientX, clientY) {
  const rect = world.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
  syncCamera();
  const camera = cameraEl.getObject3D('camera');
  camera.updateWorldMatrix(true, false);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const d = ray.ray.direction;
  return anglesFromPoint({ x: d.x, y: d.y, z: d.z });
}
function setStartingView() {
  const controls = cameraEl.components['look-controls'];
  if (!controls?.yawObject || !scene()) return;
  controls.yawObject.rotation.y = -scene().startYaw;
  controls.pitchObject.rotation.x = 0;
  cameraEl.object3D.rotation.set(0, controls.yawObject.rotation.y, 0, 'YXZ');
}
export const currentTime = () => video.currentTime;
export const videoInfo = () => (video.readyState >= 1 && video.videoWidth ? { width: video.videoWidth, height: video.videoHeight, duration: video.duration } : null);

// ---------------------------------------------------------------- scene loading
export function loadScene(autoplay = false) {
  clearTimeout(waitTimer);
  video.pause();
  closeInfo();
  cancelPlacement();
  const s = scene();
  userPaused = false;
  updateChip();
  $('#empty-state').hidden = app.project.scenes.length > 0;
  hideNotice();
  sphere.setAttribute('visible', false);
  if (!s?.video) {
    video.removeAttribute('src'); video.load();
    if (s) showNotice(app.mode === 'edit' ? 'This location has no video yet. Upload one in the panel on the right.' : 'This location has no video yet.', 'info');
    renderMarkers(); refreshTransport();
    return;
  }
  video.src = mediaUrl(s.video);
  applyVideoOptions();
  video.load();
  waitTimer = setTimeout(() => {
    if (video.readyState === 0 && scene()?.video) showNotice('The video is taking a while to load. If it never starts, the file may be too large or in a format this browser cannot decode.', 'warn');
  }, 12000);
  setStartingView();
  if (world.renderer?.xr.isPresenting) orientFrames = 3;
  sphere.setAttribute('visible', true);
  renderMarkers(); refreshTransport();
  if (autoplay) play();
}

export async function play() {
  if (!scene()?.video) return;
  try { await video.play(); userPaused = false; } catch { /* autoplay blocked: the start overlay offers a click */ }
  refreshTransport();
}
export function togglePlay() {
  if (video.paused) play();
  else { userPaused = true; video.pause(); }
  refreshTransport();
}

function showNotice(text, kind) { const el = $('#notice'); el.textContent = text; el.dataset.kind = kind; el.hidden = false; }
function hideNotice() { $('#notice').hidden = true; }

function updateChip() {
  const s = scene();
  const index = s ? app.project.scenes.indexOf(s) + 1 : 0;
  $('#chip-index').textContent = s ? `${index} / ${app.project.scenes.length}` : '';
  $('#chip-name').textContent = s ? s.name : '';
  $('#chip-tour').textContent = app.project.title || '';
  $('#location-chip').hidden = !s;
}

// ---------------------------------------------------------------- transitions
function cover(from, to, duration) {
  const fade = $('#scene-fade');
  const vr = $('#vr-transition');
  vr.setAttribute('visible', world.is('vr-mode'));
  return new Promise(resolve => {
    if (!duration) { fade.style.opacity = String(to); resolve(); return; }
    const start = performance.now();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      fade.style.opacity = String(to);
      const mesh = vr.getObject3D('mesh');
      if (mesh) mesh.material.opacity = to;
      resolve();
    };
    setTimeout(finish, duration + 60); // animation frames can stall while a big video decodes
    const tick = now => {
      if (settled) return;
      const t = Math.min(1, (now - start) / duration);
      const opacity = from + (to - from) * t;
      fade.style.opacity = String(opacity);
      const mesh = vr.getObject3D('mesh');
      if (mesh) mesh.material.opacity = opacity;
      if (t < 1) requestAnimationFrame(tick); else finish();
    };
    requestAnimationFrame(tick);
  });
}

export async function go(target, override = 'inherit') {
  if (transitioning || target === app.activeId || !app.project.scenes.some(s => s.id === target)) return;
  const { transition, transitionMs } = presentationOf(app.project);
  const style = override && override !== 'inherit' ? override : transition;
  if (style === 'cut' || transitionMs === 0) { setActive(target, { autoplay: true }); return; }
  transitioning = true;
  try {
    if (style === 'zoom' && !world.is('vr-mode')) stage.classList.add('zooming');
    await cover(0, 1, transitionMs / 2);
    setActive(target, { autoplay: true });
    if (scene()?.video && video.readyState < 2) {
      await Promise.race([
        new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true })),
        new Promise(resolve => setTimeout(resolve, 800))
      ]);
    }
    await cover(1, 0, transitionMs / 2);
  } finally {
    stage.classList.remove('zooming');
    $('#vr-transition').setAttribute('visible', false);
    $('#scene-fade').style.opacity = '0';
    transitioning = false;
  }
}

// ---------------------------------------------------------------- markers
export function renderMarkers() {
  markers3d.replaceChildren();
  overlay.replaceChildren();
  for (const st of sprites.values()) { st.data?.idle.texture.dispose(); st.data?.hover.texture.dispose(); }
  sprites.clear();
  for (const hs of scene()?.hotspots ?? []) {
    markers3d.append(build3D(hs));
    overlay.append(buildDom(hs));
  }
  syncVisibility();
  updateOverlay();
  refreshPointers();
  const fit = () => { for (const marker of overlay.children) fitExpand(marker); };
  fit();
  document.fonts?.ready.then(fit);
}

function buildDom(hs) {
  const marker = createMarker(hs);
  if (hs.id === app.selectedId) marker.classList.add('is-selected');
  marker.addEventListener('click', () => { if (suppressClick) return; activate(hs.id); });
  marker.addEventListener('pointerdown', event => beginDrag(event, hs.id));
  marker.addEventListener('pointermove', event => moveDrag(event, hs.id));
  marker.addEventListener('pointerup', event => endDrag(event, hs.id));
  marker.addEventListener('pointercancel', event => endDrag(event, hs.id));
  return marker;
}

// Dragging a marker in Edit mode repositions it.
function beginDrag(event, id) {
  if (app.mode !== 'edit' || event.button !== 0) return;
  drag = { id, x: event.clientX, y: event.clientY, moved: false };
  event.currentTarget.setPointerCapture(event.pointerId);
}
function moveDrag(event, id) {
  if (!drag || drag.id !== id) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
  if (!drag.moved) { drag.moved = true; event.currentTarget.classList.add('dragging'); setSelected(id); }
  const angles = anglesAtClient(event.clientX, event.clientY);
  const entity = [...markers3d.children].find(el => el.dataset.hotspotId === id);
  if (entity) { const p = pointFromAngles(angles.yaw, angles.pitch, 5); entity.object3D.position.set(p.x, p.y, p.z); entity.object3D.lookAt(0, 0, 0); }
  try { commit(updateHotspot(app.project, app.activeId, id, angles), { ui: 'none', key: `move-${id}` }); } catch { /* clamped by validation */ }
  updateOverlay();
}
function endDrag(event, id) {
  if (!drag || drag.id !== id) return;
  const finished = drag; drag = null;
  event.currentTarget.classList.remove('dragging');
  if (finished.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    emit('project', { ui: 'full' });
  }
}

function activate(id) {
  const hs = hotspotById(id);
  if (!hs) return;
  if (app.mode === 'edit') { setSelected(id); return; }
  if (world.is('vr-mode') && hs.type === 'info') return;   // in a headset an info marker is its hover card; there is no separate panel
  if (hs.type === 'link') {
    if (hs.target) go(hs.target, hs.transition);
    else notify('This link has no destination yet.', { kind: 'error' });
  } else if (infoId === id && !$('#info-card').hidden) closeInfo();
  else showInfo(hs);
}

// ---- 3D markers (visible only in a headset)
function trim(text, max) { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
// Headset markers are drawn on a canvas, one look per style, matching the HTML markers as closely as a texture can.
function stroke(g, color, width, draw) { g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); draw(); g.stroke(); }
function arrowGlyph(g, cx, cy, size, rotation, color, width) {
  g.save(); g.translate(cx, cy); g.rotate(rotation);
  stroke(g, color, width, () => { g.moveTo(0, size); g.lineTo(0, -size); g.moveTo(-size * 0.55, -size * 0.35); g.lineTo(0, -size); g.lineTo(size * 0.55, -size * 0.35); });
  g.restore();
}
function infoGlyph(g, cx, cy, size, color, width) {
  stroke(g, color, width, () => { g.moveTo(cx, cy - size * 0.15); g.lineTo(cx, cy + size * 0.75); });
  g.fillStyle = color; g.beginPath(); g.arc(cx, cy - size * 0.75, width * 0.62, 0, Math.PI * 2); g.fill();
}
function roundedRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function draw3D(hs, a) {
  const caption = trim(hs.label || (hs.type === 'link' ? 'Go there' : 'More info'), 24);
  const ink = inkFor(a.color);
  const isLink = hs.type === 'link';
  const rot = directionOf(hs) * Math.PI / 180;
  const wide = ['pill', 'bubble', 'reveal'].includes(a.style);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = wide ? 256 : 1024;
  const g = canvas.getContext('2d');
  const C = 512;
  const glyphAt = (cx, cy, size, color, width) => (isLink ? arrowGlyph(g, cx, cy, size, rot, color, width) : infoGlyph(g, cx, cy, size, color, width));
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (wide) {
    g.fillStyle = a.color; roundedRect(g, 10, 10, 1004, 220, a.style === 'reveal' ? 56 : 110); g.fill();
    if (a.style === 'bubble') { g.beginPath(); g.moveTo(480, 228); g.lineTo(512, 256); g.lineTo(544, 228); g.fill(); }
    g.fillStyle = ink; g.font = '600 84px Arial, sans-serif';
    if (a.style === 'reveal') g.fillText(caption, 512, 122, 900);
    else { glyphAt(130, 120, 52, ink, 16); g.fillText(caption, 600, 122, 760); }
  } else if (a.style === 'plus') {
    g.fillStyle = 'rgba(8,12,16,.45)'; g.beginPath(); g.arc(C, C, 420, 0, 7); g.fill();
    stroke(g, a.color, 64, () => g.arc(C, C, 400, 0, 7));
    stroke(g, a.color, 60, () => { g.moveTo(C, 330); g.lineTo(C, 694); g.moveTo(330, C); g.lineTo(694, C); });
  } else if (a.style === 'sonar') {
    for (const [r, o] of [[420, 0.35], [300, 0.6]]) stroke(g, `rgba(255,255,255,${o})`, 24, () => g.arc(C, C, r, 0, 7));
    g.fillStyle = a.color; g.beginPath(); g.arc(C, C, 150, 0, 7); g.fill(); stroke(g, '#ffffff', 44, () => g.arc(C, C, 150, 0, 7));
  } else if (a.style === 'expand') {
    g.fillStyle = '#ffffff'; roundedRect(g, 130, 130, 764, 764, 220); g.fill();
    glyphAt(C, C + (isLink ? 0 : 20), 250, '#0b1118', 70);
  } else if (a.style === 'hint') {
    if (isLink) { arrowGlyph(g, C, C, 330, rot, 'rgba(8,12,16,.7)', 190); arrowGlyph(g, C, C, 330, rot, a.color, 120); }
    else { stroke(g, a.color, 90, () => g.arc(C, C, 380, 0, 7)); infoGlyph(g, C, C, 230, a.color, 90); }
  } else if (a.style === 'dot') {
    g.fillStyle = a.color; g.beginPath(); g.arc(C, C, 200, 0, 7); g.fill(); stroke(g, '#ffffff', 64, () => g.arc(C, C, 200, 0, 7));
  } else if (a.style === 'ring') {
    stroke(g, a.color, 90, () => g.arc(C, C, 380, 0, 7)); stroke(g, '#ffffff', 34, () => g.arc(C, C, 260, 0, 7));
  } else if (a.style === 'arrow') {
    g.fillStyle = '#ffffff'; g.save(); g.translate(C, C); g.rotate(rot);
    g.beginPath(); g.moveTo(0, -470); g.lineTo(170, -300); g.lineTo(-170, -300); g.closePath(); g.fill(); g.restore();
    g.fillStyle = a.color; g.beginPath(); g.arc(C, C, 300, 0, 7); g.fill(); stroke(g, '#ffffff', 44, () => g.arc(C, C, 300, 0, 7));
    if (!isLink) infoGlyph(g, C, C, 150, ink, 56);
  } else { // tooltip: coloured disc with a white rim
    g.fillStyle = a.color; g.beginPath(); g.arc(C, C, 400, 0, 7); g.fill(); stroke(g, '#ffffff', 56, () => g.arc(C, C, 400, 0, 7));
    glyphAt(C, C + (isLink ? 0 : 20), 230, ink, 64);
  }
  return canvas;
}
function textured(plane, canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const apply = () => { const mesh = plane.getObject3D('mesh'); if (mesh) { mesh.material.map = texture; mesh.material.needsUpdate = true; refreshPointers(); } };
  plane.addEventListener('object3dset', apply);
  plane.addEventListener('loaded', apply);
}
// ---- headset markers: the HTML markers, rendered to sprite sheets by raster.js and played back here, so every style
// idles and reacts to hover exactly as it does on the desktop.
const sprites = new Map();       // hotspot id -> playback state
let xrCapable = false;
navigator.xr?.isSessionSupported?.('immersive-vr').then(ok => { xrCapable = ok; requestAllSprites(); }).catch(() => {});
const rasterWanted = () => world.is('vr-mode') || (app.mode !== 'edit' && xrCapable);

function requestSprites(st) {
  if (st.requested) return;
  st.requested = true;
  spritesFor(st.hs).then(data => attachSprites(st, data)).catch(error => { console.warn('Headset marker fallback:', error); useFallback(st); });
}
function requestAllSprites() { if (rasterWanted()) for (const st of sprites.values()) requestSprites(st); }

function attachSprites(st, data) {
  if (sprites.get(st.hs.id) !== st) return;           // the location changed while this was rendering
  const texture = set => {
    const t = new THREE.CanvasTexture(set.canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.repeat.set(1 / set.cols, 1 / set.rows);
    return { ...set, texture: t };
  };
  st.data = { idle: texture(data.idle), hover: texture(data.hover), hit: data.hit };
  st.ready = true;
  st.art.setAttribute('visible', true);
  sizeHit(st);
  syncVisibility();
}
function useFallback(st) {
  const a = hotspotAppearanceOf(st.hs);
  const labelled = ['pill', 'bubble', 'reveal'].includes(a.style);
  const width = labelled ? Math.min(4.2, Math.max(2.2, (st.hs.label || '').length * 0.14 + 1.3)) : 0.95;
  textured(st.art, draw3D(st.hs, a));
  st.art.object3D.scale.set(width * a.size, (labelled ? width / 4 : 0.95) * a.size, 1);
  st.art.setAttribute('visible', true);
  st.hit.object3D.scale.copy(st.art.object3D.scale);
  st.ready = true;
  syncVisibility();
}
// The pointer target follows the marker's real box (it grows with the expanding tile) plus some slack for a shaky hand.
function sizeHit(st) {
  if (!st.data) return;
  const r = st.hovered ? st.data.hit.hover : st.data.hit.idle;
  st.hit.object3D.scale.set((r.r - r.l + 20) * PX, (r.b - r.t + 20) * PX, 1);
  st.hit.object3D.position.set(((r.l + r.r) / 2) * PX, -((r.t + r.b) / 2) * PX, 0.03);
}
function playSprite(st, time, dt) {
  const d = st.data;
  if (!d || !st.entity.object3D.visible) return;
  const mesh = st.art.getObject3D('mesh');
  if (!mesh) return;
  const step = dt / 1000 / d.hover.duration;
  st.progress = Math.min(1, Math.max(0, st.progress + (st.hovered ? step : -step)));
  const hovering = st.hovered || st.progress > 0;
  const set = hovering ? d.hover : d.idle;
  const frame = hovering ? Math.round(st.progress * (set.count - 1)) : (set.count > 1 ? Math.floor(time / 1000 * set.fps) % set.count : 0);
  if (set === st.set && frame === st.frame) return;
  if (set !== st.set) {
    mesh.material.map = set.texture; mesh.material.needsUpdate = true;
    mesh.renderOrder = hovering ? 10 : 1;
    st.art.object3D.scale.set(set.cellW * PX, set.cellH * PX, 1);
    st.art.object3D.position.set((set.cellW / 2 - set.ox) * PX, -(set.cellH / 2 - set.oy) * PX, 0);
    st.set = set;
  }
  st.frame = frame;
  set.texture.offset.set((frame % set.cols) / set.cols, 1 - (Math.floor(frame / set.cols) + 1) / set.rows);
}
// Hover is read from what each pointer (gaze and both controllers) is aiming at right now. A-Frame's own enter/leave
// events are not used because it fires a "leave" straight after a click even though the ray is still on the marker.
let pointers = null;
function updateHover() {
  pointers ??= [...document.querySelectorAll('[raycaster]')];
  const over = new Set();
  for (const pointer of pointers) {
    const el = pointer.components.raycaster?.intersections?.[0]?.object?.el;
    if (el?.classList.contains('hit')) over.add(el.parentEl.dataset.hotspotId);
  }
  for (const st of sprites.values()) {
    const now = over.has(st.hs.id);
    if (now !== st.hovered) { st.hovered = now; sizeHit(st); }
  }
}
AFRAME.registerComponent('sprite-ticker', { tick(time, dt) { updateHover(); for (const st of sprites.values()) playSprite(st, time, dt); } });

function build3D(hs) {
  const entity = document.createElement('a-entity');
  entity.classList.add('tour-hotspot');
  entity.dataset.hotspotId = hs.id;
  const p = pointFromAngles(hs.yaw, hs.pitch, 5);
  entity.object3D.position.set(p.x, p.y, p.z);
  entity.object3D.lookAt(0, 0, 0);
  const art = document.createElement('a-plane');
  art.classList.add('hotspot-art');
  art.setAttribute('visible', false);
  art.setAttribute('material', { shader: 'flat', side: 'front', transparent: true, depthWrite: false });
  const hit = document.createElement('a-plane');      // invisible but pickable; the artwork itself is not
  hit.classList.add('hit');
  hit.setAttribute('material', { shader: 'flat', side: 'double', transparent: true, opacity: 0, depthWrite: false });
  hit.object3D.position.z = 0.03;
  hit.object3D.scale.setScalar(0.001);
  entity.append(art, hit);
  const st = { hs, entity, art, hit, data: null, set: null, frame: -1, progress: 0, hovered: false, requested: false, ready: false };
  sprites.set(hs.id, st);
  hit.addEventListener('click', event => { event.stopPropagation(); activate(hs.id); });
  if (rasterWanted()) requestSprites(st);
  return entity;
}
function refreshPointers() {
  const run = () => { for (const pointer of document.querySelectorAll('[raycaster], #world')) pointer.components.raycaster?.refreshObjects(); };
  run();
  for (const delay of [0, 80, 350]) setTimeout(run, delay);
}

// ---- visibility by video time, and projection of markers onto the screen
function syncVisibility() {
  const inVR = world.is('vr-mode');
  requestAllSprites();
  for (const hs of scene()?.hotspots ?? []) {
    const visible = hotspotVisibleAt(hs, video.currentTime);
    const dom = [...overlay.children].find(el => el.dataset.hotspotId === hs.id);
    const ent = [...markers3d.children].find(el => el.dataset.hotspotId === hs.id);
    if (dom) {
      dom.hidden = app.mode === 'edit' ? false : !visible;
      dom.classList.toggle('off-time', app.mode === 'edit' && !visible);
    }
    if (ent) {
      const shown = visible && inVR;
      if (ent.object3D.visible !== shown) ent.setAttribute('visible', shown);
      const st = sprites.get(hs.id);
      ent.querySelector('.hit')?.classList.toggle('clickable', shown && !!st?.ready);
      if (!shown && st) { st.hovered = false; st.progress = 0; }   // a marker that disappears must not stay in its hover state
    }
    if (!visible && app.mode !== 'edit' && infoId === hs.id) closeInfo();
  }
  refreshPointers();
}

function projection(id) {
  const ent = [...markers3d.children].find(el => el.dataset.hotspotId === id);
  const camera = cameraEl.getObject3D('camera');
  if (!ent || !camera) return null;
  syncCamera();
  camera.updateWorldMatrix(true, false);
  const clip = ent.object3D.getWorldPosition(new THREE.Vector3()).project(camera);
  const rect = stage.getBoundingClientRect();
  return {
    x: (clip.x + 1) * rect.width / 2, y: (1 - clip.y) * rect.height / 2,
    inView: clip.z >= -1 && clip.z <= 1 && Math.abs(clip.x) <= 1.08 && Math.abs(clip.y) <= 1.08
  };
}
export function updateOverlay() {
  if (world.is('vr-mode')) return;
  for (const marker of overlay.children) {
    const point = projection(marker.dataset.hotspotId);
    if (!point?.inView) { marker.style.visibility = 'hidden'; continue; }
    marker.style.visibility = 'visible';
    marker.style.left = `${point.x}px`; marker.style.top = `${point.y}px`;
  }
  updateInfoPosition();
}
(function loop() { updateOverlay(); requestAnimationFrame(loop); })();

// ---------------------------------------------------------------- info card
function showInfo(hs) {
  infoId = hs.id;
  $('#info-title').textContent = hs.title || hs.label || 'Details';
  $('#info-body').textContent = hs.body || '';
  $('#info-body').hidden = !hs.body;
  const image = $('#info-image');
  image.hidden = !hs.image;
  if (hs.image) image.src = mediaUrl(hs.image); else image.removeAttribute('src');
  $('#info-card').hidden = false;
  updateInfoPosition();
  $('#info-close').focus({ preventScroll: true });
}
export function closeInfo() {
  const wasOpen = infoId !== null;
  infoId = null;
  $('#info-card').hidden = true;
  if (wasOpen) overlay.querySelector('.active')?.classList.remove('active');
}
function updateInfoPosition() {
  const card = $('#info-card');
  if (!infoId || card.hidden) return;
  for (const marker of overlay.children) marker.classList.toggle('active', marker.dataset.hotspotId === infoId);
  const point = projection(infoId);
  if (!point) return;
  const shell = stage.getBoundingClientRect();
  const { width, height } = card.getBoundingClientRect();
  const fitsRight = point.x + 44 + width + 12 < shell.width;
  card.style.left = `${Math.max(12, Math.min(shell.width - width - 12, fitsRight ? point.x + 44 : point.x - 44 - width))}px`;
  card.style.top = `${Math.max(12, Math.min(shell.height - height - 12, point.y - height / 2))}px`;
  card.style.visibility = point.inView ? 'visible' : 'hidden';
}
// ---------------------------------------------------------------- placement (click in the view to pick a direction)
export function startPlacement(text, onPick) {
  placing = { onPick };
  stage.dataset.placing = '1';
  $('#banner-text').textContent = text;
  $('#banner').hidden = false;
}
export function cancelPlacement() {
  if (!placing) return;
  placing = null;
  delete stage.dataset.placing;
  $('#banner').hidden = true;
}
export const isPlacing = () => placing !== null;

// ---------------------------------------------------------------- transport + overlay controls
function refreshTransport() {
  const has = !!scene()?.video;
  const tPlay = $('#t-play'), tMute = $('#t-mute'), tSeek = $('#t-seek');
  tPlay.disabled = tMute.disabled = tSeek.disabled = !has;
  setIcon(tPlay, video.paused ? 'play' : 'pause');
  tPlay.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
  setIcon(tMute, video.muted ? 'volume-off' : 'volume');
  tMute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  $('#t-locations').hidden = app.mode === 'edit' || app.project.scenes.length < 2;
  $('#start-overlay').hidden = !(app.mode !== 'edit' && has && video.paused && !userPaused && !transitioning);
  updateClock();
}
function updateClock() {
  const d = video.duration;
  $('#t-time').textContent = `${formatTime(video.currentTime)} / ${formatTime(d)}`;
  if (Number.isFinite(d) && d > 0 && document.activeElement !== $('#t-seek')) $('#t-seek').value = Math.round(video.currentTime / d * 1000);
}
function buildLocationsMenu() {
  const menu = $('#locations-menu');
  menu.replaceChildren(...app.project.scenes.map((s, i) => h('button', {
    type: 'button', role: 'menuitem', class: `menu-item${s.id === app.activeId ? ' current' : ''}`,
    onClick: () => { menu.hidden = true; $('#t-locations').setAttribute('aria-expanded', 'false'); go(s.id); }
  }, h('span', { class: 'menu-index' }, String(i + 1)), s.name)));
}

function wireControls() {
  for (const el of document.querySelectorAll('[data-icon]')) el.prepend(icon(el.dataset.icon, Number(el.dataset.size) || 16));
  $('#t-play').addEventListener('click', togglePlay);
  $('#start-overlay').addEventListener('click', () => { userPaused = false; play(); });
  $('#t-seek').addEventListener('input', event => { if (Number.isFinite(video.duration)) video.currentTime = Number(event.target.value) / 1000 * video.duration; });
  $('#t-mute').addEventListener('click', () => { video.muted = !video.muted; refreshTransport(); });
  $('#t-full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.(); });
  $('#t-locations').addEventListener('click', event => {
    const menu = $('#locations-menu');
    buildLocationsMenu();
    menu.hidden = !menu.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
  });
  $('#info-close').addEventListener('click', closeInfo);
  $('#banner-cancel').addEventListener('click', cancelPlacement);

  video.addEventListener('timeupdate', () => { updateClock(); syncVisibility(); });
  video.addEventListener('seeked', () => { updateClock(); syncVisibility(); });
  video.addEventListener('durationchange', updateClock);
  video.addEventListener('play', refreshTransport);
  video.addEventListener('pause', refreshTransport);
  video.addEventListener('loadeddata', () => { clearTimeout(waitTimer); hideNotice(); });
  video.addEventListener('loadedmetadata', () => {
    syncVisibility();
    emit('video-meta', { width: video.videoWidth, height: video.videoHeight, duration: video.duration });
    if (video.videoHeight && Math.abs(video.videoWidth / video.videoHeight - 2) > 0.1) {
      showNotice('This video is not 2:1, so it may not be an equirectangular 360° recording and could look stretched.', 'warn');
    }
  });
  video.addEventListener('error', () => {
    clearTimeout(waitTimer);
    if (!video.getAttribute('src')) return;
    showNotice('This video could not be played. Use an H.264 MP4 or a WebM file; very high resolutions may also fail on some computers.', 'error');
  });

  // click in the view = pick a direction while placing
  const canvas = () => world.canvas;
  stage.addEventListener('pointerdown', event => { pointerDown = { x: event.clientX, y: event.clientY }; }, true);
  stage.addEventListener('click', event => {
    if (!placing || event.target !== canvas()) return;
    if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) return; // that was a drag
    const { onPick } = placing;
    cancelPlacement();
    onPick(anglesAtClient(event.clientX, event.clientY));
  });
  stage.addEventListener('wheel', event => {
    if (event.target !== canvas() || world.is('vr-mode')) return;
    event.preventDefault();
    const fov = cameraEl.getAttribute('camera').fov;
    cameraEl.setAttribute('camera', 'fov', Math.max(35, Math.min(100, fov + Math.sign(event.deltaY) * 4)));
  }, { passive: false });
  document.addEventListener('click', event => {
    const menu = $('#locations-menu');
    if (!menu.hidden && !event.target.closest('#locations-menu, #t-locations')) menu.hidden = true;
  });

  world.addEventListener('enter-vr', () => { orientFrames = 3; $('#gaze').setAttribute('visible', true); overlay.hidden = true; closeInfo(); syncVisibility(); });
  world.addEventListener('exit-vr', () => { orientFrames = 0; worldRoot.object3D.rotation.y = 0; $('#gaze').setAttribute('visible', false); overlay.hidden = false; closeInfo(); syncVisibility(); });
  window.addEventListener('resize', updateOverlay);
}

export function initViewer() {
  wireControls();
  const ready = () => { applyPresentation(); };
  if (world.hasLoaded) ready(); else world.addEventListener('loaded', ready, { once: true });

  on('scene', ({ autoplay }) => { if (world.hasLoaded) loadScene(autoplay); else world.addEventListener('loaded', () => loadScene(autoplay), { once: true }); });
  on('project', ({ ui }) => {
    updateChip();
    applyPresentation();
    applyVideoOptions();
    if (ui !== 'none') renderMarkers();
    $('#empty-state').hidden = app.project.scenes.length > 0;
  });
  on('selection', () => {
    for (const marker of overlay.children) marker.classList.toggle('is-selected', marker.dataset.hotspotId === app.selectedId);
  });
  on('mode', () => {
    stage.dataset.mode = app.mode;
    closeInfo(); cancelPlacement();
    syncVisibility(); refreshTransport(); updateChip();
    if (app.mode === 'edit' && !scene()?.video) loadScene(false);
  });
  stage.dataset.mode = app.mode;
}
