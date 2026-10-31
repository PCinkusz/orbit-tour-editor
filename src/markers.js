// One renderer for hotspot markers: used on the stage and in the style picker, so they always match.
import { h } from './dom.js';
import { mediaUrl } from './media.js';
import { hotspotAppearanceOf, hoverOf, effectOf, inkFor, directionOf } from './project.js';

const GLYPHS = {
  info: '<path d="M12 10v8.6"/><circle cx="12" cy="5.4" r="1.7" fill="currentColor" stroke="none"/>',
  'info-ring': '<circle cx="12" cy="12" r="10"/><path d="M12 10.6v6.6"/><circle cx="12" cy="7" r="1.4" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M12 20.5V4.5M5.2 11.3 12 4.5l6.8 6.8"/>',
  plus: '<path d="M12 4.5v15M4.5 12h15"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>'
};

function glyph(name, { rotate = false } = {}) {
  const span = h('span', { class: `hotspot-icon${rotate ? ' rot' : ''}`, 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${GLYPHS[name]}</svg>`;
  return span;
}

export const STYLE_NAMES = [
  ['tooltip', 'Info disc'], ['plus', 'Plus ring'], ['sonar', 'Sonar'], ['expand', 'Expanding tile'],
  ['reveal', 'Reveal card'], ['hint', 'Bare arrow'], ['bubble', 'Speech bubble'], ['pill', 'Label pill'],
  ['dot', 'Dot'], ['ring', 'Target ring'], ['arrow', 'Pointer']
];

/**
 * Build a marker button. `preview` makes an inert copy for the style picker.
 * The caller attaches behaviour (click, drag, selection) for live markers.
 */
export function createMarker(hs, { preview = false } = {}) {
  const a = hotspotAppearanceOf(hs);
  const hover = preview ? 'none' : hoverOf(hs);
  const isLink = hs.type === 'link';
  const detailed = hs.type === 'info' && hover === 'details';
  const heading = detailed ? (hs.title || hs.label) : hs.label;
  const main = isLink ? glyph('arrow', { rotate: true }) : glyph('info');
  const text = h('span', { class: 'hotspot-text' }, hs.label || 'Untitled');

  let kids;
  switch (a.style) {
    case 'plus': kids = [glyph('plus')]; break;
    case 'sonar': kids = [h('span', { class: 'sonar-dot' })]; break;
    case 'dot': case 'ring': kids = []; break;
    case 'reveal': kids = [text, glyph('chevron')]; break;
    case 'hint': kids = [isLink ? glyph('arrow', { rotate: true }) : glyph('info-ring')]; break;
    case 'arrow': kids = [h('span', { class: 'pointer' }), isLink ? null : glyph('info')]; break;
    case 'bubble': case 'pill': kids = [main, text]; break;
    default: kids = [main]; // tooltip, expand
  }

  const picture = detailed && hs.image && h('img', { class: 'hotspot-image', src: mediaUrl(hs.image), alt: '', loading: 'eager' });
  const card = hover !== 'none' && h('span', { class: 'hotspot-hover' },
    h('strong', {}, heading || 'Untitled'),
    picture,
    detailed && hs.body && h('span', { class: 'hotspot-body' }, hs.body));

  const marker = h('button', {
    type: 'button',
    class: `desktop-hotspot style-${a.style} type-${hs.type} effect-${preview ? 'none' : effectOf(hs)} hover-${hover} ink-${inkFor(a.color) === '#ffffff' ? 'light' : 'dark'}`,
    tabindex: preview ? -1 : null,
    'aria-hidden': preview ? 'true' : null,
    'aria-label': preview ? null : `${isLink ? 'Go to' : 'About'}: ${hs.label || 'Untitled'}`,
    dataset: hs.id ? { hotspotId: hs.id } : {},
    style: { '--hotspot-size': preview ? 1 : a.size, '--hotspot-color': a.color, '--hotspot-ink': inkFor(a.color), '--hotspot-dir': `${directionOf(hs)}deg` }
  }, h('span', { class: 'hotspot-face' }, kids), card);
  if (picture) picture.addEventListener('load', () => fitExpand(marker));
  return marker;
}

/** The expanding tile grows to fit its whole text: measure the card once it is in the page. */
export function fitExpand(marker) {
  if (!marker.classList.contains('style-expand')) return;
  const card = marker.querySelector('.hotspot-hover');
  const height = card?.offsetHeight ?? 0;
  if (height > 0) marker.style.setProperty('--expand-h', `${Math.max(height, 110)}px`);
}
