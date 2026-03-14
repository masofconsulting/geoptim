// Netlify v2 — accumule le stream Anthropic, retourne JSON complet
async function callAnthropicStreaming(KEY, body) {
  const MAX = 3;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.error?.type === 'overloaded_error' && attempt < MAX - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw new Error(errData.error?.message || `Erreur Anthropic ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text;
        if (ev.type === 'error') throw new Error(ev.error?.message || 'Erreur stream Anthropic');
      }
    }
    return text;
  }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

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
    const { url } = await req.json();
    const domain = url.replace(/https?:\/\//,'').replace(/\/.*$/,'');
    const base = 'https://' + domain;

    // ── Fetch agressif : 12 pages en parallèle avec timeouts courts ──────────
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

    const sections = [
      home              ? '=== ACCUEIL ===\n'      + home.slice(0, 3000) : '',
      contact           ? '=== CONTACT ===\n'      + contact.slice(0, 1500) : '',
      mentions          ? '=== MENTIONS ===\n'     + mentions.slice(0, 1000) : '',
      (equipe1 || equipe2 || equipe3 || equipe4)
        ? '=== ÉQUIPE ===\n' + [equipe1, equipe2, equipe3, equipe4].filter(Boolean).join(' ').slice(0, 2500) : '',
      (expertises1 || expertises2 || expertises3)
        ? '=== EXPERTISES ===\n' + [expertises1, expertises2, expertises3].filter(Boolean).join(' ').slice(0, 2500) : '',
      cabinet           ? '=== CABINET ===\n'      + cabinet.slice(0, 1500) : '',
      honoraires        ? '=== HONORAIRES ===\n'   + honoraires.slice(0, 1000) : '',
    ].filter(Boolean);

    const rawContent = sections.join('\n\n').slice(0, 12000);

    const prompt = `Tu es un expert en extraction d'information business. Extrais toutes les données réelles de ce site de façon exhaustive.

URL : ${url}

CONTENU RÉCUPÉRÉ (plusieurs pages) :
---
${rawContent.slice(0, 8000)}
---

RÈGLES STRICTES :
- N'utilise QUE ce qui est EXPLICITEMENT présent dans le contenu. Jamais de devinette.
- Téléphone / email : copie les valeurs EXACTES telles qu'affichées.
- Location : uniquement depuis adresse postale ou footer ou mentions légales.
- team : liste TOUS les noms et rôles trouvés (avocats, associés, collaborateurs, fondateurs, dirigeants).
- services : TOUS les domaines d'expertise mentionnés explicitement, sans limite de nombre.
- offers : TOUTES les offres et prestations identifiées, avec descriptions si disponibles.
- tone : "vouvoiement" si le site utilise vous/votre, "tutoiement" si tu/te/ton.
- problemsSolved : 5 vraies douleurs clients déduites des services réels.
- sectorKeywords : 8 requêtes longue traîne réelles que les clients taperaient.
- useCases : 6 situations concrètes liées aux vrais services.
- Si un champ est introuvable → null (pas de valeur inventée).

Réponds UNIQUEMENT avec ce JSON sans markdown :
{
  "siteName": "...",
  "siteDescription": "une phrase précise sur ce que fait réellement ce site",
  "siteType": "type précis (ex: Cabinet d'avocats, Agence SEO, Startup SaaS...)",
  "siteInfo": {
    "mainActivity": "description complète de l'activité principale",
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
    "sectorKeywords": ["requête 1","requête 2","requête 3","requête 4","requête 5","requête 6","requête 7","requête 8"],
    "useCases": ["situation 1","situation 2","situation 3","situation 4","situation 5","situation 6"],
    "entityType": "cabinet ou startup ou agence ou boutique ou clinique ou entreprise",
    "tone": "vouvoiement",
    "blogUrl": "url ou null",
    "extraUrls": { "clientSpace": "url ou null" }
  }
}`;

    const text = await callAnthropicStreaming(KEY, {
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }]
    });

    const clean = text.trim().replace(/^```json\n?/,'').replace(/\n?```$/,'').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse IA invalide");
    const info = JSON.parse(match[0]);

    return new Response(JSON.stringify({ ...info, rawContent }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
