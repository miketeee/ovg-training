// ui.js — small helpers shared by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return plural(Math.round(s / 60), 'minute') + ' ago';
  if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function kb(chars) {
  return chars > 1e6 ? `${(chars / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(chars / 1000))} KB`;
}

/** Show a message in a .msg element. good: true (green edge), false (red edge), undefined (plain). */
export function say(el, text, good) {
  el.textContent = text || '';
  el.className = 'msg' + (good === true ? ' good' : good === false ? ' bad' : '');
}

/** A progress bar element's fill. */
export function fill(bar, done, total) {
  bar.hidden = false;
  bar.firstElementChild.style.width = `${total ? Math.round((100 * done) / total) : 0}%`;
}

export const FAMILY = {
  handstand: 'Handstand',
  pull: 'Pulling',
  push: 'Pushing',
  core: 'Core',
  legs: 'Legs',
  multiplane: 'Multi-plane',
  'rings-skills': 'Rings skills',
  'warmup-mobility': 'Warm-up and mobility',
};
