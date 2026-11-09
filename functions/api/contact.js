// POST /api/contact: general enquiry (not a quotation). Emails the business and acknowledges the customer.
import { DEFAULT_TO, json, esc, clip, validEmail, validPhone, makeRef, guard, sendEmail, rowsHtml } from "../../lib/common.js";

export async function onRequestPost({ request, env }) {
  let form;
  try { form = await request.formData(); } catch { return json({ success: false, error: "Invalid form submission." }, 400); }
  const blocked = await guard(request, env, form);
  if (blocked) return blocked;

  const f = { name: clip(form.get("name"), 100), company: clip(form.get("company"), 100), phone: clip(form.get("phone"), 30),
    email: clip(form.get("email"), 120), service: clip(form.get("service"), 150), message: clip(form.get("message"), 3000) };
  if (!f.name || !f.phone || !f.service || !f.message) return json({ success: false, error: "Please complete all required fields." }, 400);
  if (!validEmail(f.email)) return json({ success: false, error: "Please enter a valid email address." }, 400);
  if (!validPhone(f.phone)) return json({ success: false, error: "Please enter a valid phone number." }, 400);

  const ref = makeRef(), to = env.QUOTE_TO || DEFAULT_TO;
  const rows = [["Reference", ref], ["Name", f.name], ["Company", f.company || "-"], ["Phone", f.phone], ["Email", f.email], ["Service required", f.service], ["Message", f.message]];
  const ok = await sendEmail(env, { from: env.QUOTE_FROM, to: [to], reply_to: f.email, subject: `Website enquiry ${ref}: ${f.service}`,
    html: `<h2>New website enquiry</h2><table>${rowsHtml(rows)}</table>`, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") });
  if (!ok) return json({ success: false, error: "We could not send your message. Please try again." }, 502);
  const ack = await sendEmail(env, { from: env.QUOTE_FROM, to: [f.email], reply_to: to, subject: `We received your enquiry (${ref}) - Sign Base`,
    html: `<p>Hi ${esc(f.name)},</p><p>Thank you for contacting Sign Base. We have received your message and will get back to you shortly.</p><table>${rowsHtml(rows)}</table><p>Need us sooner? WhatsApp or call <b>72300430</b>.</p>`,
    text: `Hi ${f.name},\n\nThank you for contacting Sign Base. We received your message (${ref}) and will get back to you shortly.\n\nWhatsApp or call 72300430.` });
  return json({ success: true, ref, acknowledged: ack });
}
export const onRequest = () => json({ success: false, error: "Method not allowed." }, 405);
