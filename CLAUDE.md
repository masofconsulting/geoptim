# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Geoptim is a GEO (Generative Engine Optimization) analysis tool. Users enter a website URL, get a score (0-100), then can purchase generated optimization files (llms.txt, FAQ page, Schema.org JSON-LD). No build step — vanilla HTML/CSS/JS frontend with Netlify Functions backend.

## Development & Deployment

- **No build step, no package.json** — static files served directly
- **Local dev:** `netlify dev` (requires Netlify CLI) — serves site on localhost:8888 with function proxying
- **Deploy:** Push to `main` triggers auto-deploy on Netlify
- **PR workflow:** `git commit` → `/opt/homebrew/bin/gh pr create` → merge on GitHub

## Environment Variables (Netlify)

- `ANTHROPIC_API_KEY` — Claude API (all analysis/generation functions)
- `STRIPE_SECRET_KEY` — Stripe payments
- `RESEND_API_KEY` — Receipt emails via Resend
- `PROMO_CODES` — JSON object `{"CODE":percent, ...}` for discount codes

## Architecture

### Frontend (SPA)

`index.html` (~2900 lines) is the entire app: hero, results, payment modal, receipt modal, legal pages. Additional static pages: `tarifs.html`, `faq.html`, `a-propos.html`, `blog/` (4 articles). All vanilla JS with CSS variables (navy/gold/cream theme). Responsive breakpoints at 860px and 600px.

### Backend (Netlify Functions in `netlify/functions/`)

All AI functions use `claude-sonnet-4-6` with streaming via `ReadableStream`. Each has a `streamAnthropic()` helper that retries up to 3× on `overloaded_error` with 2s delay. Functions use `AbortSignal.timeout(22-24s)` to stay under Netlify's 26s limit.

**Request flow:**
```
URL input → [analyze-score + analyze-info] parallel
  → Display score → User clicks unlock
  → [generate-llms + generate-faq + generate-schema] parallel streams
  → Payment (Stripe or free promo) → verify-payment → email receipt
```

**Key functions:**
- `analyze-score.js` — Scores 4 categories ×25pts (robots.txt, llms.txt, Schema.org, content). Temperature=0.
- `analyze-info.js` — Scrapes up to 12 pages, extracts business info. Appends raw content after `__RC__` sentinel.
- `generate-llms.js` — Generates llms.txt Markdown
- `generate-faq.js` — Generates FAQ HTML (`<article class="faq-page">`)
- `generate-schema.js` — Generates Schema.org JSON-LD with `@id` cross-references
- `create-checkout.js` — Creates Stripe session (€49 pack / €19 single)
- `verify-payment.js` — Verifies Stripe session + sends receipt via Resend
- `validate-promo.js` / `apply-free-promo.js` — Promo code handling (100% codes bypass Stripe)

**Legacy/unused:** `analyze.js`, `generate.js`, `verify-and-generate.js` (refactored into separate functions)

### Streaming & Error Conventions

- Functions stream text chunks to the frontend
- Error sentinel: `__GEOPTIM_ERROR__` in stream signals failure
- Raw content sentinel: `__RC__` separates parsed JSON from raw scraped content
- Frontend accumulates chunks, strips markdown backticks, parses final JSON

### Data Storage

- `localStorage.geo_purchases` — Array of analysis results + generated files
- Stripe session metadata — Billing info backup
- No server-side storage of generated content

## Key Patterns

- **Promo validation is always server-side** — never trust client-side promo data
- **All generation functions are language-aware** — `lang` param ('fr'/'en') controls output language
- **Generation uses only real extracted data** — prompts instruct Claude to never invent information
- **Billing display:** HT (excl. tax) / TVA 20% / TTC (incl. tax) breakdown
- **Receipt emails:** Sent from `receipts@geoptim.io`, BCC to `contact@geoptim.io`

## URL Routing (netlify.toml)

Clean URLs via redirects: `/tarifs` → `tarifs.html`, `/blog/*` → `blog/*.html`, etc. Function timeouts: 26s for AI functions, 10s for payment functions.
