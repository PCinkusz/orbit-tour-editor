export const freshProject = () => ({ version: 1, title: 'Untitled tour', scenes: [] });
export const presentationOf = project => ({
  transition: 'fade', transitionMs: 450, dragMode: 'grab', fieldOfView: 70,
  renderScale: 1, vrFoveation: 0.5, ...project.presentation
});
export const videoOptionsOf = scene => ({ loop: true, playbackRate: 1, volume: 1, ...scene.videoOptions });
export const hotspotAppearanceOf = hotspot => ({ style: 'pill', size: 1, color: hotspot.type === 'info' ? '#f5f3e9' : '#d5f07a', pulse: false, ...hotspot });
export const HOTSPOT_STYLES = ['tooltip', 'plus', 'sonar', 'expand', 'reveal', 'hint', 'bubble', 'pill', 'dot', 'ring', 'arrow'];
/** Arrow direction in degrees clockwise from up. Older tours had right-pointing arrows, so 90 is the fallback. */
export const directionOf = hotspot => hotspot.direction ?? 90;
/** Whether the marker draws something that points somewhere, so the direction setting applies. */
export function usesDirection(hotspot) {
  const style = hotspotAppearanceOf(hotspot).style;
  if (['plus', 'sonar', 'dot', 'ring', 'reveal'].includes(style)) return false;
  return style === 'arrow' || hotspot.type === 'link';
}
export const hoverOf = hotspot => hotspot.hover ?? (hotspot.type === 'info' ? 'details' : 'label');
export const effectOf = hotspot => hotspot.effect ?? (hotspot.pulse ? 'pulse' : 'none');
/** Readable ink (dark or white) for text/icons drawn on a coloured marker. */
export function inkFor(hex) {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  const lin = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return luminance > 0.179 ? '#0b1118' : '#ffffff';
}
export const hotspotVisibleAt = (hotspot, seconds) =>
  Number.isFinite(seconds) && seconds >= (hotspot.startTime ?? 0) && (hotspot.endTime === undefined || seconds < hotspot.endTime);
