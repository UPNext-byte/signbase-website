// POST /api/quote: combined, multi-product quotation request.
// Emails the business (Reply-To = customer) and sends the customer an acknowledgement, via Resend.
// Env: RESEND_API_KEY (secret), QUOTE_FROM (verified sender), QUOTE_TO (optional), TURNSTILE_SECRET (optional), ALLOWED_ORIGINS (optional)
import { DEFAULT_TO, json, esc, clip, validEmail, validPhone, makeRef, guard, sendEmail, toB64, rowsHtml } from "../../lib/common.js";

const MAX_ITEMS = 20, MAX_FILES = 10, MAX_TOTAL = 8 * 1024 * 1024;
const FILE_TYPES = { "application/pdf": 1, "image/png": 1, "image/jpeg": 1, "image/webp": 1 };
const METHODS = ["WhatsApp", "Phone", "Email"];

export async function onRequestPost({ request, env }) {
  let form;
  try { form = await request.formData(); } catch { return json({ success: false, error: "Invalid form submission." }, 400); }
  const blocked = await guard(request, env, form);
  if (blocked) return blocked;

  const c = { name: clip(form.get("name"), 100), company: clip(form.get("company"), 100), phone: clip(form.get("phone"), 30),
    email: clip(form.get("email"), 120), method: clip(form.get("contact_method"), 20) };
  if (!c.name || !c.phone) return json({ success: false, error: "Please enter your name and phone number." }, 400);
  if (!validEmail(c.email)) return json({ success: false, error: "Please enter a valid email address." }, 400);
  if (!validPhone(c.phone)) return json({ success: false, error: "Please enter a valid phone number." }, 400);
  if (!METHODS.includes(c.method)) return json({ success: false, error: "Please choose a preferred contact method." }, 400);

  let raw; try { raw = JSON.parse(String(form.get("items") || "[]")); } catch { raw = null; }
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_ITEMS) return json({ success: false, error: "Please add at least one product to your quote list." }, 400);
  const items = raw.map(it => ({
    name: clip(it?.name, 150), category: clip(it?.category, 100), qty: clip(it?.qty, 40), notes: clip(it?.notes, 1000),
    specs: Object.entries(it?.specs && typeof it.specs === "object" ? it.specs : {}).slice(0, 15)
      .map(([k, v]) => [clip(k, 80), clip(v, 300)]).filter(([k, v]) => k && v)
  }));
  if (items.some(i => !i.name || !i.qty)) return json({ success: false, error: "Please enter a quantity for every product." }, 400);

  const attachments = []; let total = 0;
  for (const [key, val] of form.entries()) {
    const m = /^file_(\d+)$/.exec(key);
    if (!m || !val || typeof val !== "object" || !val.size) continue;
    if (Number(m[1]) >= items.length) continue;
    if (attachments.length >= MAX_FILES) return json({ success: false, error: "Too many attachments." }, 400);
    total += val.size;
    if (total > MAX_TOTAL) return json({ success: false, error: "Attachments must total 8 MB or less." }, 400);
    if (!FILE_TYPES[val.type]) return json({ success: false, error: "Only PDF, PNG, JPG and WebP files are accepted." }, 400);
    const safe = clip(val.name, 80).replace(/[^\w.\- ]/g, "_") || "file";
    attachments.push({ filename: `item${Number(m[1]) + 1}-${safe}`, content: toB64(await val.arrayBuffer()) });
  }

  const ref = makeRef();
  const cust = [["Reference", ref], ["Name", c.name], ["Company", c.company || "-"], ["Phone", c.phone], ["Email", c.email], ["Preferred contact", c.method]];
  const itemHtml = items.map((i, n) => `<h3 style="margin:18px 0 4px">${n + 1}. ${esc(i.name)}</h3><table>${rowsHtml([
    ["Category", i.category || "-"], ["Quantity", i.qty], ...i.specs, ["Notes", i.notes || "-"]])}</table>`).join("");
  const itemText = items.map((i, n) => `${n + 1}. ${i.name} (${i.category}) qty ${i.qty}\n` + i.specs.map(([k, v]) => `   ${k}: ${v}`).join("\n") + (i.notes ? `\n   Notes: ${i.notes}` : "")).join("\n\n");
  const files = attachments.length ? attachments.map(a => a.filename).join(", ") : "None";
  const to = env.QUOTE_TO || DEFAULT_TO;

  const ok = await sendEmail(env, {
    from: env.QUOTE_FROM, to: [to], reply_to: c.email,
    subject: `Quote request ${ref}: ${items.length} item${items.length > 1 ? "s" : ""} from ${c.name}`,
    html: `<h2>New quotation request</h2><table>${rowsHtml(cust)}</table>${itemHtml}<p><b>Attachments:</b> ${esc(files)}</p>`,
    text: cust.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\n${itemText}\n\nAttachments: ${files}`,
    ...(attachments.length ? { attachments } : {})
  });
  if (!ok) return json({ success: false, error: "We could not send your request. Please try again." }, 502);

  const ack = await sendEmail(env, {
    from: env.QUOTE_FROM, to: [c.email], reply_to: to,
    subject: `We received your quotation request (${ref}) - Sign Base`,
    html: `<p>Hi ${esc(c.name)},</p><p>Thank you for choosing Sign Base! Your quotation request <b>${ref}</b> has been received. Our team will review your requirements and get back to you via ${esc(c.method)}.</p>${itemHtml}<p>Need us sooner? WhatsApp or call <b>72300430</b>.</p><p>Sign Base</p>`,
    text: `Hi ${c.name},\n\nThank you for choosing Sign Base! Your quotation request ${ref} has been received. Our team will review your requirements and get back to you via ${c.method}.\n\n${itemText}\n\nNeed us sooner? WhatsApp or call 72300430.\n\nSign Base`
  });
  return json({ success: true, ref, acknowledged: ack });
}
export const onRequest = () => json({ success: false, error: "Method not allowed." }, 405);
