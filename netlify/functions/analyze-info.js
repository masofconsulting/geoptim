// Retry helper — jusqu'à 3 tentatives si Anthropic renvoie overloaded_error
async function callAnthropic(KEY, body, timeoutMs) {
  const MAX = 3;
  for (let i = 0; i < MAX; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json();
    if (data.error && data.error.type === 'overloaded_error' && i < MAX - 1) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    return data;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }) };

  function stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchSafe(u, ms) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoptimBot/1.0; +https://geoptim.io)' },
        signal: AbortSignal.timeout(ms)
      });
      if (!r.ok) return '';
      return stripHtml(await r.text());
    } catch(e) { return ''; }
  }

  try {
    const { url } = JSON.parse(event.body);
    const domain = url.replace(/https?:\/\//,'').replace(/\/.*$/,'');
    const base = 'https://' + domain;

    // ── Fetch agressif : 12 pages en parallèle avec timeouts courts ──────────
    // Toutes les tentatives sont simultanées — le temps total = le plus lent ~4s
    const [
      home, contact, mentions,
      equipe1, equipe2, equipe3, equipe4,
      expertises1, expertises2, expertises3,
      cabinet, honoraires
    ] = await Promise.all([
      fetchSafe(base + '/',                    4000),
      fetchSafe(base + '/contact',             3000),
      fetchSafe(base + '/mentions-legales',    3000),
      fetchSafe(base + '/equipe',              3000),
      fetchSafe(base + '/avocats',             3000),
      fetchSafe(base + '/l-equipe',            3000),
      fetchSafe(base + '/notre-equipe',        3000),
      fetchSafe(base + '/expertises',          3000),
      fetchSafe(base + '/domaines',            3000),
      fetchSafe(base + '/domaines-d-intervention', 3000),
      fetchSafe(base + '/cabinet',             3000),
      fetchSafe(base + '/honoraires',          3000),
    ]);

    // ── Construire le contenu brut consolidé (pour les generators) ───────────
    const sections = [
      home              ? '=== ACCUEIL ===\n'      + home.slice(0, 2500) : '',
      contact           ? '=== CONTACT ===\n'      + contact.slice(0, 1000) : '',
      mentions          ? '=== MENTIONS ===\n'     + mentions.slice(0, 800) : '',
      (equipe1 || equipe2 || equipe3 || equipe4)
        ? '=== ÉQUIPE ===\n' + [equipe1, equipe2, equipe3, equipe4].filter(Boolean).join(' ').slice(0, 2000) : '',
      (expertises1 || expertises2 || expertises3)
        ? '=== EXPERTISES ===\n' + [expertises1, expertises2, expertises3].filter(Boolean).join(' ').slice(0, 2000) : '',
      cabinet           ? '=== CABINET ===\n'      + cabinet.slice(0, 1000) : '',
      honoraires        ? '=== HONORAIRES ===\n'   + honoraires.slice(0, 800) : '',
    ].filter(Boolean);

    const rawContent = sections.join('\n\n').slice(0, 10000);

    // ── Extraction structurée avec Haiku ─────────────────────────────────────
    const prompt = `Tu es un expert en extraction d'information business. Extrais toutes les données réelles de ce site.

URL : ${url}

CONTENU RÉCUPÉRÉ (plusieurs pages) :
---
${rawContent.slice(0, 6000)}
---

RÈGLES STRICTES :
- N'utilise QUE ce qui est EXPLICITEMENT présent dans le contenu. Jamais de devinette.
- Téléphone / email : copie les valeurs EXACTES telles qu'affichées.
- Location : uniquement depuis adresse postale ou footer ou mentions légales.
- team : liste TOUS les noms et rôles trouvés (avocats, associés, collaborateurs).
- services : tous les domaines d'expertise mentionnés explicitement.
- tone : "vouvoiement" si le site utilise vous/votre, "tutoiement" si tu/te/ton.
- problemsSolved : 5 vraies douleurs clients déduites des services réels.
- sectorKeywords : 5 requêtes longue traîne réelles que les clients taperaient.
- useCases : 4 situations concrètes liées aux vrais services.
- Si un champ est introuvable → null (pas de valeur inventée).

Réponds UNIQUEMENT avec ce JSON sans markdown :
{
  "siteName": "...",
  "siteDescription": "une phrase précise sur ce que fait réellement ce site",
  "siteType": "type précis (ex: Cabinet d'avocats, Agence SEO, Startup SaaS...)",
  "siteInfo": {
    "mainActivity": "description de l'activité principale",
    "location": "ville + région depuis adresse ou null",
    "city": "ville ou null",
    "region": "région ou null",
    "services": ["domaine 1","domaine 2","domaine 3","domaine 4","domaine 5","domaine 6"],
    "contact": "téléphone et/ou email EXACTS ou null",
    "team": [{ "name": "Prénom Nom", "role": "titre exact", "specialties": ["spécialité 1","spécialité 2"] }],
    "socialLinks": ["url linkedin","url twitter","etc."],
    "clientTypes": ["type client 1","type client 2","type client 3"],
    "offers": ["offre 1","offre 2","offre 3"],
    "problemsSolved": ["douleur 1","douleur 2","douleur 3","douleur 4","douleur 5"],
    "sectorKeywords": ["requête 1","requête 2","requête 3","requête 4","requête 5"],
    "useCases": ["situation 1","situation 2","situation 3","situation 4"],
    "entityType": "cabinet ou startup ou agence ou boutique ou clinique ou entreprise",
    "tone": "vouvoiement",
    "blogUrl": "url ou null",
    "extraUrls": { "clientSpace": "url ou null" }
  }
}`;

    const data = await callAnthropic(KEY, {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    }, 18000);

    if (data.error) throw new Error(data.error.message);
    const text = (data.content||[]).map(b=>b.text||'').join('').trim()
      .replace(/^```json\n?/,'').replace(/\n?```$/,'').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse IA invalide");
    const info = JSON.parse(match[0]);

    // Inclure le contenu brut dans la réponse pour les generators
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...info, rawContent })
    };

  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
