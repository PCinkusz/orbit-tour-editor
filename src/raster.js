// Turns the real HTML hotspot markers into sprite sheets for the headset.
//
// The desktop markers are plain HTML + CSS (hover transitions, ripples, glow ...). Re-drawing eleven styles by hand
// on a canvas would only ever approximate them, so instead the actual marker is built off-screen, its CSS animations
// are stepped to chosen moments with the Web Animations API, and every moment is rasterised through an SVG
// foreignObject. What the headset shows is therefore the same markup and stylesheet as the desktop.
import { createMarker, fitExpand } from './markers.js';

export const PX = 0.011;          // metres per CSS pixel of a marker (markers sit 5 m from the viewer)
const MAX_ATLAS = 3072;           // largest sprite-sheet side in pixels
const HOVER_FRAMES = 6;
const MAX_IDLE_FRAMES = 20;
const SKIP = /^(animation|transition|scroll|overscroll|grid|column|contain|container|view-|offset|page|break-|orphans|widows|ruby|math|caret|app-region|interactivity|position-|anchor|field-sizing|speak|timeline|text-wrap|-webkit-|interpolate)|(^|-)(block|inline)(-|$)/;

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
let host = null;
let usedPixels = 0;             // sprite-sheet pixels currently cached; sharpness drops when a scene needs a lot of them
let queue = Promise.resolve();
const dataUrls = new Map();
const cache = new Map();

// ---------------------------------------------------------------- helpers
async function toDataUrl(url) {
  if (url.startsWith('data:')) return url;
  if (!dataUrls.has(url)) {
    dataUrls.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.blob(); })
      .then(blob => new Promise((resolve, reject) => { const f = new FileReader(); f.onload = () => resolve(f.result); f.onerror = reject; f.readAsDataURL(blob); })));
  }
  return dataUrls.get(url);
}

// A photo from a phone can be several megabytes and is embedded in every frame; a card shows it at most ~240 px wide.
async function shrink(img) {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (!longest) return toDataUrl(img.currentSrc || img.src).catch(() => BLANK);   // missing picture: the card simply shows an empty frame
  const k = Math.min(1, 640 / longest);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(/\.png($|\?)/i.test(img.currentSrc || img.src) ? 'image/png' : 'image/jpeg', 0.9);
}

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'raster-host';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  return host;
}

// `:hover` cannot be switched on from script, so copy every hotspot hover rule with a `.force-hover` class instead.
function ensureForcedHoverCss() {
  if (document.getElementById('raster-hover-css')) return;
  let css = '';
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && /:hover|:focus-visible/.test(rule.selectorText) && /\.(desktop-hotspot|style-|hotspot-)/.test(rule.selectorText)) {
        css += rule.cssText.replace(/:hover|:focus-visible/g, '.force-hover');
      }
    }
  }
  const style = document.createElement('style');
  style.id = 'raster-hover-css';
  style.textContent = css;
  document.head.append(style);
}

function inRanges(ranges, code) {
  if (!ranges) return true;
  return ranges.split(',').some(part => {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) return false;
    if (m[1].includes('?')) return code >= parseInt(m[1].replace(/\?/g, '0'), 16) && code <= parseInt(m[1].replace(/\?/g, 'F'), 16);
    const lo = parseInt(m[1], 16);
    return code >= lo && code <= (m[2] ? parseInt(m[2], 16) : lo);
  });
}

// An SVG image cannot see the page's fonts, so embed only the faces (weight + character range) this marker uses.
async function fontCss(family, weights, text) {
  const wanted = new Set([...text].map(c => c.codePointAt(0)));
  wanted.add(65);
  const faces = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const get = p => rule.style.getPropertyValue(p).trim();
      if (get('font-family').replace(/["']/g, '') !== family) continue;
      if (!weights.has(get('font-weight') || '400')) continue;
      const range = get('unicode-range');
      if (![...wanted].some(code => inRanges(range, code))) continue;
      const src = /url\(["']?([^"')]+)["']?\)/.exec(get('src'));
      if (!src) continue;
      faces.push({ get, url: new URL(src[1], sheet.href || location.href).href, range });
    }
  }
  const parts = await Promise.all(faces.map(async f =>
    `@font-face{font-family:"${family}";font-weight:${f.get('font-weight') || 400};font-style:${f.get('font-style') || 'normal'};${f.range ? `unicode-range:${f.range};` : ''}src:url(${await toDataUrl(f.url)}) format("woff2");}`));
  return parts.join('');
}

// Text in an SVG image stays invisible until its embedded font has loaded, and that can finish after the image reports
// "ready". So paint a probe line per weight and wait until ink actually appears; later images then reuse the loaded fonts.
const primed = new Set();
async function primeFonts(css, used) {
  if (!css || primed.has(css)) return;
  const W = 460, H = 44;
  const chars = [...new Set(used.text.replace(/\s/g, ''))].join('').slice(0, 60);
  for (const weight of used.weights) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px"><style>${css}</style><div style="font:${weight} 26px '${used.family}';line-height:${H}px;color:#000;white-space:nowrap">Hamburgefonstiv ${chars}</div></div>`;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="${W}" height="${H}">${xhtml}</foreignObject></svg>`)}`;
      await img.decode();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, W, H).data;
      let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) ink++;
      if (ink > 80) break;
      await new Promise(r => setTimeout(r, 40));
    }
  }
  primed.add(css);
}

