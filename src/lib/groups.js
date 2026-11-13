/* Products grouped inside their category (13 Nov 2026), the same in New Order and Admin › Products:
   Concrete: the mixes by kind (Stencil with Shotcrete), then the additional charges;
   Wafflepods: Pods (waffle pods by height, then solid pods), Custom (EPS made to order), Accessories (tripods, rails,
   spacers, earth rods), then the additional charges. */
import { CON_GROUPS, concreteGroup, mpa } from './concrete.js';

const isCharge = (p) => p.sub_category === 'additional_charge';
const num = (s) => Number((/(\d+)/.exec(String(s || '')) || [])[1] || 9999);

export const WP_GROUPS = ['Pods', 'Custom', 'Accessories', 'Additional charges'];
export function waffleGroup(p) {
  const c = String(p.code || '').toUpperCase(), n = String(p.name || '').toUpperCase();
  if (isCharge(p) || /^(WPDEL|WPENVIRO|WPSB|FUEL ?LEVY|WP\/RESTOCKING)$/.test(c)) return 'Additional charges';
  if (/^EPS/.test(c) || /CUSTOM/.test(n)) return 'Custom';
  if (/^WP\d|^WPSP\d/.test(c) || /\bPOD\b/.test(n) && !/TRI ?POD|RAIL|SPACER/.test(n)) return 'Pods';
  return 'Accessories';
}
const waffleOrder = (p) => { const c = String(p.code || '').toUpperCase(); return (/^WPSP/.test(c) ? 10000 : 0) + num(c); };

/* the groups of a category, or null when it has none */
export function groupsOf(category) {
  if (category === 'Concrete') return { names: CON_GROUPS, of: concreteGroup, sort: (a, b) => mpa(a) - mpa(b) || String(a.name).localeCompare(String(b.name)) };
  if (category === 'Wafflepods') return { names: WP_GROUPS, of: waffleGroup, sort: (a, b) => waffleOrder(a) - waffleOrder(b) || String(a.name).localeCompare(String(b.name)) };
  return null;
}
/* a category's products in group order */
export function sortGrouped(category, ps) {
  const g = groupsOf(category); if (!g) return ps;
  return g.names.flatMap((name) => ps.filter((p) => g.of(p) === name).sort(g.sort));
}
