# Geoptim — Mémoire projet

## Architecture
SPA HTML unique (index.html ~1900 lignes) + Netlify Functions serverless.

## Flux principal
1. `analyze-score` + `analyze-info` en parallèle → score GEO + données business
2. `generate-llms` + `generate-schema` + `generate-faq` en parallèle → 3 fichiers IA
3. `robots.txt` généré côté client (JS pur, sans IA)
4. Paiement Stripe → redirect → `verify-payment` (rapide) → unlock files

## Fonctions actives (utilisées par le frontend)
- `analyze-score` → Haiku, 1000 tokens, timeout 26s
- `analyze-info` → Haiku, 1500 tokens, timeout 26s
- `generate-llms` → Sonnet, 1500 tokens, timeout 26s
- `generate-schema` → Sonnet, 1200 tokens, timeout 26s
- `generate-faq` → Sonnet, 1200 tokens, timeout 26s
- `create-checkout` → Stripe API, timeout 10s
- `verify-payment` → Stripe API, timeout 10s

## Fonctions legacy (non utilisées par le frontend actuel)
- `analyze.js` → ancienne version combine score+info en un seul fichier
- `generate.js` → ancienne version fait 3 appels parallèles dans une seule fonction
- `verify-and-generate.js` → refactorisé pour faire 3 appels parallèles (était 1 call 8000 tokens)

## Modèles IA utilisés
- Analyse (score + info) : `claude-haiku-4-5-20251001` (rapide, suffisant pour extraction)
- Génération (llms, schema, faq) : `claude-sonnet-4-6` (qualité requise)

## Points clés Netlify
- Toutes les fonctions ont un timeout dans netlify.toml (26s max sur plan Pro)
- Tous les appels Anthropic ont `signal: AbortSignal.timeout(22000-24000)` pour échouer proprement avant le timeout Netlify
- `node_bundler = "esbuild"` dans netlify.toml

## Pages légales (ajoutées mars 2026)
- Page `pg-legal` avec onglets : Mentions légales / RGPD / CGV
- Liens dans le footer (colonne "Légal" + barre de bas de page)
- Cookie notice bar (sessionStorage uniquement, pas de cookies de tracking)
- Les champs [À COMPLÉTER] : nom/raison sociale, SIREN, adresse, médiateur
- Contact : contact@geoptim.io

## État du projet
- Pas de package.json / node_modules (fetch natif Node.js 18+)
- Pas de framework frontend (vanilla JS)
- Police Google Fonts chargée depuis googleapis.com (mentionné dans RGPD)
