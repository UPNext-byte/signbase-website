import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/quote.js";

const env = { RESEND_API_KEY: "re_test", QUOTE_FROM: "Sign Base <q@example.com>" };
let sent;
globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };

function req(fields = {}, { origin = "https://site.test", files = [] } = {}) {
  const fd = new FormData();
  const base = { name: "Thabo", email: "thabo@example.com", phone: "72300430", category: "Signage", quantity: "2",
    description: "Two shop signs <b>x</b>", ts: String(Date.now() - 10000), ...fields };
  for (const [k, v] of Object.entries(base)) if (v !== undefined) fd.append(k, v);
  for (const f of files) fd.append("files", f);
  const headers = origin ? { Origin: origin } : {};
  return { request: new Request("https://site.test/api/quote", { method: "POST", body: fd, headers }), env };
}
const run = async (...a) => { sent = []; const r = await onRequestPost(req(...a)); return [r.status, await r.json()]; };

test("valid request sends business + customer emails", async () => {
  const [s, j] = await run();
  assert.equal(s, 200); assert.ok(j.success); assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body.to, ["salessignbase1@gmail.com"]); assert.equal(sent[0].body.reply_to, "thabo@example.com");
  assert.deepEqual(sent[1].body.to, ["thabo@example.com"]);
  assert.ok(!sent[0].body.html.includes("<b>x</b>"), "html must be escaped");
});
test("attachments are forwarded", async () => {
  const [s] = await run({}, { files: [new File(["%PDF-1"], "art.pdf", { type: "application/pdf" })] });
  assert.equal(s, 200); assert.equal(sent[0].body.attachments[0].filename, "art.pdf");
});
test("rejects bad file type", async () => { const [s] = await run({}, { files: [new File(["x"], "a.exe", { type: "application/x-msdownload" })] }); assert.equal(s, 400); });
test("rejects oversize attachments", async () => { const [s] = await run({}, { files: [new File([new Uint8Array(5.5 * 1024 * 1024)], "a.pdf", { type: "application/pdf" })] }); assert.equal(s, 400); });
test("rejects missing fields and bad email", async () => {
  assert.equal((await run({ name: "" }))[0], 400); assert.equal((await run({ email: "nope" }))[0], 400);
});
test("blocks wrong or missing origin", async () => {
  assert.equal((await run({}, { origin: "https://evil.test" }))[0], 403); assert.equal((await run({}, { origin: null }))[0], 403);
});
test("honeypot is dropped silently with no email", async () => { const [s, j] = await run({ website: "spam" }); assert.equal(s, 200); assert.equal(sent.length, 0); });
test("too-fast submissions are rejected", async () => { assert.equal((await run({ ts: String(Date.now()) }))[0], 429); });
test("business email failure returns an error", async () => {
  sent = []; const f = globalThis.fetch; globalThis.fetch = async () => new Response("{}", { status: 500 });
  const r = await onRequestPost(req()); globalThis.fetch = f; assert.equal(r.status, 502);
});
