/* EmailJS: Direct's own service and template ("DIRECT BUILDING": to_email, cc_email, bcc_email, subject, html_body), in the
   EmailJS account OrderConcrete uses (its public key). .env can point elsewhere:
   VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID, VITE_EMAILJS_PUBLIC_KEY. */
const SERVICE = import.meta.env.VITE_EMAILJS_SERVICE_ID || 'Service_DirectBuilding';   /* Direct's own service and template (13 Nov 2026): from orders@directbuildingmaterial.com.au */
const TEMPLATE = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || 'template_958phqr';
const KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || 'CPotC9kqZTuvNMe4F';
export const emailReady = Boolean(SERVICE && TEMPLATE && KEY);
/* the address the email's "Sign in to the portal" button opens: the portal's real address (VITE_PORTAL_URL in .env and
   Netlify), never the computer it was sent from (localhost would not open for them) */
export const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL || 'https://portal.directbuildingmaterial.com.au').replace(/\/$/, '');   /* the domain moves to Netlify later (13 Nov 2026) */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* the login details, in Direct's look: the dark header with the red DIRECT mark, the email, the password, the button */
function loginHtml({ email, name, password, reset, portal }) {
  return '<div style="background:#F4F2EE;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1E1A17"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">'
    + '<tr><td style="background:#1E1A17;padding:18px 24px;border-bottom:4px solid #B91C1C"><span style="display:inline-block;background:#B91C1C;color:#fff;font-weight:900;font-size:16px;letter-spacing:1px;padding:4px 9px;border-radius:3px">DIRECT</span> <span style="color:#A8A29E;font-size:10px;font-weight:bold;letter-spacing:2px;margin-left:6px">BUILDING MATERIAL</span></td></tr>'
    + '<tr><td style="padding:24px"><div style="font-size:20px;font-weight:bold;margin-bottom:8px">' + (reset ? 'Your new password' : 'Your portal login') + '</div>'
    + '<div style="font-size:14px;line-height:1.6;color:#44403C">Hi ' + esc(name || email.split('@')[0]) + ',<br>' + (reset ? 'Your password for the Direct Building Material portal was reset.' : 'You now have a login for the Direct Building Material portal.') + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#FAFAF9;border:1px solid #E7E5E4;border-radius:8px"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8">'
    + '<div><span style="color:#78716C;font-size:11px;letter-spacing:1px">EMAIL</span><br><b>' + esc(email) + '</b></div>'
    + '<div style="margin-top:6px"><span style="color:#78716C;font-size:11px;letter-spacing:1px">TEMPORARY PASSWORD</span><br><b style="font-family:Consolas,monospace;font-size:16px">' + esc(password) + '</b></div></td></tr></table>'
    + '<a href="' + esc(portal) + '" style="display:inline-block;background:#B91C1C;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 20px;border-radius:6px">Sign in to the portal</a>'
    + '<div style="font-size:12px;color:#78716C;margin-top:16px">You will be asked to choose your own password the first time you sign in.</div></td></tr>'
    + '<tr><td style="background:#1E1A17;color:#D6D3D1;font-size:11px;padding:12px 24px;text-align:center">Direct Building Material · 16 Cassola Place, Penrith NSW 2750</td></tr></table></td></tr></table></div>';
}
export async function sendLoginEmail({ email, name, password, reset }) {
  if (!PORTAL_URL) throw new Error('the portal has no web address yet (VITE_PORTAL_URL): the email would link to this computer');
  const portal = PORTAL_URL;
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: SERVICE, template_id: TEMPLATE, user_id: KEY, template_params: {
      to_email: email, cc_email: '', bcc_email: '', subject: reset ? 'Your new Direct portal password' : 'Your Direct portal login',
      html_body: loginHtml({ email, name, password, reset, portal }) } }) });
  if (!r.ok) throw new Error('EmailJS: ' + ((await r.text()) || r.status));
}
export function tempPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789', pick = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 4 }, () => pick(a + d)).join('') + pick(d) + pick(a) + '-' + Array.from({ length: 4 }, () => pick(a)).join('');
}

/* any email through Direct's template (to, cc, subject, the HTML body) */
export async function sendEmail({ to, cc = '', bcc = '', subject, html }) {
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: SERVICE, template_id: TEMPLATE, user_id: KEY, template_params: { to_email: to, cc_email: cc, bcc_email: bcc, subject, html_body: html } }) });
  if (!r.ok) throw new Error('EmailJS: ' + ((await r.text()) || r.status));
}

