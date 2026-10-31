import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, presentationOf, videoOptionsOf, hotspotAppearanceOf, hotspotVisibleAt, hoverOf, effectOf, inkFor, moveScene, directionOf, usesDirection, addScene, removeScene, updateSceneFields, addHotspot, updateHotspot, pointFromAngles, anglesFromPoint } from '../src/project.js';

const empty = () => ({ version: 1, title: 'My tour', scenes: [] });

test('scene and hotspot edits keep stable IDs and clean links when a scene is removed', () => {
  let project = addScene(empty(), 'Entrance');
  project = addScene(project, 'Gallery');
  const [entrance, gallery] = project.scenes;
  project = addHotspot(project, entrance.id, { type: 'link', label: 'Gallery', target: gallery.id, yaw: 0, pitch: 0 });
  project = addHotspot(project, gallery.id, { type: 'info', label: 'Painting', title: 'Painting', body: 'A work of art', yaw: 1, pitch: 0.2 });
  assert.equal(project.scenes[0].hotspots[0].target, gallery.id);
  project = removeScene(project, gallery.id);
  assert.equal(project.scenes.length, 1);
  assert.equal(project.scenes[0].hotspots.length, 0);
});

test('hotspot update accepts only existing scene and hotspot', () => {
  let project = addScene(empty(), 'Hall');
  const scene = project.scenes[0];
  project = addHotspot(project, scene.id, { type: 'info', label: 'Desk', yaw: 0, pitch: 0 });
  project = updateHotspot(project, scene.id, project.scenes[0].hotspots[0].id, { label: 'Clock' });
  assert.equal(project.scenes[0].hotspots[0].label, 'Clock');
  assert.throws(() => updateHotspot(project, 'bad', 'bad', { label: 'X' }));
});

test('video upload updates its original scene after navigation', () => {
  let project = addScene(addScene(empty(), 'Entrance'), 'Gallery');
  const entranceId = project.scenes[0].id;
  const galleryId = project.scenes[1].id;
  project = updateSceneFields(project, entranceId, { video: '/media/clip.mp4' });
  assert.equal(project.scenes.find(s => s.id === entranceId).video, '/media/clip.mp4');
  assert.equal(project.scenes.find(s => s.id === galleryId).video, '');
});

test('validation rejects unsafe media paths, broken links and duplicate IDs', () => {
  const scene = { id: 'scene-1', name: 'Hall', video: '/media/abc.mp4', startYaw: 0, hotspots: [] };
  assert.deepEqual(validateProject({ version: 1, title: 'Tour', scenes: [scene] }).scenes[0], scene);
  assert.throws(() => validateProject({ version: 1, title: 'Tour', scenes: [{ ...scene, video: 'https://evil.test/video.mp4' }] }), /video/);
  assert.throws(() => validateProject({ version: 1, title: 'Tour', scenes: [scene, scene] }), /duplicate/i);
  assert.throws(() => validateProject({ version: 1, title: 'Tour', scenes: [{ ...scene, hotspots: [{ id: 'h1', type: 'link', label: 'Go', yaw: 0, pitch: 0, target: 'missing' }] }] }), /target/);
});

test('sphere angle conversion round trips and bounds pitch', () => {
  for (const [yaw, pitch] of [[0, 0], [1.2, 0.4], [-2.7, -0.7]]) {
    const point = pointFromAngles(yaw, pitch, 8);
    const result = anglesFromPoint(point);
    assert.ok(Math.abs(result.yaw - yaw) < 1e-8);
    assert.ok(Math.abs(result.pitch - pitch) < 1e-8);
  }
  assert.throws(() => validateProject({ version: 1, title: 'T', scenes: [{ id: 'a', name: 'A', video: '', startYaw: 0, hotspots: [{ id: 'h', type: 'info', label: 'B', title: 'B', body: '', yaw: 0, pitch: 2 }] }] }), /pitch/);
});

test('new presentation settings preserve old projects and reject invalid values', () => {
  const legacy = empty();
  assert.equal(presentationOf(validateProject(legacy)).fieldOfView, 70);
  assert.equal(videoOptionsOf({}).loop, true);
  assert.equal(hotspotAppearanceOf({}).style, 'pill');
  assert.equal(hotspotAppearanceOf({ size: 1.8, color: '#A1b2C3', style: 'ring', pulse: true }).size, 1.8);
  for (const style of ['tooltip', 'bubble', 'plus', 'sonar', 'expand', 'reveal', 'hint']) {
    const s = { id: 's1', name: 'A', video: '', startYaw: 0, hotspots: [{ id: 'h1', type: 'info', label: 'A', yaw: 0, pitch: 0, style }] };
    assert.doesNotThrow(() => validateProject({ ...empty(), scenes: [s] }));
  }
  assert.throws(() => validateProject({ ...empty(), presentation: { transition: 'teleport' } }), /transition/);
  assert.throws(() => validateProject({ ...empty(), presentation: { renderScale: 4 } }), /renderScale/);
  const s = { id: 's1', name: 'A', video: '', startYaw: 0, hotspots: [] };
  assert.throws(() => validateProject({ ...empty(), scenes: [{ ...s, videoOptions: { playbackRate: 5 } }] }), /playbackRate/);
  assert.throws(() => validateProject({ ...empty(), scenes: [{ ...s, hotspots: [{ id: 'h1', type: 'info', label: 'A', yaw: 0, pitch: 0, size: 0 }] }] }), /size/);
  assert.throws(() => validateProject({ ...empty(), scenes: [{ ...s, hotspots: [{ id: 'h1', type: 'info', label: 'A', yaw: 0, pitch: 0, color: 'red' }] }] }), /color/);
});

