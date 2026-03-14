// Netlify v2 — streaming response
// Anthropic SSE → ReadableStream → frontend lit chunk par chunk
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
  if (!KEY) return new Response(JSON.stringify({ error: "clé manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let domain, name, ctx, rawContent;
  try { ({ domain, name, ctx, rawContent } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const content = (rawContent || '').slice(0, 3000);

  const prompt = `Génère une page FAQ HTML complète et détaillée pour ce site. HTML brut uniquement, sans backtick ni balise style.

DONNÉES :
${ctx}

CONTENU DU SITE :
${content}

FORMAT EXACT À RESPECTER :
<article class="faq-page">
  <header class="faq-header">
    <h1>Questions fréquentes : ${name}</h1>
    <p class="faq-intro">[activité réelle, types de clients, zone géographique, 2-3 phrases précises et informatives]</p>
  </header>
  <section class="faq-section">
    <h2>[Thème 1 : Services et prestations]</h2>
    <div class="faq-item" id="[slug-seo]"><h3>[question longue traîne client précise]</h3><p>[réponse complète, 70-80 mots, concrète et utile]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse 70-80 mots]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse 70-80 mots]</p></div>
  </section>
  <section class="faq-section">
    <h2>[Thème 2 : Tarifs, devis et conditions]</h2>
    <div class="faq-item" id="[slug-seo]"><h3>[question sur les tarifs]</h3><p>[réponse 70-80 mots]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question sur le devis ou la durée]</h3><p>[réponse 70-80 mots]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question]</h3><p>[réponse 70-80 mots]</p></div>
  </section>
  <section class="faq-section">
    <h2>[Thème 3 : Processus, délais et garanties]</h2>
    <div class="faq-item" id="[slug-seo]"><h3>[question sur la façon de travailler]</h3><p>[réponse 70-80 mots]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question sur les délais ou garanties]</h3><p>[réponse 70-80 mots]</p></div>
  </section>
  <section class="faq-section">
    <h2>[Thème 4 : Contact, zones et disponibilités]</h2>
    <div class="faq-item" id="[slug-seo]"><h3>[question avec tel/mailto si disponibles dans les données]</h3><p>[réponse 70-80 mots avec coordonnées réelles]</p></div>
    <div class="faq-item" id="[slug-seo]"><h3>[question sur la zone géographique ou le déplacement]</h3><p>[réponse 70-80 mots]</p></div>
  </section>
  <footer class="faq-footer">Optimisation GEO par <a href="https://geoptim.io">Geoptim.io</a></footer>
</article>

RÈGLES IMPÉRATIVES :
- Minimum 10 questions réparties sur 4 sections
- Utilise uniquement les données réelles du site, aucune invention
- Chaque réponse en prose (pas de listes ni de tirets), 70-80 mots
- Les id des div sont des slugs SEO kebab-case en français
- Génère l'article complet jusqu'au footer, ne tronque pas`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of streamAnthropic(KEY, {
          model: "claude-sonnet-4-6",
          max_tokens: 2500,
          system: "Tu es un expert en optimisation GEO et SEO technique. Tu génères des pages FAQ complètes, précises et utiles, en utilisant uniquement les données réelles fournies. Tu ne tronques jamais ta réponse.",
          messages: [{ role: "user", content: prompt }]
        })) {
          ctrl.enqueue(enc.encode(chunk));
        }
        ctrl.close();
      } catch (err) {
        ctrl.enqueue(enc.encode(`\n__GEOPTIM_ERROR__${err.message}`));
        ctrl.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
