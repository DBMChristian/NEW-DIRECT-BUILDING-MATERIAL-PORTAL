/* EmailJS: Direct's own service and template ("DIRECT BUILDING": to_email, cc_email, bcc_email, subject, html_body), in the
   EmailJS account OrderConcrete uses (its public key). .env can point elsewhere:
   VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID, VITE_EMAILJS_PUBLIC_KEY. */
const SERVICE = import.meta.env.VITE_EMAILJS_SERVICE_ID || 'Service_DirectBuilding';   /* Direct's own service and template (13 Nov 2026): from orders@directbuildingmaterial.com.au */
const TEMPLATE = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || 'template_958phqr';
const KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || 'CPotC9kqZTuvNMe4F';
export const emailReady = Boolean(SERVICE && TEMPLATE && KEY);
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
  const portal = window.location.origin;
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
