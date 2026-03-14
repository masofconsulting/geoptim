exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }) };

  const MODEL = "claude-haiku-4-5-20251001";
  const KEY   = process.env.ANTHROPIC_API_KEY;

  function extractJsonLd(html) {
    const matches = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) matches.push(m[1].trim());
    return matches.join('\n');
  }

  function stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchSafe(u, ms) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoptimBot/1.0)' },
        signal: AbortSignal.timeout(ms)
      });
      if (!r.ok) return '';
      return await r.text();
    } catch(e) { return ''; }
  }

  async function callClaude(prompt, maxTokens) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error("Claude API: " + data.error.message);
    const text = (data.content || []).map(b => b.text || "").join("").trim()
      .replace(/^```json\n?/,"").replace(/\n?```$/,"").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse IA invalide");
    return JSON.parse(match[0]);
  }

  let url = '';
  try {
    ({ url } = JSON.parse(event.body));
    const domain = url.replace(/https?:\/\//,'').replace(/\/.*$/,'');
    const base   = 'https://' + domain;

    // Fetch parallèle avec timeouts courts
    const [homeRaw, contact, robots, llms] = await Promise.all([
      fetchSafe(base + '/',        3000),
      fetchSafe(base + '/contact', 2000),
      fetchSafe(base + '/robots.txt', 1500),
      fetchSafe(base + '/llms.txt',   1500),
    ]);

    const homeJsonLd = extractJsonLd(homeRaw);
    const homeText   = stripHtml(homeRaw).slice(0, 2500);
    const contactText = stripHtml(contact).slice(0, 1000);

    // 2 appels Haiku en parallèle
    const [score, info] = await Promise.all([
      callClaude(`Expert GEO. Évalue ce site.

URL: ${url}
robots.txt: ${robots.slice(0,400) || '(absent)'}
llms.txt: ${llms.slice(0,300) || '(absent)'}
JSON-LD: ${homeJsonLd ? homeJsonLd.slice(0,800) : '(aucun)'}
Contenu: ${homeText.slice(0,1500)}

Note chaque critère /25 — robots (crawlers IA autorisés), llmstxt (fichier présent/structuré), schema (Schema.org présent), content (structure lisible pour IA).

JSON sans markdown:
{"geoScore":42,"scoreBreakdown":{"robots":8,"llmstxt":0,"schema":14,"content":20},"scoreLabels":{"robots":"diagnostic crawlers IA","llmstxt":"absent ou présent","schema":"types détectés","content":"évaluation structure"},"strengths":["force 1","force 2","force 3"],"improvements":["action 1","action 2","action 3","action 4"],"summary":"diagnostic factuel 2 phrases"}`, 800),

      callClaude(`Expert extraction business. Analyse ce site.

URL: ${url}
Contenu: ${homeText}
Contact: ${contactText}

Règles strictes: n'utilise QUE ce qui est explicitement présent. Jamais de devinette sur la ville/région — uniquement si adresse postale explicite. Téléphone/email: valeurs exactes affichées.

JSON sans markdown:
{"siteName":"...","siteDescription":"une phrase précise","siteType":"type précis","siteInfo":{"mainActivity":"...","location":"ville+région depuis adresse/footer uniquement sinon null","city":"ville ou null","region":"région ou null","services":["...","...","...","..."],"contact":"tel et/ou email exacts ou null","team":[{"name":"...","role":"...","specialties":["...","..."]}],"socialLinks":["..."],"clientTypes":["...","...","..."],"offers":["...","...","..."],"problemsSolved":["douleur client 1","douleur client 2","douleur client 3"],"sectorKeywords":["requête longue traîne 1","requête 2","requête 3"],"useCases":["situation concrète 1","situation 2","situation 3"],"tone":"vouvoiement ou tutoiement","blogUrl":"url ou null"}}`, 1000)
    ]);

    const b = score.scoreBreakdown || {};
    ['robots','llmstxt','schema','content'].forEach(k => {
      b[k] = Math.min(Math.max(parseInt(b[k]) || 0, 0), 25);
    });
    score.geoScore = b.robots + b.llmstxt + b.schema + b.content;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteName:        info.siteName        || '',
        siteDescription: info.siteDescription || '',
        siteType:        info.siteType        || '',
        geoScore:        score.geoScore,
        scoreBreakdown:  b,
        scoreLabels:     score.scoreLabels    || {},
        strengths:       score.strengths      || [],
        improvements:    score.improvements   || [],
        summary:         score.summary        || '',
        siteInfo:        info.siteInfo        || {}
      })
    };

  } catch(err) {
    console.error("analyze error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message, url }) };
  }
};
