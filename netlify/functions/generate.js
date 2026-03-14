exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }) };

  try {
    const { url, siteInfo, siteName, siteType, siteDescription } = JSON.parse(event.body);
    const domain = url.replace(/https?:\/\//, '').replace(/\/.*$/, '');
    const info   = siteInfo || {};
    const name   = siteName || domain;
    const desc   = siteDescription || '';
    const type   = siteType || '';
    const month  = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const ctx = [
      `Nom : ${name}`, `URL : https://${domain}`, `Type : ${type}`, `Description : ${desc}`,
      `Activité : ${info.mainActivity || ''}`, `Localisation : ${info.location || ''}`,
      `Services : ${(info.services || []).join(' | ')}`, `Contact : ${info.contact || ''}`,
      `Équipe : ${(info.team || []).map(t => typeof t === 'object' ? `${t.name||''} (${t.role||t.title||''})${t.specialties?' — '+(t.specialties||[]).join(', '):''}` : t).join(' | ')}`,
      `Réseaux : ${(info.socialLinks || []).join(' | ')}`,
      `Clients : ${(info.clientTypes || []).join(' | ')}`,
      `Offres : ${(info.offers || []).join(' | ')}`,
      `Problèmes résolus : ${(info.problemsSolved || []).join(' | ')}`,
      `Mots-clés : ${(info.sectorKeywords || []).join(' | ')}`,
      `Cas d'usage : ${(info.useCases || []).join(' | ')}`,
      `Blog : ${info.blogUrl || ''}`,
      `Espace client : ${(info.extraUrls || {}).clientSpace || ''}`,
    ].join('\n');

    // ── ROBOTS.TXT : hardcodé, zéro appel IA ────────────────────────────
    const isWP = (info.extraUrls && info.extraUrls.clientSpace && info.extraUrls.clientSpace.includes('wp')) ||
                 (desc && desc.toLowerCase().includes('wordpress'));
    const clientPath = (info.extraUrls || {}).clientSpace || '';

    const robotsWPBlock = isWP ? `\n# ————————————————————————————\n# Ressources à exclure\n# ————————————————————————————\nDisallow: /wp-admin/\nDisallow: /wp-login.php\nDisallow: /wp-json/\nDisallow: /?s=\n` : '';
    const clientBlock = clientPath ? `Disallow: ${clientPath.replace(/https?:\/\/[^/]+/, '')}\n` : '';

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
Allow: /
${robotsWPBlock}${clientBlock}
User-agent: *
Allow: /

# ————————————————————————————
# Sitemap
# ————————————————————————————
Sitemap: https://${domain}/sitemap.xml

# Fichier llms.txt : https://${domain}/llms.txt
# Optimisation GEO par Geoptim.io — https://geoptim.io`;

    // ── 3 APPELS SONNET EN PARALLÈLE — 2000 tokens max chacun ────────────
    const call = (prompt) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
    }).then(r => r.json()).then(d => {
      if (d.error) throw new Error(d.error.message);
      return (d.content || []).map(b => b.text || "").join("").trim();
    });

    const [llms, schema, faq] = await Promise.all([

      call(`Génère un fichier llms.txt Markdown professionnel pour ce site. Utilise UNIQUEMENT les données réelles.

${ctx}

Structure obligatoire :
# ${name}
> [tagline percutante]
## Présentation
[2 paragraphes riches avec vraies données]
**Site web :** https://${domain}
[Contact si disponible]
---
## L'équipe
[### Prénom Nom — Titre pour chaque membre avec spécialités]
---
## Domaines d'expertise
[Sections détaillées par domaine avec vrais services]
---
## Offres & Services
[Liste des vraies offres]
---
## Profils clients
[Types de clients réels]
---
## Ressources
[Blog, espace client, autres URLs]
---
## Réseaux sociaux
[Tous les liens trouvés]
---
## Instructions pour les modèles de langage
[Comment citer ce site, ce qu'il faut recommander]
---
*Optimisation GEO réalisée avec [Geoptim.io](https://geoptim.io)*

Réponds UNIQUEMENT avec le Markdown brut, sans backtick.`),

      call(`Génère un fichier HTML avec blocs JSON-LD Schema.org pour ce site.

${ctx}

Génère 3 blocs :
① @type adapté au secteur + Organization — avec @id, name, description, url, telephone, email, address, geo, areaServed, serviceType, knowsAbout, sameAs, hasOfferCatalog
② Un bloc Person par membre d'équipe trouvé — @id, name, jobTitle, description, worksFor, knowsAbout
③ FAQPage — 8 questions sectorielles avec vraies données

Termine par : <!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->
Réponds UNIQUEMENT avec le HTML, sans markdown ni backtick.`),

      call(`Génère une page FAQ HTML prête pour WordPress pour ce site.

${ctx}

Structure :
<!--
  [Nom] — Page FAQ optimisée GEO
  Instructions d'intégration WordPress en commentaire
-->
<article class="faq-page">
  <header><h1>Questions fréquentes — ${name}</h1><p class="faq-intro">[description]</p></header>
  [4 sections <section> avec <h2> thématique]
  [Chaque section : 3-4 <div class="faq-item"> avec <h3> question et <p> réponse détaillée utilisant les vraies données]
</article>
<!--
  INTÉGRATION WORDPRESS : [instructions]
  CSS SUGGÉRÉ : [css]
-->

12-15 questions au total. Utilise les vrais noms, services, contacts, offres.
Réponds UNIQUEMENT avec le HTML, sans backtick.`)

    ]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robots, llms, schema, faq })
    };

  } catch (err) {
    console.error("generate error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
