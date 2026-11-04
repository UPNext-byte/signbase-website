# Sign Base website

Static website (plain HTML/CSS/JS, **no framework and no build step**) hosted on Cloudflare Pages, with a Cloudflare Pages Function (`functions/api/quote.js`) that handles quote requests and sends email through Resend.

```
public/                 site files (Cloudflare Pages output directory)
  index.html            the website
  logo.png, favicon.svg, robots.txt, _headers
functions/api/quote.js  POST /api/quote: validation, spam protection, emails
test/quote.test.mjs     unit tests for the function (Resend mocked)
wrangler.toml           Pages config (output dir = public)
```

## Local development
```
npm install
cp .dev.vars.example .dev.vars    # fill in values, never commit this file
npm run dev                       # http://localhost:8788
npm test
```

## Edit content
Products, services and portfolio projects are plain arrays at the top of the `<script>` in `public/index.html` (`SHOP`, `SERVICES`, `PROJECTS`). Prices in `SHOP` are sample values: replace them or set `price: null` to show "Quote on request".

## Deploy: GitHub + Cloudflare Pages
1. Create a GitHub repo named `signbase-website`, then:
   ```
   git init -b main && git add . && git commit -m "Initial commit"
   git remote add origin https://github.com/<you>/signbase-website.git && git push -u origin main
   ```
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git > choose the repo.
3. Build settings: **Framework preset: None. Build command: (leave empty). Build output directory: `public`. Root directory: `/`.** Production branch: `main`. Every push to `main` now redeploys automatically.
4. Pages project > Settings > Variables and Secrets (Production), add:
   | Name | Type | Value |
   |---|---|---|
   | `RESEND_API_KEY` | Secret | from resend.com |
   | `QUOTE_FROM` | Text | `Sign Base <quotes@yourdomain.com>` (domain verified in Resend) |
   | `QUOTE_TO` | Text | optional; defaults to salessignbase1@gmail.com. Use your own email while testing |
   | `TURNSTILE_SECRET` | Secret | optional, see below |
   Then redeploy (secrets apply to new deployments).

## Email setup (Resend)
Add and verify the business's sending domain in Resend (DNS records), and use an address on it for `QUOTE_FROM`. Without a verified domain Resend only delivers to your own account email, so the customer acknowledgement will not reach customers. The customer's email is used as **Reply-To**, never as the sender.

## Spam protection
Built in: same-origin check, hidden honeypot field, minimum fill time, field and file validation (3 files, 5 MB, PDF/PNG/JPG/WebP), HTML escaping. Recommended extras: enable **Turnstile** (create a widget in Cloudflare, put the public site key in `TURNSTILE_SITEKEY` in `public/index.html`, set `TURNSTILE_SECRET`), and add a Cloudflare WAF **rate limiting rule** on `/api/quote`.

## Production checklist (needs your input)
- Real product/project photos (the site currently uses branded text tiles; no photos are included)
- Real prices, business address and map, social links (footer shows "coming soon")
- Set the canonical domain, then add `sitemap.xml`
- Send a real test quote and confirm both emails arrive

## Future growth
Payments, accounts, orders and inventory are not implemented. The product data is isolated in the `SHOP` array and the server logic in `functions/`, so a database (Cloudflare D1/Supabase) and payment provider can be added behind new `/api/*` functions without redesigning the site.
