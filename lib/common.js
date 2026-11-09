// Shared helpers for Cloudflare Pages Functions (quote + contact).
export const DEFAULT_TO = "salessignbase1@gmail.com";
const MIN_FILL_MS = 3000, MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);
export const validEmail = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(e);
export const validPhone = p => /^[+0-9 ()-]{7,30}$/.test(p);
export const makeRef = () => "SB-" + Date.now().toString(36).toUpperCase().slice(-6);

export function originOk(request, env) {
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

// Returns a Response if the request must stop here, otherwise null.
export async function guard(request, env, form) {
  if (!originOk(request, env)) return json({ success: false, error: "Request blocked." }, 403);
  if (!env.RESEND_API_KEY || !env.QUOTE_FROM) {
    console.error("Missing RESEND_API_KEY or QUOTE_FROM");
    return json({ success: false, error: "This service is not available right now." }, 500);
  }
  if (form.get("website")) return json({ success: true, ref: "SB-0000" }); // honeypot: pretend success, send nothing
  const age = Date.now() - Number(form.get("ts"));
  if (!(age >= MIN_FILL_MS && age <= MAX_AGE_MS)) return json({ success: false, error: "Please wait a moment and submit the form again." }, 429);
  if (!(await turnstileOk(env, form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP"))))
    return json({ success: false, error: "Spam check failed. Please refresh and try again." }, 403);
  return null;
}

export async function sendEmail(env, payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) console.error("Resend error", r.status, await r.text().catch(() => ""));
  return r.ok;
}

export const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const rowsHtml = rows => rows.map(([k, v]) => `<tr><td style="padding:5px 12px;font-weight:bold;vertical-align:top">${esc(k)}</td><td style="padding:5px 12px;white-space:pre-wrap">${esc(v)}</td></tr>`).join("");
