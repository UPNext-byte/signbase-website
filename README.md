# Sign Base website

Static website (plain HTML/CSS/JS, **no framework and no build step**) hosted on Cloudflare Pages, with Pages Functions that email quotation requests and general enquiries through Resend.

```
public/                  site files (Cloudflare Pages output directory)
  index.html             the website (all content and product data)
  images/                project and product photos
  logo.png, favicon.svg, robots.txt, _headers
functions/api/quote.js   POST /api/quote   combined multi-product quotation request
functions/api/contact.js POST /api/contact general enquiry from the contact form
lib/common.js            shared validation, spam protection and email helpers
test/quote.test.mjs      backend tests (Resend mocked)
wrangler.toml            Pages config (output dir = public)
```

## Site structure
Navigation and homepage order: Home, Products & Services, Our Work, About Us, Contact Us, plus the Request a Quote button and the My Quote List indicator. The quote list is a quotation basket: no checkout or payments.

## Editing products, prices and projects
Everything lives at the top of the `<script>` in `public/index.html`:
- `PRODUCTS`: `name`, `cat`, `desc`, `details`, `images` (file names in `public/images/`, or `[]` for a neutral tile), `price` (number in BWP, or `null`), `unit` (e.g. `"each"`, `"per square metre"`), `custom: true` for priced items that may need a custom quote, and `qtype` (which quote questions to ask).
- Products with `price: null` show "Request a Quote". Never put `0` as a price.
- `QF`: the product-specific quotation questions per `qtype`.
- `PROJECTS`: the "Our Work" gallery.
To add a category, use a new `cat` value on a product; it appears automatically.

## Local development
```
npm install
cp .dev.vars.example .dev.vars    # fill in values, never commit this file
npm run dev                       # http://localhost:8788
npm test
```

## Deploy: GitHub + Cloudflare Pages
1. Create a GitHub repo `signbase-website`, then:
   ```
   git init -b main && git add . && git commit -m "Initial commit"
   git remote add origin https://github.com/<you>/signbase-website.git && git push -u origin main
   ```
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git.
3. Build settings: **Framework preset None. Build command: empty. Build output directory: `public`. Root: `/`.** Production branch `main`; every push redeploys.
4. Settings > Variables and Secrets (Production):
   | Name | Type | Value |
   |---|---|---|
   | `RESEND_API_KEY` | Secret | from resend.com |
   | `QUOTE_FROM` | Text | `Sign Base <quotes@yourdomain.com>` (domain verified in Resend) |
   | `QUOTE_TO` | Text | optional, defaults to salessignbase1@gmail.com (use your own while testing) |
   | `TURNSTILE_SECRET` | Secret | optional |
   Redeploy after adding them.

## Email (Resend)
Verify the business sending domain in Resend and use an address on it for `QUOTE_FROM`. Without a verified domain Resend only delivers to your own account email, so customer acknowledgements will not reach customers. The customer's address is the Reply-To, never the sender. Submissions only show a success message when the email was actually accepted by Resend.

## Spam protection
Same-origin check, hidden honeypot, minimum fill time, input and file validation (PDF/PNG/JPG/WebP, max 8 MB total), HTML escaping. Recommended: enable Cloudflare Turnstile (put the public site key in a widget, set `TURNSTILE_SECRET`) and add a Cloudflare WAF rate-limiting rule for `/api/*`.

## Still needed before launch
- Vinyl logo price per square metre and the unit for double-sided tape (currently no price / no unit shown)
- Vehicle branding, promotional materials and tape photos (neutral tiles are used)
- TikTok link; `sitemap.xml` and canonical domain
- Send a real test quote and contact message and confirm the emails arrive

## Future growth
Payments, accounts, orders and inventory are not implemented. Product data is isolated in `PRODUCTS` and server logic in `functions/` and `lib/`, so a database and payment provider can be added behind new `/api/*` functions.
