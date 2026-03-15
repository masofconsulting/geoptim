// Netlify v2 - streaming immédiat → frontend accumule et parse le JSON
async function* streamAnthropic(KEY, body) {
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
    let buf = '';
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
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text;
        if (ev.type === 'error') throw new Error(ev.error?.message || 'Erreur stream Anthropic');
      }
    }
    return;
  }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

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

  let url;
  try { ({ url } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const domain = url.replace(/https?:\/\//,'').replace(/\/.*$/,'');
  const base = 'https://' + domain;

  const [homeRaw, robots, llms] = await Promise.all([
    fetchSafe(base + '/', 4000, false),
    fetchSafe(base + '/robots.txt', 2000, false),
    fetchSafe(base + '/llms.txt', 4000, false),
  ]);

  const homeJsonLd = extractJsonLd(homeRaw);
  const homeText = stripHtml(homeRaw).slice(0, 2000);

  // Extract llms.txt section headers so Claude can count them
  const llmsSections = llms ? llms.split('\n').filter(l => /^#{1,3}\s/.test(l)).join('\n') : '';
  const llmsInfo = llms
    ? `${llms.slice(0,2000)}\n\n[SECTIONS DÉTECTÉES (${llmsSections.split('\n').length} sections) :\n${llmsSections}\n]`
    : '(absent)';

  const prompt = `Tu es un auditeur GEO. Évalue ce site avec des critères précis et reproductibles. Utilise temperature=0 mentalement : pour des données identiques, tu dois toujours donner le même score.

URL : ${url}
robots.txt : ${robots.slice(0,1500) || '(absent)'}
llms.txt : ${llmsInfo}
JSON-LD détecté : ${homeJsonLd ? homeJsonLd.slice(0,3000) : '(aucun)'}
Homepage : ${homeText}

CRITÈRES DE NOTATION (chaque critère sur 25) :

ROBOTS (0-25) : évalue la présence et l'exhaustivité des directives crawlers IA :
• 0 : robots.txt totalement absent (404)
• 1-7 : robots.txt présent MAIS aucun crawler IA mentionné (ni GPTBot, ni ClaudeBot, etc.), donne 5
• 8-14 : 1 à 2 crawlers IA présents (ex: GPTBot uniquement ou Google-Extended)
• 15-20 : 3 à 5 crawlers IA présents
• 21-25 : 6+ crawlers IA majeurs couverts (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, xAI-Bot, MistralBot, DeepSeekBot)
Important : si robots.txt présent sans aucun crawler IA → score entre 3 et 7, PAS 0.

LLMSTXT (0-25) : présence et qualité du fichier llms.txt :
• 0 : absent (404 ou vide)
• 1-10 : présent mais moins de 3 sections exploitables
• 11-18 : présent avec 3 à 6 sections structurées
• 19-25 : présent et complet (7+ sections : présentation, services, équipe, contact, usages IA…)

SCHEMA (0-25) : richesse des données structurées JSON-LD :
• 0-3 : aucun JSON-LD ni microdata détecté
• 4-8 : JSON-LD minimaliste (WebSite ou BreadcrumbList seuls)
• 9-15 : Organization ou LocalBusiness avec quelques champs (name, url, description)
• 16-20 : type précis (LegalService, MedicalBusiness…) avec données partiellement remplies
• 21-25 : type précis + FAQPage + adresse + contact + sameAs + hasOfferCatalog complets
Important : si JSON-LD basique présent → minimum 4, PAS 0.

CONTENT (0-25) : structure et lisibilité du contenu pour les IA :
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

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of streamAnthropic(KEY, {
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          temperature: 0,
          messages: [{ role: "user", content: prompt }]
        })) {
          ctrl.enqueue(enc.encode(chunk));
        }
        ctrl.close();
      } catch(err) {
        ctrl.enqueue(enc.encode(`\n__GEOPTIM_ERROR__${err.message}`));
        ctrl.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
