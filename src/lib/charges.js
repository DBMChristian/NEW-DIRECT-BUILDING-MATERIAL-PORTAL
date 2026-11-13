/* The additional charges, as the previous portal's New Order works them out (13 Nov 2026):
   - delivery per material on a delivery load: Hebel and Rediwall $450, NRG, Bricks and Bluedeck $250 (its price book),
     Reinforcement $350 a truck;
   - Rediwall: the supply chain impact charge, 7.5% of the Rediwall products (half up to the cent);
   - Wafflepods (as OrderPods): WPDEL by location (Sydney the WPDEL price, else $250; Canberra $650; NSW / ACT long distance
     by driving time: one-way hours rounded .00-.24 down, .25-.44 to .5, up, x 2 + 0.5, x $100); with scrap pick-up the
     environmental levy WPENVIRO $90 and free scrap bags WPSB (1-79 pods 1, then one more every 40);
   - Concrete (as OrderConcrete): CRTRANS and CRPROD per m³ (CRPROD for Boral, Concrite, Hy-Tec, Heidelberg, Holcim or no
     plant chosen), CRSUR for the m³ short of 4 (3 for Tiger Enterprises and Bartun Concreting), CRTEST3C x 3 with a tester,
     CR/COLOUR (the max quantity in colour, else 1) and CR/Washout (m³ / 6, up) when coloured. Their prices are the
     customer's price list for those codes. */
export const DELIVERY = { Hebel: 450, Rediwall: 450, NRG: 250, Bricks: 250, Bluedeck: 250, Others: 250 };   /* Others: the price book's default */
export const REO_TRUCK = 350;
export const IMPC_RATE = 0.075;
export const WP_LOCATIONS = [['Sydney', 'Sydney'], ['NSW', 'NSW (long distance)'], ['Canberra', 'Canberra'], ['ACT', 'ACT (long distance)']];
export const SCRAP_SOURCE = ['EPS-C', 'EPS- Circular', 'WPSP175', 'WPSP300', 'WP300', 'WPSP100', 'WP375', 'WPSP150', 'WP225', 'WP150'];
export const PLANTS = ['', 'Boral Construction Materials Group Limited', 'Concrite Pty Ltd', 'HY-TEC INDUSTRIES PTY LTD', 'Heidelberg Materials Australia Pty Ltd', 'Holcim', 'LINEKING PTY LTD', 'Hanson Construction Materials Pty Ltd'];
const CRPROD_PLANTS = ['', 'Boral Construction Materials Group Limited', 'Concrite Pty Ltd', 'HY-TEC INDUSTRIES PTY LTD', 'Heidelberg Materials Australia Pty Ltd', 'Holcim'];
export const CON_CHARGES = ['CRTRANS', 'CRPROD', 'CRSUR', 'CRTEST3C', 'CR/COLOUR', 'CR/Washout'];
/* the charges the form adds itself (not picked by hand); WPSB is also an item: extra bags are bought at their price */
export const FORM_CHARGES = ['IMPC', 'WPDEL', 'WPENVIRO', ...CON_CHARGES];
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundHrs = (h) => { const w = Math.floor(h), d = Number((h - w).toFixed(2)); return d <= 0.24 ? w : d <= 0.44 ? w + 0.5 : w + 1; };
export const scrapBags = (pods) => (!pods || pods <= 0 ? 0 : pods <= 79 ? 1 : Math.floor((pods - 80) / 40) + 2);
const minimumLoad = (company) => (['tiger enterprises', 'bartun concreting pty ltd'].includes(String(company || '').trim().toLowerCase()) ? 3 : 4);

