import { h } from './dom.js';

let timer;
/** notify('Saved'), notify('Oops', { kind: 'error' }), notify('Deleted', { action: { label: 'Undo', run } }) */
export function notify(message, { kind = 'info', action = null, ms = 5000 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  const parts = [h('span', { class: 'toast-text' }, message)];
  if (action) parts.push(h('button', { type: 'button', class: 'toast-action', onClick: () => { el.hidden = true; action.run(); } }, action.label));
  el.replaceChildren(...parts);
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, action ? Math.max(ms, 8000) : ms);
}

/** Turn validator messages into sentences a person can act on. */
export function friendlyError(error) {
  const text = String(error?.message ?? error);
  if (/endTime/.test(text)) return 'The hide time must be later than the show time.';
  if (/startTime/.test(text)) return 'The show time must be zero or later.';
  if (/color/i.test(text)) return 'Choose a colour as a six-digit hex value, like #25aae1.';
  if (/size/.test(text)) return 'Marker size must be between 0.5× and 2.5×.';
  if (/pitch/.test(text)) return 'Pitch must be between −90° and 90°.';
  if (/yaw/.test(text)) return 'Yaw must be between −360° and 360°.';
  return text;
}
