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

  let domain, name, ctx, rawContent, lang;
  try { ({ domain, name, ctx, rawContent, lang } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const content = (rawContent || '').slice(0, 3000);
  const isEn = lang && lang !== 'fr';

  const systemPrompt = isEn
    ? "You are a GEO and technical SEO expert. You generate complete, accurate and useful FAQ pages using only the real data provided. You never truncate your response."
    : "Tu es un expert en optimisation GEO et SEO technique. Tu génères des pages FAQ complètes, précises et utiles, en utilisant uniquement les données réelles fournies. Tu ne tronques jamais ta réponse.";

  const prompt = isEn
    ? `Generate a complete and optimal HTML FAQ page for this website. Raw HTML only, no backticks or style tags.

DATA:
${ctx}

SITE CONTENT:
${content}

STRUCTURE:
- Create as many thematic sections as the site content justifies (between 2 and 5 sections depending on content richness)
- In each section, generate as many questions as relevant (between 3 and 6 per theme)
- Themes should be derived from the actual industry: services/offerings, pricing/quotes, process/timelines, guarantees/support, contact/areas, team/expertise, etc.

FORMAT:
<article class="faq-page">
  <header class="faq-header">
    <h1>Frequently Asked Questions: ${name}</h1>
    <p class="faq-intro">[real activity, client types, geographic area, value proposition, 2-3 precise sentences]</p>
  </header>
  <section class="faq-section">
    <h2>[Relevant theme for this site]</h2>
    <div class="faq-item" id="[seo-kebab-slug]"><h3>[precise long-tail question a client would ask]</h3><p>[complete answer in prose, 70-80 words, concrete and useful, no lists or bullet points]</p></div>
    [repeat for each question in the theme]
  </section>
  [repeat for each relevant theme]
  <footer class="faq-footer">GEO optimization by <a href="https://geoptim.io">Geoptim.io</a></footer>
</article>

RULES:
- Fully adapt the structure to the analyzed site, do not force any theme absent from the content
- Real data only, no invention
- Each answer in prose without lists or bullet points, 70-80 words
- IDs are descriptive SEO kebab-case slugs in English
- ALWAYS end with the footer and </article>`
    : `Génère une page FAQ HTML complète et optimale pour ce site. HTML brut uniquement, sans backtick ni balise style.

DONNÉES :
${ctx}

CONTENU DU SITE :
${content}

STRUCTURE :
- Crée autant de sections thématiques que le contenu du site le justifie (entre 2 et 5 sections selon la richesse du site)
- Dans chaque section, génère autant de questions que pertinent (entre 3 et 6 selon le thème)
- Les thèmes sont à déduire du secteur d'activité réel : services/prestations, tarifs/devis, processus/délais, garanties/SAV, contact/zones, équipe/expertise, etc.

FORMAT :
<article class="faq-page">
  <header class="faq-header">
    <h1>Questions fréquentes : ${name}</h1>
    <p class="faq-intro">[activité réelle, types de clients, zone géographique, valeur ajoutée, 2-3 phrases précises]</p>
  </header>
  <section class="faq-section">
    <h2>[Thème pertinent pour ce site]</h2>
    <div class="faq-item" id="[slug-kebab-seo]"><h3>[question longue traîne précise qu'un client poserait]</h3><p>[réponse complète en prose, 70-80 mots, concrète et utile, sans liste ni tiret]</p></div>
    [répéter pour chaque question du thème]
  </section>
  [répéter pour chaque thème pertinent]
  <footer class="faq-footer">Optimisation GEO par <a href="https://geoptim.io">Geoptim.io</a></footer>
</article>

RÈGLES :
- Adapte entièrement la structure au site analysé, ne force aucun thème absent du contenu
- Données réelles uniquement, aucune invention
- Chaque réponse en prose sans liste ni tiret, 70-80 mots
- Les id sont des slugs SEO kebab-case descriptifs en français
- Termine IMPÉRATIVEMENT par le footer et </article>`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of streamAnthropic(KEY, {
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: systemPrompt,
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