const mediaPath = value => value === '' || (typeof value === 'string' && /^\/media\/[a-zA-Z0-9_-]+\.(mp4|webm|jpg|jpeg|png|webp)$/i.test(value));
const text = (value, label, max = 4000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}`);
};
const angle = (value, label, bound) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) throw new Error(`Invalid ${label}`);
};
const range = (value, label, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
};
export function validateProject(project) {
  if (!project || project.version !== 1 || !Array.isArray(project.scenes) || project.scenes.length > 100) throw new Error('Invalid project format');
  text(project.title, 'title', 160);
  if (project.presentation !== undefined) {
    const p = presentationOf(project);
    if (!['cut', 'fade', 'zoom'].includes(p.transition)) throw new Error('Invalid transition');
    if (!['grab', 'look'].includes(p.dragMode)) throw new Error('Invalid dragMode');
    range(p.transitionMs, 'transitionMs', 0, 1500);
    range(p.fieldOfView, 'fieldOfView', 45, 100);
    range(p.renderScale, 'renderScale', 1, 2);
    range(p.vrFoveation, 'vrFoveation', 0, 1);
  }
  const sceneIds = new Set();
  const hotspotIds = new Set();
  for (const scene of project.scenes) {
    text(scene.id, 'scene ID', 80); text(scene.name, 'scene name', 120);
    if (sceneIds.has(scene.id)) throw new Error('Duplicate scene ID');
    sceneIds.add(scene.id);
    if (!mediaPath(scene.video)) throw new Error('Invalid video path');
    angle(scene.startYaw, 'start yaw', Math.PI * 2);
    if (scene.videoOptions !== undefined) {
      const v = videoOptionsOf(scene);
      if (typeof v.loop !== 'boolean') throw new Error('Invalid loop');
      range(v.playbackRate, 'playbackRate', 0.5, 2);
      range(v.volume, 'volume', 0, 1);
    }
    if (!Array.isArray(scene.hotspots) || scene.hotspots.length > 200) throw new Error('Invalid hotspots');
    for (const h of scene.hotspots) {
      text(h.id, 'hotspot ID', 80); text(h.label, 'hotspot label', 120);
      if (hotspotIds.has(h.id)) throw new Error('Duplicate hotspot ID');
      hotspotIds.add(h.id);
      if (!['info', 'link'].includes(h.type)) throw new Error('Invalid hotspot type');
      angle(h.yaw, 'yaw', Math.PI * 2); angle(h.pitch, 'pitch', Math.PI / 2);
      const appearance = hotspotAppearanceOf(h);
      if (!HOTSPOT_STYLES.includes(appearance.style)) throw new Error('Invalid hotspot style');
      range(appearance.size, 'size', 0.5, 2.5);
      if (!/^#[0-9a-fA-F]{6}$/.test(appearance.color)) throw new Error('Invalid hotspot color');
      if (typeof appearance.pulse !== 'boolean') throw new Error('Invalid hotspot pulse');
      if (h.transition !== undefined && !['inherit', 'cut', 'fade', 'zoom'].includes(h.transition)) throw new Error('Invalid hotspot transition');
      if (h.hover !== undefined && !['details', 'label', 'none'].includes(h.hover)) throw new Error('Invalid hotspot hover');
      if (h.effect !== undefined && !['none', 'pulse', 'sonar', 'glow'].includes(h.effect)) throw new Error('Invalid hotspot effect');
      if (h.direction !== undefined) range(h.direction, 'direction', 0, 360);
      if (h.startTime !== undefined) range(h.startTime, 'startTime', 0, 86400);
      if (h.endTime !== undefined) {
        range(h.endTime, 'endTime', 0, 86400);
        if (h.endTime <= (h.startTime ?? 0)) throw new Error('Invalid endTime');
      }
      if (h.type === 'info') {
        text(h.title ?? '', 'info title', 160); text(h.body ?? '', 'info text', 4000);
        if (!mediaPath(h.image ?? '')) throw new Error('Invalid image path');
      } else text(h.target ?? '', 'target ID', 80);
    }
  }
  for (const scene of project.scenes) for (const h of scene.hotspots) {
    if (h.type === 'link' && h.target && !sceneIds.has(h.target)) throw new Error('Invalid link target');
  }
  return project;
}
const copy = project => structuredClone(project);
export function addScene(project, name) {
  const next = copy(project);
  next.scenes.push({ id: crypto.randomUUID(), name, video: '', startYaw: 0, hotspots: [] });
  return validateProject(next);
}
export function updateSceneFields(project, id, fields) {
  const next = copy(project);
  const scene = next.scenes.find(s => s.id === id);
  if (!scene) throw new Error('Scene not found');
  Object.assign(scene, fields);
  return validateProject(next);
}
export function moveScene(project, id, delta) {
  const next = copy(project);
  const from = next.scenes.findIndex(s => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= next.scenes.length) return next;
  [next.scenes[from], next.scenes[to]] = [next.scenes[to], next.scenes[from]];
  return next;
}
export function removeScene(project, id) {
  const next = copy(project);
  next.scenes = next.scenes.filter(s => s.id !== id);
  for (const scene of next.scenes) scene.hotspots = scene.hotspots.filter(h => h.type !== 'link' || h.target !== id);
  return validateProject(next);
}
export function addHotspot(project, sceneId, data) {
  const next = copy(project);
  const scene = next.scenes.find(s => s.id === sceneId);
  if (!scene) throw new Error('Scene not found');
  scene.hotspots.push({ id: crypto.randomUUID(), ...data });
  return validateProject(next);
}
export function updateHotspot(project, sceneId, hotspotId, data) {
  const next = copy(project);
  const scene = next.scenes.find(s => s.id === sceneId);
  const hotspot = scene?.hotspots.find(h => h.id === hotspotId);
  if (!hotspot) throw new Error('Hotspot not found');
  Object.assign(hotspot, data);
  return validateProject(next);
}
export function removeHotspot(project, sceneId, hotspotId) {
  const next = copy(project);
  const scene = next.scenes.find(s => s.id === sceneId);
  if (!scene) throw new Error('Scene not found');
  scene.hotspots = scene.hotspots.filter(h => h.id !== hotspotId);
  return next;
}
export function pointFromAngles(yaw, pitch, radius = 8) {
  return { x: Math.sin(yaw) * Math.cos(pitch) * radius, y: Math.sin(pitch) * radius, z: -Math.cos(yaw) * Math.cos(pitch) * radius };
}
export function anglesFromPoint({ x, y, z }) {
  return { yaw: Math.atan2(x, -z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}
