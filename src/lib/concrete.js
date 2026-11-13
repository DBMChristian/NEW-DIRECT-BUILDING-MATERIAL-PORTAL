/* Concrete mixes grouped by kind (13 Nov 2026), from the code (CR20/10/90-BR: 20 MPa, 10 mm, standard) and the name:
   10mm Standard, 20mm Standard, Blockfill, Long line, Wall, Shotcrete, then other mixes and the extras (additives,
   colours, charges). Used by Products and New Order. */
export const MIX_GROUPS = ['10mm Standard', '20mm Standard', 'Blockfill', 'Long line', 'Wall', 'Shotcrete', 'Other mixes', 'Extras'];
export function mixGroup(p) {
  const code = String(p.code || '').toUpperCase(), t = (code + ' ' + String(p.name || '')).toUpperCase();
  if (!/^CR\d/.test(code)) return 'Extras';
  if (/BLOCK ?FILL/.test(t)) return 'Blockfill';
  if (/LONG ?LINE/.test(t)) return 'Long line';
  if (/SHOTCRETE|SHOT CRETE/.test(t)) return 'Shotcrete';
  if (/WALL|DINCEL/.test(t)) return 'Wall';
  const m = /^CR\d+\/(\d+)\/([^/\s-]+)/.exec(code), size = m ? m[1] : '', kind = m ? m[2] : '';
  if ((/^(90|STD|STANDARD)$/.test(kind) || /STANDARD/.test(t)) && size === '10') return '10mm Standard';
  if ((/^(90|STD|STANDARD)$/.test(kind) || /STANDARD/.test(t)) && size === '20') return '20mm Standard';
  return 'Other mixes';
}
/* products in their mix groups, in that order: [{ group, rows }] */
export function byMix(rows) {
  return MIX_GROUPS.map((g) => ({ group: g, rows: rows.filter((p) => mixGroup(p) === g) })).filter((x) => x.rows.length);
}
