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

  function extractJsonLd(html) {
    const matches = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) matches.push(m[1].trim());
    return matches.join('\n');
  }
  function stripHtml(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
      .replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  }
  async function fetchSafe(u, ms, strip) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoptimBot/1.0)' }, signal: AbortSignal.timeout(ms) });
      if (!r.ok) return '';
      const t = await r.text();
      return strip ? stripHtml(t) : t;
    } catch(e) { return ''; }
  }

  try {
    const { url } = JSON.parse(event.body);
    const domain = url.replace(/https?:\/\//,'').replace(/\/.*$/,'');
    const base = 'https://' + domain;

    const [homeRaw, robots, llms] = await Promise.all([
      fetchSafe(base + '/', 4000, false),
      fetchSafe(base + '/robots.txt', 2000, false),
      fetchSafe(base + '/llms.txt', 2000, false),
    ]);

    const homeJsonLd = extractJsonLd(homeRaw);
    const homeText = stripHtml(homeRaw).slice(0, 2000);

    const prompt = `Tu es un auditeur GEO. Évalue ce site avec des critères précis et reproductibles. Utilise temperature=0 mentalement : pour des données identiques, tu dois toujours donner le même score.

URL : ${url}
robots.txt : ${robots.slice(0,600) || '(absent)'}
llms.txt : ${llms.slice(0,400) || '(absent)'}
JSON-LD détecté : ${homeJsonLd ? homeJsonLd.slice(0,1200) : '(aucun)'}
Homepage : ${homeText}

CRITÈRES DE NOTATION (chaque critère sur 25) :

ROBOTS (0-25) — évalue la présence et l'exhaustivité des directives crawlers IA :
• 0 : robots.txt totalement absent (404)
• 1-7 : robots.txt présent MAIS aucun crawler IA mentionné (ni GPTBot, ni ClaudeBot, etc.) — donne 5
• 8-14 : 1 à 2 crawlers IA présents (ex: GPTBot uniquement ou Google-Extended)
• 15-20 : 3 à 5 crawlers IA présents
• 21-25 : 6+ crawlers IA majeurs couverts (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, xAI-Bot, MistralBot, DeepSeekBot)
Important : si robots.txt présent sans aucun crawler IA → score entre 3 et 7, PAS 0.

LLMSTXT (0-25) — présence et qualité du fichier llms.txt :
• 0 : absent (404 ou vide)
• 1-10 : présent mais moins de 3 sections exploitables
• 11-18 : présent avec 3 à 6 sections structurées
• 19-25 : présent et complet (7+ sections : présentation, services, équipe, contact, usages IA…)

SCHEMA (0-25) — richesse des données structurées JSON-LD :
• 0-3 : aucun JSON-LD ni microdata détecté
• 4-8 : JSON-LD minimaliste (WebSite ou BreadcrumbList seuls)
• 9-15 : Organization ou LocalBusiness avec quelques champs (name, url, description)
• 16-20 : type précis (LegalService, MedicalBusiness…) avec données partiellement remplies
• 21-25 : type précis + FAQPage + adresse + contact + sameAs + hasOfferCatalog complets
Important : si JSON-LD basique présent → minimum 4, PAS 0.

CONTENT (0-25) — structure et lisibilité du contenu pour les IA :
• 0-7 : contenu peu structuré, peu de titres, texte dense et difficile à parser
• 8-14 : contenu moyennement structuré avec quelques H2
• 15-20 : bon contenu, H2/H3 clairs, paragraphes lisibles, données concrètes
• 21-25 : excellent contenu sémantique, très riche en entités nommées, structure idéale pour IA

Réponds UNIQUEMENT avec ce JSON sans markdown :
{
  "geoScore": 42,
  "scoreBreakdown": { "robots": 5, "llmstxt": 0, "schema": 9, "content": 15 },
  "scoreLabels": {
    "robots": "diagnostic crawlers IA",
    "llmstxt": "présent et structuré / absent",
    "schema": "types détectés ou absents",
    "content": "structure et lisibilité IA"
  },
  "strengths": ["point fort 1", "point fort 2", "point fort 3"],
  "improvements": ["action prioritaire 1", "action prioritaire 2", "action prioritaire 3", "action prioritaire 4"],
  "summary": "diagnostic GEO en 2-3 phrases"
}`;

    const data = await callAnthropic(KEY, {
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      temperature: 0,
      messages: [{ role: "user", content: prompt }]
    }, 22000);

    if (data.error) throw new Error(data.error.message);
    const text = (data.content||[]).map(b=>b.text||'').join('').trim().replace(/^```json\n?/,'').replace(/\n?```$/,'').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse IA invalide");
    const score = JSON.parse(match[0]);
    const b = score.scoreBreakdown || {};
    ['robots','llmstxt','schema','content'].forEach(k => { b[k] = Math.min(Math.max(parseInt(b[k])||0,0),25); });
    score.geoScore = b.robots + b.llmstxt + b.schema + b.content;
    score.scoreBreakdown = b;

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(score) };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