/* the PO email to a supplier (13 Nov 2026), as the previous portal's: Direct's header, the PO number, where and when it
   goes, Direct's own lines (code, description, quantity), no prices, the note, and who to contact */
export function poEmailHtml({ po, supplier, portal, order, customer, deliverTo, site, date, time, fulfil, contact, lines, charges = [], questions = [], note }) {
  const row = (l) => '<tr><td style="padding:8px 10px;border-top:1px solid #E7E5E4;font-family:Consolas,monospace;font-size:12px;color:#57534E">' + esc(l.code) + '</td><td style="padding:8px 10px;border-top:1px solid #E7E5E4;font-size:13px">' + esc(l.name) + '</td><td style="padding:8px 10px;border-top:1px solid #E7E5E4;font-size:13px;text-align:right;font-weight:bold">' + esc(l.qty) + ' ' + esc(l.unit || '') + '</td></tr>';
  const kv = (k, v) => (v ? '<tr><td style="padding:3px 0;color:#78716C;font-size:12px;width:130px">' + k + '</td><td style="padding:3px 0;font-size:13px;font-weight:bold">' + esc(v) + '</td></tr>' : '');
  const where = deliverTo === 'penrith' ? 'Direct Building Material, 16 Cassola Place, Penrith NSW 2750' : site;
  return '<div style="background:#F4F2EE;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1E1A17"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:10px;overflow:hidden">'
    + '<tr><td style="background:#1E1A17;padding:18px 24px;border-bottom:4px solid #B91C1C"><span style="display:inline-block;background:#B91C1C;color:#fff;font-weight:900;font-size:16px;letter-spacing:1px;padding:4px 9px;border-radius:3px">DIRECT</span> <span style="color:#A8A29E;font-size:10px;font-weight:bold;letter-spacing:2px;margin-left:6px">BUILDING MATERIAL</span></td></tr>'
    + '<tr><td style="padding:22px 24px"><div style="font-size:12px;color:#78716C;letter-spacing:1px">PURCHASE ORDER' + (portal ? ' · ' + esc(portal) : '') + '</div><div style="font-size:24px;font-weight:bold;margin:2px 0 4px">' + esc(po || 'PO (numbered on placing: PO-' + 'order number)') + '</div>'
    + '<div style="font-size:14px;color:#44403C">To <b>' + esc(supplier) + '</b> · for order ' + esc(order || '') + '</div>'
    + '<div style="margin-top:10px"><span style="display:inline-block;background:' + (fulfil === 'pickup' ? '#1D4ED8' : '#15803D') + ';color:#fff;font-weight:bold;font-size:13px;letter-spacing:1px;padding:5px 12px;border-radius:4px">' + (fulfil === 'pickup' ? 'PICK-UP' : 'DELIVERY') + '</span></div>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;background:#FAFAF9;border:1px solid #E7E5E4;border-radius:8px"><tr><td style="padding:12px 14px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">'
    + kv(fulfil === 'pickup' ? 'Pick-up' : 'Deliver to', fulfil === 'pickup' ? 'Collected from you (by Direct or the customer)' : where) + kv('Date', date) + kv('Time', time) + kv('Site contact', contact) + kv('Customer', customer)
    + '</table></td></tr></table>'
    + (questions.length ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px"><tr><td style="padding:10px 14px">' + questions.map((g) => '<div style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#92400E;margin:2px 0 4px">' + esc(g.title.toUpperCase()) + '</div><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">' + g.items.map(([k, v]) => kv(k, v)).join('') + '</table>').join('') + '</td></tr></table>' : '')
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E7E5E4;border-radius:8px;overflow:hidden"><tr style="background:#F5F5F4"><th align="left" style="padding:8px 10px;font-size:11px;color:#57534E">CODE</th><th align="left" style="padding:8px 10px;font-size:11px;color:#57534E">DESCRIPTION</th><th align="right" style="padding:8px 10px;font-size:11px;color:#57534E">QTY</th></tr>' + lines.map(row).join('')
    + (charges.length ? '<tr><td colspan="3" style="padding:7px 10px;background:#FAFAF9;border-top:1px solid #E7E5E4;font-size:10.5px;font-weight:bold;letter-spacing:1px;color:#78716C">ADDITIONAL CHARGES</td></tr>' + charges.map(row).join('') : '') + '</table>'
    + (note ? '<div style="margin-top:14px;background:#FEF2F2;border-left:4px solid #DC2626;padding:10px 12px;font-size:13px"><b>Note:</b> ' + esc(note) + '</div>' : '')
    + '<div style="font-size:12px;color:#78716C;margin-top:16px">Please confirm by replying to this email. Questions: orders@directbuildingmaterial.com.au</div></td></tr>'
    + '<tr><td style="background:#1E1A17;color:#D6D3D1;font-size:11px;padding:12px 24px;text-align:center">Direct Building Material · 16 Cassola Place, Penrith NSW 2750</td></tr></table></td></tr></table></div>';
}

/* the order confirmation to the customer (13 Nov 2026): Direct's look, the order number, the site and days, the lines
   with their prices and the total */
export function orderEmailHtml({ number, customer, contact, site, loads, groups, subtotal, gst, total }) {
  const money = (v) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (l) => '<tr><td style="padding:6px 10px;border-top:1px solid #E7E5E4;font-size:13px">' + esc(l.name) + '</td><td style="padding:6px 10px;border-top:1px solid #E7E5E4;font-size:13px;text-align:right">' + esc(l.qty) + '</td><td style="padding:6px 10px;border-top:1px solid #E7E5E4;font-size:13px;text-align:right">' + money(l.qty * l.price) + '</td></tr>';
  return '<div style="background:#F4F2EE;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1E1A17"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:10px;overflow:hidden">'
    + '<tr><td style="background:#1E1A17;padding:18px 24px;border-bottom:4px solid #B91C1C"><span style="display:inline-block;background:#B91C1C;color:#fff;font-weight:900;font-size:16px;letter-spacing:1px;padding:4px 9px;border-radius:3px">DIRECT</span> <span style="color:#A8A29E;font-size:10px;font-weight:bold;letter-spacing:2px;margin-left:6px">BUILDING MATERIAL</span></td></tr>'
    + '<tr><td style="padding:22px 24px"><div style="font-size:12px;color:#78716C;letter-spacing:1px">ORDER CONFIRMATION</div><div style="font-size:24px;font-weight:bold;margin:2px 0 6px">' + esc(number) + '</div>'
    + '<div style="font-size:14px;color:#44403C">Hi ' + esc(contact || customer) + ', thank you for your order.</div>'
    + '<div style="margin:14px 0;background:#FAFAF9;border:1px solid #E7E5E4;border-radius:8px;padding:10px 14px;font-size:13px;line-height:1.7"><b>Site:</b> ' + esc(site) + '<br>' + loads.map((l) => '<b>' + esc(l.what) + ':</b> ' + esc(l.when)).join('<br>') + '</div>'
    + groups.map((g) => '<div style="margin-top:10px;font-size:12px;font-weight:bold;letter-spacing:1px;color:#57534E">' + esc(g.title.toUpperCase()) + '</div><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E7E5E4;border-radius:6px;overflow:hidden">' + g.lines.map(row).join('') + '</table>').join('')
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:12px;font-size:13px"><tr><td style="text-align:right;color:#57534E">Ex GST</td><td style="text-align:right;width:120px">' + money(subtotal) + '</td></tr><tr><td style="text-align:right;color:#57534E">GST</td><td style="text-align:right">' + money(gst) + '</td></tr><tr><td style="text-align:right;font-weight:bold">Total</td><td style="text-align:right;font-weight:bold;font-size:16px">' + money(total) + '</td></tr></table>'
    + '<div style="font-size:12px;color:#78716C;margin-top:16px">Questions: reply to this email or call Direct Building Material.</div></td></tr>'
    + '<tr><td style="background:#1E1A17;color:#D6D3D1;font-size:11px;padding:12px 24px;text-align:center">Direct Building Material · 16 Cassola Place, Penrith NSW 2750</td></tr></table></td></tr></table></div>';
}

/* the tax invoice, made by the portal (13 Nov 2026): to print (PDF) or email to the customer; Xero is not touched */
export function invoiceHtml({ inv, order, date, due, customer, contact, email, site, theirPo, groups, subtotal, gst, total, paid, company = {} }) {
  const m = (v) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const owing = Math.round((Number(total) - Number(paid || 0)) * 100) / 100;
  const row = (l) => '<tr><td style="padding:6px 8px;border-bottom:1px solid #E7E5E4">' + esc(l.name) + (l.code ? '<div style="font-size:10px;color:#78716C">' + esc(l.code) + '</div>' : '') + '</td><td style="padding:6px 8px;border-bottom:1px solid #E7E5E4;text-align:right">' + esc(l.qty) + '</td><td style="padding:6px 8px;border-bottom:1px solid #E7E5E4;text-align:right">' + m(l.price) + '</td><td style="padding:6px 8px;border-bottom:1px solid #E7E5E4;text-align:right">' + m(l.qty * l.price) + '</td></tr>';
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1E1A17;max-width:760px;margin:0 auto;padding:24px;font-size:12.5px">'
    + '<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top">'
    + (company.logo ? '<img src="' + esc(company.logo) + '" alt="DIRECT BUILDING MATERIAL" width="190" style="display:block;width:190px;height:auto;border:0">' : '<span style="display:inline-block;background:#B91C1C;color:#fff;font-weight:900;font-size:18px;letter-spacing:1px;padding:5px 10px;border-radius:3px">DIRECT</span> <span style="color:#57534E;font-size:10px;font-weight:bold;letter-spacing:2px">BUILDING MATERIAL</span>')
    + '<div style="margin-top:10px;line-height:1.55;color:#44403C"><b style="color:#1E1A17;font-size:13.5px">' + esc(company.name || 'Direct Building Material') + '</b><br>' + esc(company.address || '16 Cassola Place, Penrith NSW') + '<br>ABN ' + esc(company.abn || '23 675 244 694') + (company.email ? '<br>' + esc(company.email) : '') + '</div></td>'
    + '<td style="vertical-align:top;text-align:right"><div style="font-size:22px;font-weight:bold">TAX INVOICE</div><div style="font-size:16px;font-weight:bold;margin-top:2px">' + esc(inv) + '</div>'
    + '<div style="margin-top:8px;line-height:1.6;color:#44403C">Date: <b>' + esc(date) + '</b><br>Due: <b>' + esc(due) + '</b><br>Order: <b>' + esc(order) + '</b>' + (theirPo ? '<br>Your PO: <b>' + esc(theirPo) + '</b>' : '') + '</div></td></tr></table>'
    + '<table style="width:100%;margin:18px 0;border-collapse:collapse"><tr><td style="vertical-align:top;width:50%"><div style="font-size:10px;letter-spacing:1px;color:#78716C;font-weight:bold">BILL TO</div><div style="margin-top:3px;line-height:1.5"><b>' + esc(customer) + '</b>' + (contact ? '<br>' + esc(contact) : '') + (email ? '<br>' + esc(email) : '') + '</div></td>'
    + '<td style="vertical-align:top"><div style="font-size:10px;letter-spacing:1px;color:#78716C;font-weight:bold">DELIVER TO</div><div style="margin-top:3px;line-height:1.5">' + esc(site) + '</div></td></tr></table>'
    + '<table style="width:100%;border-collapse:collapse"><tr style="background:#F5F5F4"><th style="padding:7px 8px;text-align:left;font-size:10.5px;color:#57534E">DESCRIPTION</th><th style="padding:7px 8px;text-align:right;font-size:10.5px;color:#57534E">QTY</th><th style="padding:7px 8px;text-align:right;font-size:10.5px;color:#57534E">UNIT EX GST</th><th style="padding:7px 8px;text-align:right;font-size:10.5px;color:#57534E">AMOUNT EX GST</th></tr>'
    + groups.map((g) => { const its = g.lines.filter((l) => !l.charge), chs = g.lines.filter((l) => l.charge), sum = g.lines.reduce((t, l) => t + l.qty * l.price, 0);
      const sub = (t) => '<tr><td colspan="4" style="padding:5px 8px 3px 14px;font-size:9.5px;font-weight:bold;letter-spacing:1px;color:#A8A29E">' + t + '</td></tr>';
      return '<tr><td colspan="3" style="padding:12px 8px 4px;font-size:11px;font-weight:bold;letter-spacing:1px;color:#1E1A17;border-bottom:2px solid #1E1A17">' + esc(g.title.toUpperCase()) + '</td><td style="padding:12px 8px 4px;text-align:right;font-size:11px;font-weight:bold;border-bottom:2px solid #1E1A17">' + m(sum) + '</td></tr>'
        + (its.length ? sub('ITEMS') + its.map(row).join('') : '') + (chs.length ? sub('ADDITIONAL CHARGES') + chs.map(row).join('') : ''); }).join('') + '</table>'
    + '<table style="width:300px;margin:14px 0 0 auto;border-collapse:collapse;font-size:13px"><tr><td style="padding:3px 0;color:#57534E">Subtotal</td><td style="text-align:right">' + m(subtotal) + '</td></tr><tr><td style="padding:3px 0;color:#57534E">GST</td><td style="text-align:right">' + m(gst) + '</td></tr>'
    + '<tr><td style="padding:5px 0;font-weight:bold;border-top:1px solid #1E1A17">Total inc GST</td><td style="text-align:right;font-weight:bold;border-top:1px solid #1E1A17">' + m(total) + '</td></tr>'
    + (Number(paid) > 0 ? '<tr><td style="padding:3px 0;color:#57534E">Paid</td><td style="text-align:right">−' + m(paid) + '</td></tr>' : '')
    + '<tr><td style="padding:6px 0;font-weight:bold;font-size:15px;color:' + (owing > 0 ? '#B91C1C' : '#15803D') + '">' + (owing > 0 ? 'Amount due' : 'Paid in full') + '</td><td style="text-align:right;font-weight:bold;font-size:15px;color:' + (owing > 0 ? '#B91C1C' : '#15803D') + '">' + m(Math.max(owing, 0)) + '</td></tr></table>'
    + (company.bank ? '<div style="margin-top:18px;padding:10px 12px;background:#FAFAF9;border:1px solid #E7E5E4;border-radius:6px;font-size:12px"><b>How to pay:</b> ' + esc(company.bank) + ' · Reference: ' + esc(inv) + '</div>' : '')
    + '<div style="margin-top:22px;font-size:11px;color:#78716C;text-align:center">Thank you for your business · Direct Building Material</div></div>';
}

/* the booking confirmation to the customer (13 Nov 2026): Direct's logo, the order, the site, and each load's booked
   day and time */
export function bookingEmailHtml({ number, customer, contact, site, loads, logo }) {
  return '<div style="background:#F4F2EE;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1E1A17"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden">'
    + '<tr><td style="padding:18px 24px;border-bottom:4px solid #B91C1C">' + (logo ? '<img src="' + esc(logo) + '" alt="DIRECT BUILDING MATERIAL" width="170" style="display:block;width:170px;height:auto;border:0">' : '<b style="font-size:18px;color:#B91C1C">DIRECT</b> BUILDING MATERIAL') + '</td></tr>'
    + '<tr><td style="padding:22px 24px"><div style="font-size:12px;color:#78716C;letter-spacing:1px">BOOKING CONFIRMATION</div><div style="font-size:24px;font-weight:bold;margin:2px 0 8px">' + esc(number) + '</div>'
    + '<div style="font-size:14px;color:#44403C;line-height:1.6">Hi ' + esc(contact || customer) + ', your order is booked.</div>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border:1px solid #E7E5E4;border-radius:8px;overflow:hidden">'
    + loads.map((l) => '<tr><td style="padding:10px 14px;border-top:1px solid #F0EEEA;font-size:13px"><b>' + esc(l.what) + '</b><br><span style="color:#57534E">' + esc(l.items) + '</span></td><td style="padding:10px 14px;border-top:1px solid #F0EEEA;font-size:14px;font-weight:bold;text-align:right;white-space:nowrap">' + esc(l.when) + '</td></tr>').join('')
    + '</table><div style="font-size:13px;line-height:1.6"><b>Site:</b> ' + esc(site) + '</div>'
    + '<div style="font-size:12px;color:#78716C;margin-top:16px">Please make sure the site is ready and accessible. Questions or changes: reply to this email.</div></td></tr>'
    + '<tr><td style="background:#1E1A17;color:#D6D3D1;font-size:11px;padding:12px 24px;text-align:center">Direct Building Material · 16 Cassola Place, Penrith NSW · ABN 23 675 244 694</td></tr></table></td></tr></table></div>';
}