// ---------------------------------------------------------------- cloning with resolved styles
function styleText(cs) {
  let out = '';
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    if (!SKIP.test(name)) out += `${name}:${cs.getPropertyValue(name)};`;
  }
  return `${out}animation:none;transition:none;`;
}

function pseudoClone(src, which, used) {
  const cs = getComputedStyle(src, which);
  const content = cs.content;
  if (!content || content === 'none' || content === 'normal') return null;
  const el = document.createElement('span');
  el.setAttribute('style', styleText(cs));
  if (content.startsWith('"') && content.length > 2) { el.textContent = content.slice(1, -1); used.text += el.textContent; used.weights.add(cs.fontWeight); }
  return el;
}

function cloneStyled(src, used, images) {
  const el = src.cloneNode(false);
  const cs = getComputedStyle(src);
  el.setAttribute('style', styleText(cs));
  el.removeAttribute('class'); el.removeAttribute('id'); el.removeAttribute('data-hotspot-id');
  if (src.tagName === 'IMG') el.setAttribute('src', images.get(src));
  const before = pseudoClone(src, '::before', used);
  if (before) el.append(before);
  for (const child of src.childNodes) {
    if (child.nodeType === 3) {
      el.append(child.cloneNode());
      if (child.textContent.trim()) { used.text += child.textContent; used.weights.add(cs.fontWeight); used.family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(); }
    } else if (child.nodeType === 1) el.append(cloneStyled(child, used, images));
  }
  const after = pseudoClone(src, '::after', used);
  if (after) el.append(after);
  return el;
}

// ---------------------------------------------------------------- measuring
function extent(marker, anchor, withHover) {
  const a = anchor.getBoundingClientRect();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const node of [marker, ...marker.querySelectorAll('*')]) {
    if (!withHover && node.closest('.hotspot-hover')) continue;
    const box = node.getBoundingClientRect();
    if (!box.width && !box.height) continue;
    l = Math.min(l, box.left - a.left); t = Math.min(t, box.top - a.top); r = Math.max(r, box.right - a.left); b = Math.max(b, box.bottom - a.top);
  }
  return { l, t, r, b };
}
const unite = (x, y) => ({ l: Math.min(x.l, y.l), t: Math.min(x.t, y.t), r: Math.max(x.r, y.r), b: Math.max(x.b, y.b) });
const grow = (x, n) => ({ l: x.l - n, t: x.t - n, r: x.r + n, b: x.b + n });

// ---------------------------------------------------------------- painting
function sheetLayout(count, cellW, cellH) {
  const start = usedPixels > 96e6 ? 1 : usedPixels > 48e6 ? 1.5 : 2;
  for (let s = start; s >= 0.75; s -= 0.25) {
    const cw = Math.round(cellW * s), ch = Math.round(cellH * s);
    const cols = Math.max(1, Math.min(count, Math.floor(MAX_ATLAS / cw)));
    const rows = Math.ceil(count / cols);
    if (rows * ch <= MAX_ATLAS) return { s, cw, ch, cols, rows };
  }
  throw new Error('marker too large for a sprite sheet');
}

async function paintSheet(frames, box, css, scale) {
  const W = Math.ceil(box.r - box.l), H = Math.ceil(box.b - box.t);
  const { s, cw, ch, cols, rows } = sheetLayout(frames.length, W, H);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw; canvas.height = rows * ch;
  const g = canvas.getContext('2d');
  const ox = -box.l, oy = -box.t;
  for (let i = 0; i < frames.length; i++) {
    const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${W}px;height:${H}px;overflow:hidden"><style>${css}</style><div style="position:absolute;left:${ox}px;top:${oy}px;width:0;height:0">${frames[i]}</div></div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    g.drawImage(img, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
  }
  usedPixels += canvas.width * canvas.height;
  return { canvas, cols, rows, count: frames.length, cellW: W, cellH: H, ox, oy, pixels: canvas.width * canvas.height };
}

