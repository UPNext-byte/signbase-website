import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as quote } from "../functions/api/quote.js";
import { onRequestPost as contact } from "../functions/api/contact.js";

const env = { RESEND_API_KEY: "re_test", QUOTE_FROM: "Sign Base <q@example.com>" };
let sent;
globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };

const ITEMS = [
  { name: "Bubble stickers", category: "Stickers & Labels", qty: "50", notes: "Round", specs: { Dimensions: "10 cm", Shape: "Round" } },
  { name: "Vehicle branding", category: "Vehicle Branding", qty: "2", notes: "", specs: { "Vehicle type": "Bakkie <b>x</b>" } }
];
function make(handler, fields, { origin = "https://site.test", files = [] } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  for (const [k, f] of files) fd.append(k, f);
  return { request: new Request("https://site.test/api/x", { method: "POST", body: fd, headers: origin ? { Origin: origin } : {} }), env };
}
const Q = (over = {}, opts) => make(quote, { name: "Thabo", phone: "72300430", email: "thabo@example.com", contact_method: "WhatsApp",
  items: JSON.stringify(ITEMS), ts: String(Date.now() - 10000), ...over }, opts);
const C = (over = {}, opts) => make(contact, { name: "Thabo", phone: "72300430", email: "thabo@example.com", service: "Number Plates",
  message: "Hello", ts: String(Date.now() - 10000), ...over }, opts);
const run = async (fn, req) => { sent = []; const r = await fn(req); return [r.status, await r.json()]; };

test("multi-item quote sends business + customer emails with specs", async () => {
  const [s, j] = await run(quote, Q());
  assert.equal(s, 200); assert.ok(j.success); assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body.to, ["salessignbase1@gmail.com"]); assert.equal(sent[0].body.reply_to, "thabo@example.com");
  assert.ok(sent[0].body.html.includes("Bubble stickers") && sent[0].body.html.includes("Vehicle branding") && sent[0].body.html.includes("Shape"));
  assert.ok(!sent[0].body.html.includes("<b>x</b>"), "html escaped");
  assert.deepEqual(sent[1].body.to, ["thabo@example.com"]);
});
test("QUOTE_TO overrides recipient", async () => { sent = []; const r = Q(); r.env = { ...env, QUOTE_TO: "me@test.com" }; await quote(r); assert.deepEqual(sent[0].body.to, ["me@test.com"]); });
test("attachments are forwarded and tagged with item number", async () => {
  const [s] = await run(quote, Q({}, { files: [["file_1", new File(["x"], "car.png", { type: "image/png" })]] }));
  assert.equal(s, 200); assert.equal(sent[0].body.attachments[0].filename, "item2-car.png");
});
test("rejects bad file type and oversize", async () => {
  assert.equal((await run(quote, Q({}, { files: [["file_0", new File(["x"], "a.exe", { type: "application/x-msdownload" })]] })))[0], 400);
  assert.equal((await run(quote, Q({}, { files: [["file_0", new File([new Uint8Array(8.5 * 1024 * 1024)], "a.pdf", { type: "application/pdf" })]] })))[0], 400);
});
test("validation: no items, bad items JSON, missing qty, bad email, bad method", async () => {
  assert.equal((await run(quote, Q({ items: "[]" })))[0], 400);
  assert.equal((await run(quote, Q({ items: "nope" })))[0], 400);
  assert.equal((await run(quote, Q({ items: JSON.stringify([{ name: "X", qty: "" }]) })))[0], 400);
  assert.equal((await run(quote, Q({ email: "bad" })))[0], 400);
  assert.equal((await run(quote, Q({ contact_method: "Pigeon" })))[0], 400);
});
test("origin, honeypot, timing", async () => {
  assert.equal((await run(quote, Q({}, { origin: "https://evil.test" })))[0], 403);
  assert.equal((await run(quote, Q({}, { origin: null })))[0], 403);
  const [s] = await run(quote, Q({ website: "spam" })); assert.equal(s, 200); assert.equal(sent.length, 0);
  assert.equal((await run(quote, Q({ ts: String(Date.now()) })))[0], 429);
});
test("business email failure returns error (no false success)", async () => {
  sent = []; const f = globalThis.fetch; globalThis.fetch = async () => new Response("{}", { status: 500 });
  const r = await quote(Q()); globalThis.fetch = f; assert.equal(r.status, 502); assert.equal((await r.json()).success, false);
});
test("contact: valid enquiry and validation", async () => {
  const [s, j] = await run(contact, C()); assert.equal(s, 200); assert.ok(j.success); assert.equal(sent.length, 2);
  assert.equal((await run(contact, C({ message: "" })))[0], 400);
  assert.equal((await run(contact, C({ email: "x" })))[0], 400);
  assert.equal((await run(contact, C({}, { origin: "https://evil.test" })))[0], 403);
});
