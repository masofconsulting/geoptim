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
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: "clé manquante" }) };

  try {
    const { domain, name, ctx, rawContent } = JSON.parse(event.body);

    const prompt = `Génère une page FAQ HTML pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${(rawContent || '').slice(0, 1500)}

FORMAT :
<article class="faq-page">
  <header class="faq-header">
    <h1>Questions fréquentes : ${name}</h1>
    <p class="faq-intro">[activité réelle, types de clients, 2 phrases max]</p>
  </header>
  <section class="faq-section">
    <h2>[Thème 1]</h2>
    <div class="faq-item" id="[slug-seo]"><h3>[question longue traîne client]</h3><p>[réponse, 60 mots max, point final]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse, 60 mots max]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse, 60 mots max]</p></div>
  </section>
  <section class="faq-section">
    <h2>[Thème 2]</h2>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse, 60 mots max]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse, 60 mots max]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question + lien tel/mailto si dispo]</h3><p>[réponse, 60 mots max]</p></div>
  </section>
  <footer class="faq-footer">Optimisation GEO par <a href="https://geoptim.io">Geoptim.io</a></footer>
</article>

RÈGLES : données réelles uniquement, pas d'invention, prose sans liste ni tiret, pas de balise style.`;

    const data = await callAnthropic(KEY, {
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    }, 24000);

    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(b => b.text || "").join("").trim()
      .replace(/^```html?\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faq: text })
    };

  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