function pause(marker) {
  const animations = marker.getAnimations({ subtree: true });
  for (const a of animations) a.pause();
  return animations;
}
const seek = (animations, ms) => { for (const a of animations) a.currentTime = ms; };

// ---------------------------------------------------------------- one marker
async function build(hs) {
  const root = ensureHost();
  ensureForcedHoverCss();
  const anchor = document.createElement('div');
  anchor.style.cssText = 'position:absolute;left:500px;top:400px;width:0;height:0';
  const marker = createMarker(hs);
  anchor.append(marker);
  root.replaceChildren(anchor);
  try {
    await Promise.all([...marker.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
    getComputedStyle(marker).width;
    await document.fonts.ready;
    fitExpand(marker);
    const images = new Map();
    await Promise.all([...marker.querySelectorAll('img')].map(async img => images.set(img, await shrink(img))));

    const used = { text: '', weights: new Set(), family: 'IBM Plex Sans' };
    const serialise = () => new XMLSerializer().serializeToString(cloneStyled(marker, used, images));
    const effect = /effect-(pulse|glow|sonar)/.exec(marker.className)?.[1];
    const sonar = marker.classList.contains('style-sonar');
    const pad = sonar ? 44 : effect === 'sonar' ? 34 : effect === 'glow' ? 24 : 14;

    // ---- resting look, with its idle animations sampled over one loop
    let animations = pause(marker);
    const loops = animations.map(a => { const t = a.effect.getComputedTiming(); return t.iterations === Infinity ? t.duration * (t.direction.startsWith('alternate') ? 2 : 1) : 0; });
    const period = Math.max(0, ...loops) / 1000;
    const idleCount = period > 0 ? Math.min(MAX_IDLE_FRAMES, Math.max(8, Math.round(period * 8))) : 1;
    const idleFrames = []; let idleBox = null;
    for (let i = 0; i < idleCount; i++) {
      seek(animations, (i / idleCount) * period * 1000);
      idleFrames.push(serialise());
      const e = extent(marker, anchor, false);
      idleBox = idleBox ? unite(idleBox, e) : e;
    }
    const hitIdle = (() => { seek(animations, 0); return extent(marker, anchor, false); })();

    // ---- hover transition, sampled from rest to the end state
    seek(animations, 0);
    marker.classList.add('force-hover');
    getComputedStyle(marker).width;
    animations = pause(marker);
    const duration = Math.max(0.25, ...animations.map(a => a.effect.getComputedTiming().endTime).filter(Number.isFinite)) / 1000;
    const hoverFrames = []; let hoverBox = grow(idleBox, pad);
    for (let i = 0; i < HOVER_FRAMES; i++) {
      for (const a of animations) a.currentTime = Math.min((i / (HOVER_FRAMES - 1)) * duration * 1000, a.effect.getComputedTiming().endTime ?? Infinity);
      hoverFrames.push(serialise());
      hoverBox = unite(hoverBox, grow(extent(marker, anchor, true), 26));
    }
    const hitHover = extent(marker, anchor, false);
    const css = await fontCss(used.family, used.weights, used.text);
    await primeFonts(css, used);
    const idle = { ...await paintSheet(idleFrames, grow(idleBox, pad), css), fps: period > 0 ? idleCount / period : 0 };
    const hover = { ...await paintSheet(hoverFrames, hoverBox, css), duration };
    return { idle, hover, hit: { idle: hitIdle, hover: hitHover } };
  } finally {
    root.replaceChildren();
  }
}

/** Sprites for one hotspot (cached by how it looks, not where it is). Builds one marker at a time. */
export function spritesFor(hs) {
  const { id, yaw, pitch, startTime, endTime, target, transition, ...look } = hs;
  const key = JSON.stringify(look);
  if (!cache.has(key)) {
    const job = queue.then(() => build(hs));
    queue = job.catch(() => {});
    cache.set(key, job);
    job.catch(() => cache.delete(key));
    if (cache.size > 40) {
      const oldest = cache.keys().next().value;
      cache.get(oldest).then(r => { usedPixels -= r.idle.pixels + r.hover.pixels; }).catch(() => {});
      cache.delete(oldest);
    }
  }
  return cache.get(key);
}