test('timed hotspots appear at start and disappear at end, including after seeking backwards', () => {
  const timed = { startTime: 12.5, endTime: 25 };
  assert.equal(hotspotVisibleAt(timed, 12.49), false);
  assert.equal(hotspotVisibleAt(timed, 12.5), true);
  assert.equal(hotspotVisibleAt(timed, 24.99), true);
  assert.equal(hotspotVisibleAt(timed, 25), false);
  assert.equal(hotspotVisibleAt(timed, 10), false);
  assert.equal(hotspotVisibleAt({}, 500), true);
  assert.equal(hotspotVisibleAt({ startTime: 3 }, 100), true);
  assert.equal(hotspotVisibleAt({ endTime: 4 }, 4), false);
});

test('timing, hover behavior, and effects validate without breaking old hotspots', () => {
  const base = { id: 'h1', type: 'info', label: 'A', yaw: 0, pitch: 0 };
  const make = h => ({ ...empty(), scenes: [{ id: 's1', name: 'A', video: '', startYaw: 0, hotspots: [{ ...base, ...h }] }] });
  assert.doesNotThrow(() => validateProject(make({ startTime: 5, endTime: 8, hover: 'details', effect: 'sonar' })));
  assert.throws(() => validateProject(make({ startTime: -1 })), /startTime/);
  assert.throws(() => validateProject(make({ startTime: 8, endTime: 8 })), /endTime/);
  assert.throws(() => validateProject(make({ hover: 'popunder' })), /hover/);
  assert.throws(() => validateProject(make({ effect: 'flashbang' })), /effect/);
});

test('scenes can be reordered without losing hotspots or links', () => {
  let project = addScene(addScene(addScene(empty(), 'A'), 'B'), 'C');
  const [a, b, c] = project.scenes.map(s => s.id);
  project = addHotspot(project, a, { type: 'link', label: 'to C', target: c, yaw: 0, pitch: 0 });
  project = moveScene(project, c, -1);
  assert.deepEqual(project.scenes.map(s => s.name), ['A', 'C', 'B']);
  project = moveScene(project, a, -1); // already first: unchanged
  assert.deepEqual(project.scenes.map(s => s.name), ['A', 'C', 'B']);
  project = moveScene(project, b, 1); // already last: unchanged
  assert.deepEqual(project.scenes.map(s => s.name), ['A', 'C', 'B']);
  assert.equal(project.scenes[0].hotspots[0].target, c);
  assert.doesNotThrow(() => validateProject(project));
});

test('marker defaults: hover content, idle effect (legacy pulse flag), and readable ink', () => {
  assert.equal(hoverOf({ type: 'info' }), 'details');
  assert.equal(hoverOf({ type: 'link' }), 'label');
  assert.equal(hoverOf({ type: 'info', hover: 'none' }), 'none');
  assert.equal(effectOf({}), 'none');
  assert.equal(effectOf({ pulse: true }), 'pulse');
  assert.equal(effectOf({ pulse: true, effect: 'glow' }), 'glow');
  // ink must contrast with the marker colour: dark text on light colours, white on dark ones
  assert.equal(inkFor('#ffffff'), '#0b1118');
  assert.equal(inkFor('#25aae1'), '#0b1118');
  assert.equal(inkFor('#000000'), '#ffffff');
  assert.equal(inkFor('#1f3a93'), '#ffffff');
});

test('arrow direction is validated, defaults to the old right-pointing look, and only applies to pointing styles', () => {
  let project = addScene(addScene(empty(), 'A'), 'B');
  const [a, b] = project.scenes.map(s => s.id);
  project = addHotspot(project, a, { type: 'link', label: 'go', target: b, yaw: 0, pitch: 0, style: 'hint', direction: 0 });
  const id = project.scenes[0].hotspots[0].id;
  assert.equal(directionOf({}), 90);
  assert.equal(directionOf(project.scenes[0].hotspots[0]), 0);
  assert.throws(() => updateHotspot(project, a, id, { direction: 400 }));
  assert.throws(() => updateHotspot(project, a, id, { direction: -1 }));
  assert.doesNotThrow(() => updateHotspot(project, a, id, { direction: 359 }));
  assert.equal(usesDirection({ type: 'link', style: 'hint' }), true);
  assert.equal(usesDirection({ type: 'info', style: 'arrow' }), true);
  assert.equal(usesDirection({ type: 'info', style: 'tooltip' }), false);
  assert.equal(usesDirection({ type: 'link', style: 'plus' }), false);
  assert.equal(usesDirection({ type: 'link', style: 'sonar' }), false);
});
