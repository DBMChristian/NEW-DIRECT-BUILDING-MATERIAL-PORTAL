/* Products grouped inside their category (13 Nov 2026), the same in New Order and Admin › Products:
   Concrete: the mixes by kind (Stencil with Shotcrete), then the additional charges;
   Rediwall: by wall size (110, 156, 200, 256, 275, 300), the parts for any size, then the additional charges;
   Wafflepods: Pods (waffle pods by height, then solid pods), Custom (EPS made to order), Accessories (tripods, rails,
   spacers, earth rods), then the additional charges. */
import { CON_GROUPS, concreteGroup, mpa } from './concrete.js';

const isCharge = (p) => p.sub_category === 'additional_charge';
const num = (s) => Number((/(\d+)/.exec(String(s || '')) || [])[1] || 9999);

export const WP_GROUPS = ['Pods', 'Custom', 'Accessories', 'Additional charges'];
export function waffleGroup(p) {
  const c = String(p.code || '').toUpperCase(), n = String(p.name || '').toUpperCase();
  if (c === 'WPSB') return 'Accessories';   /* scrap bags: extra ones are bought as an item */
  if (isCharge(p) || /^(WPDEL|WPENVIRO|FUEL ?LEVY|WP\/RESTOCKING)$/.test(c)) return 'Additional charges';
  if (/^EPS/.test(c) || /CUSTOM/.test(n)) return 'Custom';
  if (/^WP\d|^WPSP\d/.test(c) || /\bPOD\b/.test(n) && !/TRI ?POD|RAIL|SPACER/.test(n)) return 'Pods';
  return 'Accessories';
}
const waffleOrder = (p) => { const c = String(p.code || '').toUpperCase(); return (/^WPSP/.test(c) ? 10000 : 0) + num(c); };

/* Rediwall by wall size: 110, 156, 200, 256, 275, 300 (the size in its code, else its name), then the parts for any size,
   then the additional charges; in each size the panels first, then corners, custom panels, end caps, joiners, tracks,
   FC strips, spacers, screws, each shortest first */
const RW_SIZES = ['110', '156', '200', '256', '275', '300'];
export const RW_GROUPS = [...RW_SIZES.map((x) => x + ' wall'), 'Any size', 'Additional charges'];
export function rediwallGroup(p) {
  if (isCharge(p) || /^(IMPC|RW-?CUT|RW-SCAN)/i.test(String(p.code || ''))) return 'Additional charges';
  const find = (t) => { const m = String(t || '').match(/\d{3}/g) || []; return m.find((x) => RW_SIZES.includes(x)); };
  const size = find(p.code) || find(p.name);
  return size ? size + ' wall' : 'Any size';
}
const RW_KIND = [/^RWP-/, /^RWC\d/, /^RWCP|^RWCUSTOM/, /^RWEC/, /^RW(FJ|HJ|TJ)/, /^RW(FT|JT|QC)/, /^RWFC/, /^RWSP/, /^RWSCREW/];
const rwOrder = (p) => { const c = String(p.code || '').toUpperCase(), k = RW_KIND.findIndex((r) => r.test(c)); return (k < 0 ? 99 : k) * 100000 + num((c.match(/[X\/](\d{4})/) || [])[1]); };

/* the groups of a category, or null when it has none */
export function groupsOf(category) {
  if (category === 'Concrete') return { names: CON_GROUPS, of: concreteGroup, sort: (a, b) => mpa(a) - mpa(b) || String(a.name).localeCompare(String(b.name)) };
  if (category === 'Rediwall') return { names: RW_GROUPS, of: rediwallGroup, sort: (a, b) => rwOrder(a) - rwOrder(b) || String(a.code).localeCompare(String(b.code)) };
  if (category === 'Wafflepods') return { names: WP_GROUPS, of: waffleGroup, sort: (a, b) => waffleOrder(a) - waffleOrder(b) || String(a.name).localeCompare(String(b.name)) };
  return null;
}
/* a category's products in group order */
export function sortGrouped(category, ps) {
  const g = groupsOf(category); if (!g) return ps;
  return g.names.flatMap((name) => ps.filter((p) => g.of(p) === name).sort(g.sort));
}
