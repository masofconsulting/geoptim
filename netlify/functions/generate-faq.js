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

    const prompt = `Tu es un rédacteur senior spécialisé en référencement GEO et AEO. Tu génères une page FAQ HTML professionnelle pour un site web réel.

DONNÉES STRUCTURÉES DU SITE :
${ctx}

CONTENU BRUT RÉCUPÉRÉ DU SITE :
${(rawContent || '').slice(0, 3500)}

RÈGLES DE STYLE — STRICTES :
1. Prose uniquement. Aucune liste à puces, aucun tiret dans les réponses.
2. Aucun émoji dans tout le document.
3. Le gras (strong) est réservé aux noms propres et noms de services réels uniquement.
4. Ton professionnel, factuel, direct.
5. LIMITE ABSOLUE : chaque réponse (balise <p>) = 2 phrases maximum = 70 mots maximum. Phrases denses mais courtes.
6. Questions formulées comme de vraies recherches longue traîne d'un client du secteur.
7. 6 questions réparties en 2 sections thématiques adaptées au secteur réel.
8. Coordonnées réelles en lien cliquable : <a href="tel:..."> ou <a href="mailto:">.
9. IDs : slugs SEO du secteur réel.
10. Données réelles uniquement — ne rien inventer.
11. NE PAS générer de balise <style>. Classes : faq-page, faq-header, faq-intro, faq-section, faq-item, faq-footer.

FORMAT HTML EXACT :

<!--
  ${name} — FAQ optimisée AEO / GEO / SEO
  CSS : .faq-page{max-width:860px;margin:0 auto;padding:2.5rem 1.25rem;font-family:system-ui,sans-serif;color:#1f2937} .faq-header{margin-bottom:3rem;border-bottom:3px solid #0a2540;padding-bottom:2rem} .faq-header h1{font-size:clamp(22px,4vw,32px);color:#0a2540;margin:0 0 .75rem;font-weight:700} .faq-intro{color:#4b5563;font-size:15px;max-width:700px;line-height:1.8;margin:0} .faq-section{margin-bottom:3.5rem} .faq-section h2{font-size:1.2rem;color:#0a2540;border-bottom:1.5px solid #e5e7eb;padding-bottom:.6rem;margin-bottom:2rem;font-weight:600} .faq-item{margin-bottom:2.25rem} .faq-item h3{font-size:1rem;color:#111827;font-weight:600;margin:0 0 .6rem} .faq-item p{color:#374151;line-height:1.85;font-size:.95rem;margin:0} .faq-item a{color:#1d4ed8} .faq-footer{border-top:1px solid #e5e7eb;padding-top:1.25rem;margin-top:3rem;font-size:12px;color:#9ca3af;text-align:center}
  Généré par Geoptim.io — https://geoptim.io
-->
<article class="faq-page">

  <header class="faq-header">
    <h1>Questions fréquentes — ${name}</h1>
    <p class="faq-intro">[2 phrases : activité réelle, types de clients, zone géographique.]</p>
  </header>

  <section class="faq-section">
    <h2>[Thème 1 — ex: Expertise et périmètre]</h2>

    <div class="faq-item" id="[slug-1]">
      <h3>[Question 1 longue traîne]</h3>
      <p>[2 phrases, 70 mots max, point final obligatoire.]</p>
    </div>

    <div class="faq-item" id="[slug-2]">
      <h3>[Question 2]</h3>
      <p>[2 phrases, 70 mots max, point final obligatoire.]</p>
    </div>

    <div class="faq-item" id="[slug-3]">
      <h3>[Question 3]</h3>
      <p>[2 phrases, 70 mots max, point final obligatoire.]</p>
    </div>
  </section>

  <section class="faq-section">
    <h2>[Thème 2 — ex: Tarifs, contact et accès]</h2>

    <div class="faq-item" id="[slug-4]">
      <h3>[Question 4]</h3>
      <p>[2 phrases, 70 mots max, point final obligatoire.]</p>
    </div>

    <div class="faq-item" id="[slug-5]">
      <h3>[Question 5]</h3>
      <p>[2 phrases, 70 mots max, point final obligatoire.]</p>
    </div>

    <div class="faq-item" id="[slug-6]">
      <h3>[Question 6 avec coordonnées réelles si disponibles]</h3>
      <p>[2 phrases, 70 mots max, lien tel: ou mailto: si disponible, point final obligatoire.]</p>
    </div>
  </section>

  <footer class="faq-footer">
    Optimisation GEO par <a href="https://geoptim.io" rel="dofollow" style="color:#4f46e5">Geoptim.io</a>
  </footer>

</article>

Génère le HTML avec les vraies données. Respecte strictement la limite de 70 mots par réponse. Sans backtick. Sans émoji.`;

    const data = await callAnthropic(KEY, {
      model: "claude-opus-4-6",
      max_tokens: 3500,
      messages: [{ role: "user", content: prompt }]
    }, 25000);

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
