/* The custom lines, as the previous form works them out (13 Nov 2026):
   - made-to-order EPS (as OrderPods): a sheet (EPS-C) length x width x height, a disc (EPS- Circular) diameter x height,
     both with a grade; the line is described by them ("EPS Sheets 2500 X 1200 X 100 SL Grade"), priced per order;
   - cut to length (as OrderSteel): Rediwall custom panels (0.25 m wide, the 256 wall 0.15 m), BlueDeck custom sheets
     (1/3 m) and Armdeck: a number of panels or sheets at one length (300 to 12000 mm); the quantity is the m²
     (length / 1000 x width x count, 3 decimals) and the description says "6 PANELS @ 1520 mm" (sheets add "(X SQM)");
   - a free description (PKG, CR/MISC): the description is typed. */
export const EPS_GRADES = ['Standard (SL)', 'Medium (M)', 'High (H)', 'Very High (VH)', 'Very Very High (VVH)'];
export const epsKind = (code) => { const c = String(code || '').trim().toLowerCase(); return c === 'eps-c' ? 'sheet' : c === 'eps- circular' || c === 'eps-circular' ? 'disc' : ''; };
const shortGrade = (g) => (g ? (String(g).match(/\(([^)]+)\)/) || [])[1] || g : '');
export function epsName(kind, e = {}) { const g = shortGrade(e.grade);
  if (kind === 'sheet') return ('EPS Sheets ' + [e.L, e.W, e.H].filter(Boolean).join(' X ') + (g ? ' ' + g + ' Grade' : '')).trim();
  return ('EPS Circular ' + [e.D, e.H].filter(Boolean).join(' X ') + (g ? ' ' + g + ' Grade' : '')).trim(); }
export const epsMissing = (kind, e = {}) => (kind === 'sheet' ? !(e.L && e.W && e.H && e.grade) : kind === 'disc' ? !(e.D && e.H && e.grade) : false);

const WIDTHS = { 'AD1CUSTOM/300': 0.3, 'AD1CUSTOM/595': 0.595, 'AD75/CUSTOM': 0.595, 'BDCUSTOM1MM': 1 / 3, 'BDCUSTOM0.75MM': 1 / 3,
  RWCUSTOM110: 0.25, RWCUSTOM156: 0.25, RWCUSTOM200: 0.25, RWCUSTOM275: 0.25, RWCUSTOM300: 0.25, RWCUSTOM256: 0.15 };
const bdLength = (name) => /\bx\s*\d+(?:\.\d+)?\s*m\b/i.test(String(name || ''));
export function cutCode(l) { const c = String(l.code || '').trim().toUpperCase(); if (WIDTHS[c]) return c;
  if (/blue\s*deck/i.test(String(l.category || '')) && /custom/i.test(String(l.name || '')) && !bdLength(l.name)) return /\b0[.,]75\s*mm\b/i.test(String(l.name || '')) ? 'BDCUSTOM0.75MM' : 'BDCUSTOM1MM';
  return ''; }
export const cutWidth = (l) => WIDTHS[cutCode(l)] || 0;
export const isPanel = (l) => /^RWCUSTOM/.test(cutCode(l));
export const cutSqm = (w, mm, n) => Number(((mm / 1000) * w * n).toFixed(3));
export const cutBad = (c = {}) => !(Number.isInteger(Number(c.n)) && Number(c.n) >= 1 && Number(c.n) <= 5000 && Number.isInteger(Number(c.mm)) && Number(c.mm) >= 300 && Number(c.mm) <= 12000);
export function cutName(l) { const c = l.cut || {}, base = l.baseName || l.name; if (cutBad(c)) return base;
  const sqm = cutSqm(cutWidth(l), Number(c.mm), Number(c.n)); return base + ' ' + Number(c.n) + (isPanel(l) ? ' PANELS @ ' + Number(c.mm) + ' mm' : ' SHEETS @ ' + Number(c.mm) + ' mm (' + sqm.toFixed(3) + ' SQM)'); }
export const isFree = (l) => ['PKG', 'CR/MISC'].includes(String(l.code || '').trim().toUpperCase());
/* the line's description as it goes on the order, the invoice and the PO */
export function lineName(l) { const k = epsKind(l.code); if (k) return epsName(k, l.eps); if (cutWidth(l)) return cutName(l); if (isFree(l)) return String(l.desc || l.baseName || l.name).trim(); return l.name; }
/* what is still missing on a custom line, or '' */
export function customMissing(l) {
  const k = epsKind(l.code); if (k && epsMissing(k, l.eps)) return (k === 'sheet' ? 'EPS sheet: length, width, height and grade' : 'EPS circular: diameter, height and grade') + ' are required.';
  if (cutWidth(l) && cutBad(l.cut)) return (l.baseName || l.name) + ': enter the number of ' + (isPanel(l) ? 'panels' : 'sheets') + ' and the custom length (300 to 12000 mm).';
  if (isFree(l) && !String(l.desc || '').trim()) return (l.baseName || l.name) + ': type the description.';
  return '';
}