/* the charges for one material's load: [{ key, code, name, unit, qty, price, note }] */
export function chargesFor(cat, lines, load, ctx) {
  const out = [], goods = lines.filter((l) => l.category === cat);
  if (!goods.length) return out;
  const del = load.fulfil === 'delivery', a = load.answers || {};
  if (DELIVERY[cat] != null && del) out.push({ key: 'del', code: 'DELIVERY', name: 'Delivery: ' + cat, unit: 'delivery', qty: 1, price: DELIVERY[cat] });
  if (cat === 'Reinforcement' && del) out.push({ key: 'del', code: 'DELIVERY', name: 'Delivery: Reinforcement', unit: 'truck', qty: 1, price: REO_TRUCK });
  if (cat === 'Rediwall' && !ctx.noImpc) {
    const cents = Math.round(goods.reduce((s, l) => s + r2((Number(l.qty) || 0) * (Number(l.price) || 0)), 0) * 100);
    const amt = Math.floor(cents * IMPC_RATE + 0.5 + 1e-9) / 100;
    if (amt > 0) out.push({ key: 'impc', code: 'IMPC', name: 'Supply chain impact charge (7.5%)', unit: 'charge', qty: 1, price: amt, locked: true });
  }
  if (cat === 'Wafflepods' && del) {
    const syd = ctx.priceOf('WPDEL') || 250;
    const price = a.location === 'Canberra' ? 650 : a.location === 'Sydney' ? syd : a.location ? Number(((roundHrs(Number(a.hours) || 0) * 2 + 0.5) * 100).toFixed(2)) : 0;
    out.push({ key: 'wpdel', code: 'WPDEL', name: 'Waffle pod delivery' + (a.location ? ': ' + (WP_LOCATIONS.find((x) => x[0] === a.location) || [, a.location])[1] : ''), unit: 'load', qty: 1, price,
      note: !a.location ? 'Choose the location' : (a.location === 'NSW' || a.location === 'ACT') && !(Number(a.hours) > 0) ? 'Enter the driving time' : '' });
    if (a.scrap === 'yes') {
      out.push({ key: 'wpenviro', code: 'WPENVIRO', name: 'Environmental levy', unit: 'each', qty: 1, price: 90 });
      const pods = goods.filter((l) => SCRAP_SOURCE.some((c) => c.toLowerCase() === String(l.code || '').toLowerCase())).reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const bags = scrapBags(pods); if (bags) out.push({ key: 'wpsb', code: 'WPSB', name: 'Scrap bags (free)', unit: 'bag', qty: bags, price: 0, free: true });
    }
  }
  if (cat === 'Concrete') {
    const m3 = r2(goods.filter((l) => /^CR\d/i.test(String(l.code || ''))).reduce((s, l) => s + (Number(l.qty) || 0), 0));   /* the mixes (CR20/10/…), not additives */
    const add = (code, qty) => out.push({ key: code.toLowerCase(), code, name: ctx.nameOf(code) || code, unit: 'each', qty, price: ctx.priceOf(code) || 0, note: ctx.priceOf(code) ? '' : 'No price for ' + code + ' yet: type it' });
    if (m3 > 0) {
      if (del) add('CRTRANS', m3);
      if (CRPROD_PLANTS.includes(String(a.plant || ''))) add('CRPROD', m3);
      const short = r2(minimumLoad(ctx.company) - m3); if (short > 0) add('CRSUR', short);
    }
    if (a.tester === 'yes') add('CRTEST3C', 3);
    if (a.coloured === 'yes') { add('CR/COLOUR', Number(a.maxColour) > 0 ? Number(a.maxColour) : 1); if (m3 > 0) add('CR/Washout', Math.ceil(m3 / 6)); }
  }
  return out;
}

/* the supply chain impact charge, once for the order: 7.5% of all its Rediwall products */
export function impcFor(lines) {
  const goods = lines.filter((l) => l.category === 'Rediwall'); if (!goods.length) return null;
  const cents = Math.round(goods.reduce((s, l) => s + r2((Number(l.qty) || 0) * (Number(l.price) || 0)), 0) * 100);
  const amt = Math.floor(cents * IMPC_RATE + 0.5 + 1e-9) / 100;
  return amt > 0 ? { key: 'impc', code: 'IMPC', name: 'Supply chain impact charge (7.5%)', unit: 'charge', qty: 1, price: amt, locked: true, cat: 'Rediwall' } : null;
}
