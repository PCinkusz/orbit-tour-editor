// Tiny DOM helpers so UI code reads as structure instead of createElement noise.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const LAST = new Set(['value', 'checked', 'selectedIndex']);
const PROPS = new Set(['disabled', 'hidden', 'open', 'selected', 'indeterminate', 'min', 'max', 'step', 'type', 'rows', 'maxLength', 'placeholder', 'accept', 'id', 'title', 'name', 'htmlFor', 'readOnly', 'spellcheck', 'autocomplete']);

/** h('button', { class: 'x', onClick: fn, 'aria-label': 'Close' }, 'text', childNode) */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  const late = [];
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'for') el.htmlFor = value;
    else if (key === 'style' && typeof value === 'object') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (/^on[A-Z]/.test(key)) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (LAST.has(key)) late.push([key, value]);
    else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, kids);
  for (const [key, value] of late) el[key] = value;
  return el;
}

export function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
