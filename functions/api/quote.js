// Cloudflare Pages Function: POST /api/quote
// Validates a quote request, emails the business, and emails an acknowledgement to the customer (via Resend).
//
// Environment (Pages > Settings > Variables and Secrets):
//   RESEND_API_KEY   (secret, required)
//   QUOTE_FROM       (required in production) e.g. "Sign Base <quotes@yourdomain.com>", domain verified in Resend
//   QUOTE_TO         (optional) defaults to salessignbase1@gmail.com
//   TURNSTILE_SECRET (optional secret) enables Cloudflare Turnstile verification
//   ALLOWED_ORIGINS  (optional) comma-separated extra origins, e.g. "https://www.signbase.co.bw"

const DEFAULT_TO = "salessignbase1@gmail.com";
const MAX_FILES = 3, MAX_TOTAL = 5 * 1024 * 1024;
const FILE_TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MIN_FILL_MS = 3000, MAX_AGE_MS = 6 * 60 * 60 * 1000;

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);

function originOk(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin, ...(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean)]);
  return allowed.has(origin);
}

async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET); body.append("response", token); if (ip) body.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  return !!(await r.json()).success;
}

async function sendEmail(env, payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) console.error("Resend error", r.status, await r.text().catch(() => ""));
  return r.ok;
}

const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

export async function onRequestPost({ request, env }) {
  if (!originOk(request, env)) return json({ success: false, error: "Request blocked." }, 403);
  if (!env.RESEND_API_KEY || !env.QUOTE_FROM) {
    console.error("Missing RESEND_API_KEY or QUOTE_FROM");
    return json({ success: false, error: "The quote service is not available right now." }, 500);
  }
  let form;
  try { form = await request.formData(); } catch { return json({ success: false, error: "Invalid form submission." }, 400); }

  // Spam checks: honeypot and timing
  if (form.get("website")) return json({ success: true, ref: "SB-0000" }); // silently drop bots
  const age = Date.now() - Number(form.get("ts"));
  if (!(age >= MIN_FILL_MS && age <= MAX_AGE_MS)) return json({ success: false, error: "Please wait a moment and submit the form again." }, 429);
  if (!(await turnstileOk(env, form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP"))))
    return json({ success: false, error: "Spam check failed. Please refresh and try again." }, 403);

  const f = {
    name: clip(form.get("name"), 100), company: clip(form.get("company"), 100), email: clip(form.get("email"), 120),
    phone: clip(form.get("phone"), 30), category: clip(form.get("category"), 150), quantity: clip(form.get("quantity"), 80),
    dimensions: clip(form.get("dimensions"), 200), description: clip(form.get("description"), 3000)
  };
  if (!f.name || !f.phone || !f.quantity || !f.description || !f.category) return json({ success: false, error: "Please complete all required fields." }, 400);
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(f.email)) return json({ success: false, error: "Please enter a valid email address." }, 400);
  if (!/^[+0-9 ()-]{7,30}$/.test(f.phone)) return json({ success: false, error: "Please enter a valid contact number." }, 400);

  // Attachments
  const files = form.getAll("files").filter(x => x && typeof x === "object" && x.size > 0);
  if (files.length > MAX_FILES) return json({ success: false, error: "Please attach no more than 3 files." }, 400);
  let total = 0; const attachments = [];
  for (const file of files) {
    total += file.size;
    if (total > MAX_TOTAL) return json({ success: false, error: "Attachments must total 5 MB or less." }, 400);
    if (!FILE_TYPES[file.type]) return json({ success: false, error: "Only PDF, PNG, JPG and WebP files are accepted." }, 400);
    const safe = clip(file.name, 80).replace(/[^\w.\- ]/g, "_") || `file.${FILE_TYPES[file.type]}`;
    attachments.push({ filename: safe, content: toB64(await file.arrayBuffer()) });
  }

  const ref = "SB-" + Date.now().toString(36).toUpperCase().slice(-6);
  const rows = [["Reference", ref], ["Name", f.name], ["Company", f.company || "-"], ["Email", f.email], ["Phone", f.phone],
    ["Category", f.category], ["Quantity", f.quantity], ["Dimensions", f.dimensions || "-"], ["Description", f.description],
    ["Attachments", attachments.length ? attachments.map(a => a.filename).join(", ") : "None"]];
  const table = rows.map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:bold;vertical-align:top">${esc(k)}</td><td style="padding:6px 12px;white-space:pre-wrap">${esc(v)}</td></tr>`).join("");

  const business = await sendEmail(env, {
    from: env.QUOTE_FROM, to: [env.QUOTE_TO || DEFAULT_TO], reply_to: f.email,
    subject: `Quote request ${ref}: ${f.category}`,
    html: `<h2>New quote request</h2><table>${table}</table>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    ...(attachments.length ? { attachments } : {})
  });
  if (!business) return json({ success: false, error: "We could not send your request. Please try again." }, 502);

  // Customer acknowledgement (failure here does not fail the request)
  const ack = await sendEmail(env, {
    from: env.QUOTE_FROM, to: [f.email], reply_to: env.QUOTE_TO || DEFAULT_TO,
    subject: `We received your quote request (${ref}) - Sign Base`,
    html: `<p>Hi ${esc(f.name)},</p><p>Thank you for contacting Sign Base. We have received your quote request <b>${ref}</b> for <b>${esc(f.category)}</b> and will get back to you shortly.</p><p>Need us sooner? WhatsApp or call <b>72300430</b>.</p><table>${table}</table><p>Sign Base</p>`,
    text: `Hi ${f.name},\n\nThank you for contacting Sign Base. We received your quote request ${ref} for ${f.category} and will get back to you shortly.\nNeed us sooner? WhatsApp or call 72300430.\n\nSign Base`
  });
  return json({ success: true, ref, acknowledged: ack });
}

export const onRequest = () => json({ success: false, error: "Method not allowed." }, 405);
