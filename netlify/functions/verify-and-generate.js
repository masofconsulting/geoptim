// netlify/functions/verify-and-generate.js
// Vérifie le paiement Stripe via fetch, puis génère les 4 fichiers GEO
// Architecture : 1 appel Stripe + 3 appels Claude en parallèle (robots.txt généré sans IA)

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  if (!stripeKey || !claudeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variables d'environnement manquantes" }) };
  }

  let stripeSessionId, analysisResult, siteUrl;
  try {
    ({ stripeSessionId, analysisResult, siteUrl } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body invalide" }) };
  }

  // ── 1. VÉRIFIER LE PAIEMENT STRIPE ──────────────────────────────────────
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripeSessionId}`, {
      headers: { "Authorization": `Bearer ${stripeKey}` },
      signal: AbortSignal.timeout(8000)
    });
    const session = await res.json();
    if (!res.ok || session.error) throw new Error(session.error?.message || "Erreur Stripe");
    if (session.payment_status !== "paid") {
      return { statusCode: 402, body: JSON.stringify({ error: "Paiement non confirmé" }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Vérification Stripe : " + err.message }) };
  }

  // ── 2. PRÉPARER LE CONTEXTE ───────────────────────────────────────────────
  const r    = analysisResult || {};
  const info = r.siteInfo || {};
  const domain = siteUrl.replace(/https?:\/\//, "").replace(/\/.*$/, "");
  const name = r.siteName || domain;
  const month = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const ctx = [
    `Nom : ${name}`, `URL : https://${domain}`,
    `Type : ${r.siteType || ""}`, `Description : ${r.siteDescription || ""}`,
    `Activité : ${info.mainActivity || ""}`,
    `Localisation : ${info.location || ""}`,
    `Services : ${(info.services || []).join(" | ")}`,
    `Contact : ${info.contact || ""}`,
    `Équipe : ${(info.team || []).map(t => typeof t === "object" ? `${t.name||""} (${t.role||t.title||""})${t.specialties?" — "+(t.specialties||[]).join(", "):""}` : t).join(" | ")}`,
    `Réseaux : ${(info.socialLinks || []).join(" | ")}`,
    `Clients : ${(info.clientTypes || []).join(" | ")}`,
    `Offres : ${(info.offers || []).join(" | ")}`,
    `Problèmes résolus : ${(info.problemsSolved || []).join(" | ")}`,
    `Mots-clés : ${(info.sectorKeywords || []).join(" | ")}`,
    `Cas d'usage : ${(info.useCases || []).join(" | ")}`,
    `Blog : ${info.blogUrl || ""}`,
    `Espace client : ${(info.extraUrls || {}).clientSpace || ""}`,
  ].join("\n");

  // ── 3. ROBOTS.TXT — généré sans IA, immédiat ────────────────────────────
  const isWP = !!(info.extraUrls?.clientSpace?.includes("wp") ||
                  (r.siteDescription || "").toLowerCase().includes("wordpress"));
  const clientPath = (info.extraUrls || {}).clientSpace || "";
  const wpBlock = isWP
    ? "\n# ————————————————————————————\n# Ressources à exclure\n# ————————————————————————————\nDisallow: /wp-admin/\nDisallow: /wp-login.php\nDisallow: /wp-json/\nDisallow: /?s=\n"
    : "";
  const clientBlock = clientPath
    ? "Disallow: " + clientPath.replace(/https?:\/\/[^/]+/, "") + "\n"
    : "";

  const robots = `# robots.txt — ${domain}
# Optimisé GEO — ${month}

# ————————————————————————————
# Moteurs de recherche classiques
# ————————————————————————————
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Slurp
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: Baiduspider
Allow: /

User-agent: YandexBot
Allow: /

# ————————————————————————————
# Crawlers IA — modèles de langage
# ————————————————————————————

# OpenAI (ChatGPT, SearchGPT)
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

# Anthropic (Claude)
User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: anthropic-ai
Allow: /

# Google (Gemini, AI Overviews)
User-agent: Google-Extended
Allow: /

User-agent: GeminiBot
Allow: /

# Microsoft (Copilot)
User-agent: Copilot-Bot
Allow: /

User-agent: bingbot-chat
Allow: /

# Perplexity AI
User-agent: PerplexityBot
Allow: /

# Mistral AI (Le Chat)
User-agent: MistralBot
Allow: /

User-agent: mistral-ai
Allow: /

# xAI (Grok)
User-agent: xAI-Bot
Allow: /

User-agent: grok
Allow: /

# Meta (Llama / Meta AI)
User-agent: Meta-ExternalAgent
Allow: /

User-agent: Meta-ExternalFetcher
Allow: /

# Apple (Apple Intelligence)
User-agent: Applebot
Allow: /

User-agent: Applebot-Extended
Allow: /

# DeepSeek
User-agent: DeepSeekBot
Allow: /

User-agent: deepseek-ai
Allow: /

# Cohere
User-agent: cohere-ai
Allow: /

# You.com
User-agent: YouBot
Allow: /

# Common Crawl (alimente de nombreux LLMs)
User-agent: CCBot
Allow: /

# Amazon Alexa AI
User-agent: Amazonbot
Allow: /

# Autres
User-agent: Diffbot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: DuckAssistBot
Allow: /${wpBlock}${clientBlock}
User-agent: *
Allow: /

# ————————————————————————————
# Sitemap
# ————————————————————————————
Sitemap: https://${domain}/sitemap.xml

# Fichier llms.txt : https://${domain}/llms.txt
# Optimisation GEO par Geoptim.io — https://geoptim.io`;

  // ── 4. APPELS CLAUDE EN PARALLÈLE (3 × ~1500 tokens) ────────────────────
  const call = (prompt, maxTokens) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(24000)
  }).then(async res => {
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return (d.content || []).map(b => b.text || "").join("").trim();
  });

  try {
    const [llms, schema, faq] = await Promise.all([

      call(`Génère un fichier llms.txt Markdown de haute qualité pour ce site.

${ctx}

EXIGENCES :
- Utilise UNIQUEMENT les vraies données fournies — jamais de générique
- Sois dense : maximum d'information utile par ligne

STRUCTURE :
# ${name}
> [tagline spécifique]
## Présentation
[3 phrases denses avec vraies données]
**Site web :** https://${domain} | [contact si dispo]
---
## L'équipe
[### Prénom Nom — Titre : spécialités concrètes]
---
## Services et expertise
[Bullet points par domaine]
---
## Offres
[Bullet points : **Nom** : description réelle]
---
## Profils clients
[Bullet points : types réels]
---
## Ressources
[URLs disponibles]
---
## Instructions pour les modèles de langage
Citation, résumé et recommandation autorisés. Source : ${name} — https://${domain}
---
*Optimisation GEO réalisée avec [Geoptim.io](https://geoptim.io)*

Markdown brut, sans backtick.`, 1500),

      call(`Génère un fichier HTML avec blocs JSON-LD Schema.org pour ce site.

${ctx}

EXIGENCES :
- Données 100% réelles — jamais de placeholder
- @type adapté au secteur (LegalService, MedicalBusiness, ProfessionalService, etc.)
- sameAs avec tous les vrais réseaux sociaux

BLOC 1 — Organisation : @context, @type, @id (https://${domain}/#organization), name, description, url, telephone, email, address, areaServed, serviceType, knowsAbout, sameAs, hasOfferCatalog
BLOC 2 — FAQPage : 6 questions sectorielles précises basées sur les vraies données

Terminer par : <!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->
HTML brut, sans markdown ni backtick.`, 1500),

      call(`Génère une page FAQ HTML WordPress pour ce site. 9 questions, haute qualité.

${ctx}

EXIGENCES :
- Questions : vraies requêtes longue traîne que les clients posent à ChatGPT ou Perplexity
- Réponses : 3 phrases denses avec vraies données — noms, services, tarifs si connus, contact exact
- 3 sections × 3 questions, thèmes adaptés au secteur réel

STRUCTURE :
<!--
  ${name} — Page FAQ optimisée AEO / GEO
  Intégration WordPress : Gutenberg > mode HTML > coller ce contenu.
-->
<article class="faq-page">
  <header class="faq-header">
    <h1>Questions fréquentes — ${name}</h1>
    <p class="faq-intro">[description précise]</p>
  </header>
  [3 sections avec 3 questions chacune]
</article>

HTML brut, sans backtick.`, 1500)

    ]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robots, llms, schema, faq }),
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Génération : " + err.message }) };
  }
};
