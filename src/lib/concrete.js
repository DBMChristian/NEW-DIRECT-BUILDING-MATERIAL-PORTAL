/* Concrete grouped as the plants sell it (13 Nov 2026), in New Order and in Admin › Products: the mixes by kind (Stencil
   with Shotcrete), then the additional charges (additives, colours and the rest that are not a mix). */
export const CON_GROUPS = ['10mm Standard', '20mm Standard', 'Shotcrete', 'Long line', 'Wall', 'Blockfill', 'Other mixes', 'Additional charges'];
export const concreteGroup = (p) => {
  const c = String(p.code || '').toUpperCase(), n = String(p.name || '').toUpperCase();
  if (!/^CR\d/.test(c)) return 'Additional charges';
  if (/SHOTCRETE|STENCIL/.test(c + ' ' + n)) return 'Shotcrete';
  if (/LONG ?LINE/.test(c + ' ' + n)) return 'Long line';
  if (/WALL/.test(c + ' ' + n)) return 'Wall';
  if (/BLOCK ?FILL/.test(c + ' ' + n)) return 'Blockfill';
  if (/^CR\d+\/10\/(90|STANDARD)/.test(c) || /10MM$/.test(n.trim())) return '10mm Standard';
  if (/^CR\d+\/20\/(90|STANDARD)/.test(c) || /20MM$/.test(n.trim())) return '20mm Standard';
  return 'Other mixes';
};
/* the mix's strength from its code (CR25/… is 25 MPa): weakest first */
export const mpa = (p) => Number((/^CR(\d+)/i.exec(p.code || '') || [])[1] || 999);
/* concrete products in group order, each group weakest first */
export const sortConcrete = (ps) => CON_GROUPS.flatMap((g) => ps.filter((p) => concreteGroup(p) === g).sort((a, b) => mpa(a) - mpa(b) || String(a.name).localeCompare(String(b.name))));
